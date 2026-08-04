import { createSign } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { GitHubChannelCredentials, GitHubChannelState } from "eve/channels/github";
import * as tar from "tar";
import {
  AGENTOS_WORKSPACE_MOUNT,
  agentOsCheckoutMetaPath,
  agentOsWorkspaceHostPath,
} from "./agentos-workspace";

export async function materializeGitHubCheckout(input: {
  credentials: GitHubChannelCredentials;
  sessionKey: string;
  state: GitHubChannelState;
}): Promise<{ path: string; ref: string }> {
  const { credentials, sessionKey, state } = input;
  const ref = resolveCheckoutRef(state);
  const hostPath = agentOsWorkspaceHostPath(sessionKey);
  const metaPath = agentOsCheckoutMetaPath(sessionKey);

  await mkdir(hostPath, { recursive: true });
  await mkdir(metaPath, { recursive: true });

  const markerPath = join(metaPath, "checkout-sha");
  const previous = await readFile(markerPath, "utf8").catch(() => "");
  if (previous.trim() === ref) {
    return { path: AGENTOS_WORKSPACE_MOUNT, ref };
  }

  const token = await resolveInstallationAccessToken(credentials, state.installationId);
  await emptyDirectory(hostPath);
  await downloadAndExtractTarball({
    hostPath,
    owner: state.owner,
    ref,
    repo: state.repo,
    token,
  });
  await writeFile(markerPath, `${ref}\n`, "utf8");

  return { path: AGENTOS_WORKSPACE_MOUNT, ref };
}

function resolveCheckoutRef(state: GitHubChannelState): string {
  if (state.headSha && state.headSha.trim().length > 0) {
    return state.headSha.trim();
  }
  if (state.headRef && state.headRef.trim().length > 0) {
    return state.headRef.trim();
  }
  if (state.defaultBranch && state.defaultBranch.trim().length > 0) {
    return state.defaultBranch.trim();
  }
  throw new Error("GitHub host checkout could not resolve a ref to fetch.");
}

async function resolveInstallationAccessToken(
  credentials: GitHubChannelCredentials,
  installationId: number | null,
): Promise<string> {
  if (credentials.installationToken !== undefined) {
    const token =
      typeof credentials.installationToken === "function"
        ? await credentials.installationToken()
        : credentials.installationToken;
    const trimmed = token.trim();
    if (!trimmed) {
      throw new Error("GitHub credentials returned an empty installation token.");
    }
    return trimmed;
  }

  if (installationId === null) {
    throw new Error("installationId is required when minting a GitHub App installation token.");
  }

  const appId = await resolveCredentialValue(credentials.appId, "GITHUB_APP_ID");
  const privateKey = normalizePrivateKey(
    await resolveCredentialValue(credentials.privateKey, "GITHUB_APP_PRIVATE_KEY"),
  );
  const jwt = createGitHubAppJwt(appId, privateKey);
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "User-Agent": "anturno-curl",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to mint GitHub installation token (HTTP ${response.status}): ${await response.text()}`,
    );
  }

  const body = (await response.json()) as { token?: string };
  if (!body.token) {
    throw new Error("GitHub installation token response did not include token.");
  }
  return body.token;
}

async function resolveCredentialValue(
  value: string | number | (() => string | number | Promise<string | number>) | undefined,
  envName: string,
): Promise<string> {
  const resolved =
    value === undefined
      ? process.env[envName]
      : typeof value === "function"
        ? await value()
        : value;
  if (resolved === undefined || resolved === null || String(resolved).trim() === "") {
    throw new Error(`${envName} is required for GitHub App authentication.`);
  }
  return String(resolved).trim();
}

function normalizePrivateKey(privateKey: string): string {
  return privateKey.includes("\\n") ? privateKey.replace(/\\n/g, "\n") : privateKey;
}

function createGitHubAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: appId,
    }),
  ).toString("base64url");
  const data = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(data);
  signer.end();
  return `${data}.${signer.sign(privateKey, "base64url")}`;
}

async function downloadAndExtractTarball(input: {
  hostPath: string;
  owner: string;
  ref: string;
  repo: string;
  token: string;
}): Promise<void> {
  const { hostPath, owner, ref, repo, token } = input;
  const url = `https://api.github.com/repos/${owner}/${repo}/tarball/${encodeURIComponent(ref)}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "anturno-curl",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(
      `GitHub tarball fetch failed for ${owner}/${repo}@${ref} (HTTP ${response.status}).`,
    );
  }

  const body = response.body;
  if (!body) {
    throw new Error(`GitHub tarball response for ${owner}/${repo}@${ref} had an empty body.`);
  }

  // Pure JS extract — Vercel serverless has no system `tar` binary.
  await pipeline(
    Readable.fromWeb(body as import("node:stream/web").ReadableStream),
    tar.x({ cwd: hostPath, gzip: true, strip: 1 }),
  );
}

async function emptyDirectory(dir: string): Promise<void> {
  const entries = await readdir(dir).catch(() => []);
  await Promise.all(entries.map((entry) => rm(join(dir, entry), { force: true, recursive: true })));
}
