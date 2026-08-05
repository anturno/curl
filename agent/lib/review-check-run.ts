import type { GitHubEventContext, GitHubHandle } from "eve/channels/github";
import type { SessionAuthContext } from "eve/context";
import { reviewConfig } from "./config";
import { isRecord, readSafeInteger, repoPath } from "./github-api";
import { logGitHubFailure } from "./github-failure";
import { resolvePullRequestHeadSha } from "./review-head";

/** Check run name shown in the PR Checks tab. */
export const CURL_REVIEW_CHECK_NAME = "Curl review";

const CHECK_RUN_ID_ATTRIBUTE = "curl:review-check-run-id";
const CHECK_RUN_SHA_ATTRIBUTE = "curl:review-check-run-sha";

interface CheckRunBody {
  readonly id?: unknown;
}

export interface ReviewCheckRun {
  readonly headSha: string;
  readonly id: number;
}

async function findInProgressCheckRunId(
  github: GitHubHandle,
  owner: string,
  repo: string,
  headSha: string,
): Promise<number | null> {
  const response = await github.request<unknown>({
    method: "GET",
    path: `${repoPath(owner, repo)}/commits/${headSha}/check-runs?check_name=${encodeURIComponent(CURL_REVIEW_CHECK_NAME)}&status=in_progress&filter=latest`,
  });
  if (!isRecord(response.body) || !Array.isArray(response.body.check_runs)) {
    throw new Error("GitHub check-run list response was not an object with check_runs");
  }

  for (const checkRun of response.body.check_runs) {
    if (!isRecord(checkRun)) {
      continue;
    }
    const id = readSafeInteger(checkRun.id);
    const status = checkRun.status;
    if (id !== null && (status === undefined || status === "in_progress")) {
      return id;
    }
  }
  return null;
}

/**
 * Opens (or reuses) an in-progress "Curl review" check run for a commit.
 * Errors are swallowed so a missing Checks permission never blocks the review.
 * The lookup prevents common duplicates; GitHub does not provide a supported
 * idempotency key for this endpoint, so this code does not invent one.
 */
export async function startReviewCheckRun(input: {
  readonly github: GitHubHandle;
  readonly headSha: string | null | undefined;
  readonly owner: string;
  readonly pullRequestNumber?: number | null;
  readonly repo: string;
}): Promise<ReviewCheckRun | null> {
  if (!reviewConfig.github.checkRunsEnabled) {
    return null;
  }
  const { github, owner, repo, headSha, pullRequestNumber } = input;
  if (!headSha) {
    return null;
  }

  let existing: number | null;
  try {
    existing = await findInProgressCheckRunId(github, owner, repo, headSha);
  } catch (error) {
    logGitHubFailure(
      {
        owner,
        repo,
        pullRequestNumber,
        headSha,
        operation: "check-run.list-in-progress",
      },
      error,
    );
    return null;
  }
  if (existing !== null) {
    return { headSha, id: existing };
  }

  try {
    const response = await github.request<CheckRunBody>({
      method: "POST",
      path: `${repoPath(owner, repo)}/check-runs`,
      body: {
        name: CURL_REVIEW_CHECK_NAME,
        head_sha: headSha,
        status: "in_progress",
        output: {
          title: "Review in progress",
          summary: "Curl is reviewing this pull request for **correctness** and **security**.",
        },
      },
    });
    const id = readSafeInteger(response.body.id);
    if (id === null) {
      logGitHubFailure(
        {
          owner,
          repo,
          pullRequestNumber,
          headSha,
          operation: "check-run.create-response",
        },
        new Error("GitHub check-run create response did not include a valid id"),
      );
      return null;
    }
    return { headSha, id };
  } catch (error) {
    logGitHubFailure(
      {
        owner,
        repo,
        pullRequestNumber,
        headSha,
        operation: "check-run.create",
      },
      error,
    );
    return null;
  }
}

/**
 * Find the in-progress run for the persisted event head. This is used by the
 * session.failed hook, whose Eve contract intentionally has no SessionContext.
 * Prefer the durable state SHA over a fresh PR lookup so a changed head cannot
 * make an older run look like the current run.
 */
export async function findReviewCheckRunForChannel(
  channel: GitHubEventContext,
): Promise<ReviewCheckRun | null> {
  if (!reviewConfig.github.checkRunsEnabled || channel.state.pullRequestNumber === null) {
    return null;
  }
  const { owner, repo, pullRequestNumber } = channel.state;
  const headSha =
    channel.state.headSha ??
    (await resolvePullRequestHeadSha(channel.github, owner, repo, pullRequestNumber));
  if (!headSha) {
    return null;
  }

  try {
    const id = await findInProgressCheckRunId(channel.github, owner, repo, headSha);
    return id === null ? null : { headSha, id };
  } catch (error) {
    logGitHubFailure(
      {
        owner,
        repo,
        pullRequestNumber,
        headSha,
        operation: "check-run.find-for-session-failure",
      },
      error,
    );
    return null;
  }
}

/** Carry the check reference through Eve's durable session auth metadata. */
export function withReviewCheckRun(
  auth: SessionAuthContext,
  checkRun: ReviewCheckRun | null,
): SessionAuthContext {
  if (checkRun === null) {
    return auth;
  }
  return {
    ...auth,
    attributes: {
      ...auth.attributes,
      [CHECK_RUN_ID_ATTRIBUTE]: String(checkRun.id),
      [CHECK_RUN_SHA_ATTRIBUTE]: checkRun.headSha,
    },
  };
}

/** Read a check reference without exposing arbitrary auth metadata. */
export function reviewCheckRunFromAuth(
  auth: SessionAuthContext | null | undefined,
): ReviewCheckRun | null {
  const id = auth?.attributes[CHECK_RUN_ID_ATTRIBUTE];
  const headSha = auth?.attributes[CHECK_RUN_SHA_ATTRIBUTE];
  if (
    typeof id !== "string" ||
    !/^\d+$/u.test(id) ||
    typeof headSha !== "string" ||
    headSha.length === 0
  ) {
    return null;
  }
  const numericId = readSafeInteger(Number(id));
  return numericId === null ? null : { headSha, id: numericId };
}
