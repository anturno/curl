import type { GitHubEventContext } from "eve/channels/github";
import type { SandboxSession } from "eve/sandbox";
import { createSandboxCurlOsHost, createSandboxWorkspaceWriter } from "./curlos-sandbox-host";
import {
  type CheckoutFile,
  type CheckoutManifest,
  type CheckoutProvider,
  type CheckoutRef,
  type CheckoutSkip,
  CURL_OS_ROOT,
  type CurlOsLimits,
  type CurlOsSession,
  DEFAULT_CURL_OS_LIMITS,
  openCurlOs,
  rememberCurlOsSession,
  type WorkspaceWriter,
} from "./curlos-session";

const BLOB_FETCH_CONCURRENCY = 8;

interface GitTree {
  readonly tree?: readonly GitTreeEntry[];
  readonly truncated?: boolean;
}

interface GitTreeEntry {
  readonly path?: unknown;
  readonly sha?: unknown;
  readonly size?: unknown;
  readonly type?: unknown;
}

interface GitBlob {
  readonly content?: unknown;
  readonly encoding?: unknown;
}

interface PullRequest {
  readonly head?: {
    readonly sha?: unknown;
  };
}

interface GitCommit {
  readonly sha?: unknown;
}

/**
 * Resolve owner/repo/sha for a review checkout from channel state.
 * Prefers an object id; otherwise resolves a branch/PR tip once.
 */
export async function resolveGitHubCheckoutRef(channel: GitHubEventContext): Promise<CheckoutRef> {
  const { state } = channel;
  const owner = nonEmpty(state.owner);
  const repo = nonEmpty(state.repo);
  if (owner === undefined || repo === undefined) {
    throw new Error("GitHub checkout requires a repository owner and name");
  }

  const repositoryPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const sha = await resolveReviewCommitSha(channel, repositoryPath);
  return { owner, repo, sha };
}

/**
 * Host-side GitHub Trees/Blobs materializer. Credentials stay on the channel;
 * only decoded bytes cross the WorkspaceWriter seam.
 */
export function createGitHubCheckoutProvider(channel: GitHubEventContext): CheckoutProvider {
  return {
    async materialize(ref, writer, limits) {
      return materializeGitHubTree(channel, ref, writer, limits);
    },
  };
}

/**
 * Open a CurlOS inspect session for the current GitHub review head.
 * Remembers the session against `sandbox.id` until `closeRememberedCurlOsSession`.
 */
export async function openGitHubCurlOs(
  channel: GitHubEventContext,
  sandbox: SandboxSession,
): Promise<CurlOsSession> {
  const checkout = await resolveGitHubCheckoutRef(channel);
  const session = await openCurlOs({
    checkout,
    provider: createGitHubCheckoutProvider(channel),
    host: createSandboxCurlOsHost(sandbox),
    writer: createSandboxWorkspaceWriter(sandbox),
  });
  applyCheckoutManifest(channel, session.manifest);
  rememberCurlOsSession(sandbox.id, session);
  return session;
}

/**
 * Materialize the review checkout through the host-side GitHub API without
 * opening a long-lived CurlOS session (tests / callers that only need the VFS).
 */
export async function materializeGitHubCheckout(
  channel: GitHubEventContext,
  sandbox: SandboxSession,
): Promise<CheckoutManifest> {
  const checkout = await resolveGitHubCheckoutRef(channel);
  const manifest = await createGitHubCheckoutProvider(channel).materialize(
    checkout,
    createSandboxWorkspaceWriter(sandbox),
    {
      maxFiles: DEFAULT_CURL_OS_LIMITS.maxFiles,
      maxFileBytes: DEFAULT_CURL_OS_LIMITS.maxFileBytes,
      maxWorkspaceBytes: DEFAULT_CURL_OS_LIMITS.maxWorkspaceBytes,
    },
  );
  applyCheckoutManifest(channel, manifest);
  return manifest;
}

function applyCheckoutManifest(channel: GitHubEventContext, manifest: CheckoutManifest): void {
  channel.state.checkoutPath = manifest.root;
  channel.state.headSha = manifest.sha;
}

async function materializeGitHubTree(
  channel: GitHubEventContext,
  ref: CheckoutRef,
  writer: WorkspaceWriter,
  limits: Pick<CurlOsLimits, "maxFiles" | "maxFileBytes" | "maxWorkspaceBytes">,
): Promise<CheckoutManifest> {
  const repositoryPath = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  const tree = await requestJson<GitTree>(
    channel,
    `${repositoryPath}/git/trees/${encodeURIComponent(ref.sha)}?recursive=1`,
  );
  if (tree.truncated === true) {
    throw new Error("GitHub checkout tree is too large for Curl's custom sandbox");
  }
  const blobs = (tree.tree ?? []).filter((entry) => entry.type === "blob");
  if (blobs.length > limits.maxFiles) {
    throw new Error(`GitHub checkout exceeds Curl's ${limits.maxFiles}-file sandbox limit`);
  }

  // GitHub's Trees API includes `size` on blob entries. Blobs without it are
  // skipped so the workspace ceiling can be enforced before any fetch —
  // otherwise an unsized tree could still hit ENOSPC mid-write.
  const candidates: { path: string; relativePath: string; sha: string; bytes: number }[] = [];
  const skipped: CheckoutSkip[] = [];
  let plannedBytes = 0;
  for (const file of blobs) {
    const relativePath = safeRepositoryRelativePath(file.path);
    const sha = stringValue(file.sha);
    const size = numberValue(file.size);
    if (sha === undefined) continue;
    if (size === undefined) {
      skipped.push({ path: relativePath, reason: "unsized" });
      continue;
    }
    if (size > limits.maxFileBytes) {
      skipped.push({ path: relativePath, reason: "too-large" });
      continue;
    }
    plannedBytes += size;
    if (plannedBytes > limits.maxWorkspaceBytes) {
      throw new Error(
        `GitHub checkout exceeds Curl's ${limits.maxWorkspaceBytes}-byte sandbox limit`,
      );
    }
    candidates.push({
      path: `${CURL_OS_ROOT}/${relativePath}`,
      relativePath,
      sha,
      bytes: size,
    });
  }

  await writer.clearRoot();

  const files: CheckoutFile[] = [];
  let bytes = 0;
  for (let offset = 0; offset < candidates.length; offset += BLOB_FETCH_CONCURRENCY) {
    const batch = candidates.slice(offset, offset + BLOB_FETCH_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (file) => {
        const blob = await requestJson<GitBlob>(channel, `${repositoryPath}/git/blobs/${file.sha}`);
        const content = decodeBlob(blob);
        if (content.byteLength > limits.maxFileBytes) {
          return { kind: "skip" as const, path: file.relativePath };
        }
        await writer.writeFile(file.path, content);
        return {
          kind: "file" as const,
          file: {
            path: file.relativePath,
            sha: file.sha,
            bytes: content.byteLength,
          },
        };
      }),
    );
    for (const result of batchResults) {
      switch (result.kind) {
        case "skip":
          skipped.push({ path: result.path, reason: "too-large" });
          break;
        case "file":
          files.push(result.file);
          bytes += result.file.bytes;
          break;
        default: {
          const _exhaustive: never = result;
          throw new Error(`unexpected checkout batch result: ${JSON.stringify(_exhaustive)}`);
        }
      }
    }
  }

  return {
    sha: ref.sha,
    root: CURL_OS_ROOT,
    files,
    skipped,
    bytes,
  };
}

async function resolveReviewCommitSha(
  channel: GitHubEventContext,
  repositoryPath: string,
): Promise<string> {
  const { state } = channel;
  const headSha = nonEmpty(state.headSha);
  if (headSha !== undefined && isGitObjectId(headSha)) return headSha;

  const ref = headSha ?? nonEmpty(state.headRef) ?? nonEmpty(state.defaultBranch);
  if (ref !== undefined) {
    const sha = await commitShaForRef(channel, repositoryPath, ref);
    if (sha !== undefined) return sha;
  }

  if (state.pullRequestNumber !== null) {
    const sha = await pullRequestHead(
      channel,
      `${repositoryPath}/pulls/${state.pullRequestNumber}`,
    );
    if (sha !== undefined) return sha;
  }

  throw new Error("GitHub checkout could not resolve a review commit SHA");
}

async function commitShaForRef(
  channel: GitHubEventContext,
  repositoryPath: string,
  ref: string,
): Promise<string | undefined> {
  const response = await requestJson<GitCommit>(
    channel,
    `${repositoryPath}/commits/${encodeURIComponent(ref)}`,
  );
  const sha = stringValue(response.sha);
  return sha !== undefined && isGitObjectId(sha) ? sha : undefined;
}

async function pullRequestHead(
  channel: GitHubEventContext,
  path: string,
): Promise<string | undefined> {
  const response = await requestJson<PullRequest>(channel, path);
  const sha = stringValue(response.head?.sha);
  return sha !== undefined && isGitObjectId(sha) ? sha : undefined;
}

async function requestJson<T>(channel: GitHubEventContext, path: string): Promise<T> {
  const response = await channel.github.request<T>({ method: "GET", path });
  return response.body;
}

function safeRepositoryRelativePath(value: unknown): string {
  const path = stringValue(value);
  if (
    path === undefined ||
    path.length === 0 ||
    path.startsWith("/") ||
    path.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new Error("GitHub checkout returned an unsafe repository path");
  }
  return path;
}

function decodeBlob(blob: GitBlob): Uint8Array {
  if (blob.encoding !== "base64" || typeof blob.content !== "string") {
    throw new Error("GitHub checkout returned an unsupported blob encoding");
  }
  return Buffer.from(blob.content.replaceAll(/\s/gu, ""), "base64");
}

function isGitObjectId(value: string): boolean {
  return /^[0-9a-f]{7,64}$/iu.test(value);
}

function nonEmpty(value: string | null): string | undefined {
  return value?.trim() || undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
