import {
  type CheckoutFile,
  type CheckoutManifest,
  type CheckoutProvider,
  type CheckoutRef,
  type CheckoutSkip,
  CURL_OS_ROOT,
  type CurlOsLimits,
  type CurlOsSession,
  openCurlOs,
  type WorkspaceWriter,
} from "@anturno/curlos";
import {
  createSandboxCurlOsHost,
  createSandboxWorkspaceWriter,
  rememberCurlOsSession,
} from "@anturno/curlos/eve";
import { resolveGitHubCheckoutRef } from "@anturno/curlos/github";
import type { GitHubEventContext } from "eve/channels/github";
import type { SandboxSession } from "eve/sandbox";

const BLOB_FETCH_CONCURRENCY = 8;

interface GitBlob {
  readonly content?: unknown;
  readonly encoding?: unknown;
}

export function createDiffCheckoutProvider(
  channel: GitHubEventContext,
  pullRequestNumber: number,
): CheckoutProvider {
  return {
    async materialize(ref, writer, limits) {
      return materializeDiff(channel, ref, writer, limits, pullRequestNumber);
    },
  };
}

export async function openDiffCurlOs(
  channel: GitHubEventContext,
  sandbox: SandboxSession,
): Promise<CurlOsSession> {
  const checkout = await resolveGitHubCheckoutRef(channel);
  const pullRequestNumber = channel.state.pullRequestNumber;
  if (pullRequestNumber === null) {
    throw new Error("Diff checkout requires a pull request number");
  }

  const session = await openCurlOs({
    checkout,
    provider: createDiffCheckoutProvider(channel, pullRequestNumber),
    host: createSandboxCurlOsHost(sandbox),
    writer: createSandboxWorkspaceWriter(sandbox),
  });

  channel.state.checkoutPath = session.manifest.root;
  channel.state.headSha = session.manifest.sha;
  rememberCurlOsSession(sandbox.id, session);
  return session;
}

async function materializeDiff(
  channel: GitHubEventContext,
  ref: CheckoutRef,
  writer: WorkspaceWriter,
  limits: Pick<CurlOsLimits, "maxFiles" | "maxFileBytes" | "maxWorkspaceBytes">,
  pullRequestNumber: number,
): Promise<CheckoutManifest> {
  const repositoryPath = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  const changedFiles = await fetchChangedFiles(
    channel,
    repositoryPath,
    pullRequestNumber,
    limits.maxFiles,
  );

  await writer.clearRoot();

  const files: CheckoutFile[] = [];
  const skipped: CheckoutSkip[] = [];
  let bytes = 0;

  for (let offset = 0; offset < changedFiles.length; offset += BLOB_FETCH_CONCURRENCY) {
    const batch = changedFiles.slice(offset, offset + BLOB_FETCH_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (file) => {
        const blob = await requestJson<GitBlob>(
          channel,
          `${repositoryPath}/git/blobs/${encodeURIComponent(file.sha)}`,
        );
        const content = decodeBlob(blob);
        if (content.byteLength > limits.maxFileBytes) {
          return { kind: "skip" as const, path: file.relativePath };
        }
        if (bytes + content.byteLength > limits.maxWorkspaceBytes) {
          throw new Error(
            `GitHub diff checkout exceeds ${limits.maxWorkspaceBytes}-byte workspace limit`,
          );
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
          const exhaustiveResult: never = result;
          throw new Error(`unexpected checkout result: ${JSON.stringify(exhaustiveResult)}`);
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

async function fetchChangedFiles(
  channel: GitHubEventContext,
  repositoryPath: string,
  pullRequestNumber: number,
  maxFiles: number,
): Promise<
  readonly { readonly path: string; readonly relativePath: string; readonly sha: string }[]
> {
  const candidates: {
    readonly path: string;
    readonly relativePath: string;
    readonly sha: string;
  }[] = [];
  const pageSize = 100;

  for (let page = 1; ; page += 1) {
    const response = await requestJson<readonly unknown[]>(
      channel,
      `${repositoryPath}/pulls/${pullRequestNumber}/files?per_page=${pageSize}&page=${page}`,
    );
    if (!Array.isArray(response)) {
      throw new Error("GitHub pull-request files response was not an array");
    }

    for (const file of response) {
      if (!isRecord(file)) continue;

      const status = stringValue(file.status);
      if (status === "removed") {
        continue;
      }

      const relativePath = safeRepositoryRelativePath(file.filename);
      const sha = stringValue(file.sha);
      if (sha === undefined || !isGitObjectId(sha)) {
        continue;
      }

      candidates.push({
        path: `${CURL_OS_ROOT}/${relativePath}`,
        relativePath,
        sha,
      });
    }

    if (candidates.length > maxFiles) {
      throw new Error(`GitHub diff checkout exceeds ${maxFiles}-file limit`);
    }

    if (response.length < pageSize) {
      break;
    }
  }

  return candidates;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
