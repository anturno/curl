import type { GitHubHandle } from "eve/channels/github";
import { isRecord, readString, repoPath } from "./github-api";
import { logGitHubFailure } from "./github-failure";

/** The SHA used for the review and the currently observed PR head, when known. */
export interface ReviewHeadStatus {
  readonly currentHeadSha: string | null;
  readonly reviewedHeadSha: string;
  readonly stale: boolean;
}

/** Resolve the PR head SHA when the inbound event did not include it. */
export async function resolvePullRequestHeadSha(
  github: GitHubHandle,
  owner: string,
  repo: string,
  pullRequestNumber: number,
  diagnosticHeadSha: string | null = null,
  diagnosticCheckId: number | null = null,
): Promise<string | null> {
  try {
    const response = await github.request<unknown>({
      method: "GET",
      path: `${repoPath(owner, repo)}/pulls/${pullRequestNumber}`,
    });
    if (!isRecord(response.body) || !isRecord(response.body.head)) {
      throw new Error("GitHub pull-request response did not include head metadata");
    }
    const sha = readString(response.body.head.sha);
    if (sha === null) {
      throw new Error("GitHub pull-request response did not include a head SHA");
    }
    return sha;
  } catch (error) {
    logGitHubFailure(
      {
        owner,
        repo,
        pullRequestNumber,
        headSha: diagnosticHeadSha,
        checkId: diagnosticCheckId,
        operation: "pull-request.head",
      },
      error,
    );
    return null;
  }
}

/**
 * Compare the persisted review SHA with the PR head at delivery time. A null
 * current SHA means the comparison was unavailable, not that the review is
 * known to be stale. The check itself remains attached to `reviewedHeadSha`.
 */
export async function resolveReviewHeadStatus(input: {
  readonly checkId?: number | null;
  readonly github: GitHubHandle;
  readonly owner: string;
  readonly pullRequestNumber: number | null;
  readonly repo: string;
  readonly reviewedHeadSha: string | null | undefined;
}): Promise<ReviewHeadStatus | null> {
  const { checkId, github, owner, pullRequestNumber, repo, reviewedHeadSha } = input;
  if (pullRequestNumber === null || !reviewedHeadSha) {
    return null;
  }
  const currentHeadSha = await resolvePullRequestHeadSha(
    github,
    owner,
    repo,
    pullRequestNumber,
    reviewedHeadSha,
    checkId,
  );
  return {
    currentHeadSha,
    reviewedHeadSha,
    stale:
      currentHeadSha !== null && currentHeadSha.toLowerCase() !== reviewedHeadSha.toLowerCase(),
  };
}
