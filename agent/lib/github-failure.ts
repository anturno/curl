import type { GitHubEventContext } from "eve/channels/github";
import { isRecord, readString } from "./github-api";

export interface GitHubFailureContext {
  readonly checkId?: number | null;
  readonly headSha?: string | null;
  readonly operation: string;
  readonly owner: string;
  readonly pullRequestNumber?: number | null;
  readonly repo: string;
}

type CheckRunReference = Readonly<{
  readonly headSha: string;
  readonly id: number;
}>;

export function buildGitHubFailureContext(
  channel: GitHubEventContext,
  checkRun: CheckRunReference | null,
  operation: string,
): GitHubFailureContext {
  return {
    owner: channel.state.owner,
    repo: channel.state.repo,
    pullRequestNumber: channel.state.pullRequestNumber,
    headSha: checkRun?.headSha ?? channel.state.headSha,
    checkId: checkRun?.id ?? null,
    operation,
  };
}

function readStatus(error: unknown): number | null {
  if (!isRecord(error)) {
    return null;
  }
  const status = error.status;
  return typeof status === "number" && Number.isSafeInteger(status) ? status : null;
}

function readErrorId(error: unknown): string | null {
  if (!isRecord(error)) {
    return null;
  }
  const directId = readString(error.errorId);
  if (directId && /^[A-Za-z0-9_-]{1,128}$/u.test(directId)) {
    return directId;
  }
  const details = error.details;
  if (!isRecord(details)) {
    return null;
  }
  const detailsId = readString(details.errorId);
  return detailsId && /^[A-Za-z0-9_-]{1,128}$/u.test(detailsId) ? detailsId : null;
}

function diagnosticSha(value: string | null | undefined): string | null {
  return value && /^[0-9a-f]{7,64}$/iu.test(value) ? value : null;
}

/**
 * Emit only non-secret GitHub failure metadata. In particular, never include
 * an exception message or response body: GitHub errors may contain sensitive
 * response material, and provider errors may contain prompts or credentials.
 */
export function logGitHubFailure(context: GitHubFailureContext, error: unknown): void {
  const diagnostic: Record<string, number | string | null> = {
    repository: `${context.owner}/${context.repo}`,
    pullRequestNumber: context.pullRequestNumber ?? null,
    headSha: diagnosticSha(context.headSha),
    checkId: context.checkId ?? null,
    operation: context.operation,
  };
  const status = readStatus(error);
  const errorId = readErrorId(error);
  if (status !== null) {
    diagnostic.status = status;
  }
  if (errorId !== null) {
    diagnostic.errorId = errorId;
  }

  try {
    globalThis.console.warn("[curl] GitHub operation failed", diagnostic);
  } catch {
    // Diagnostics must never turn a best-effort integration cleanup into a failure.
  }
}
