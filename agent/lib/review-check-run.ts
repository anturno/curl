import type { GitHubEventContext, GitHubHandle } from "eve/channels/github";

/** Check run name shown in the PR Checks tab. */
export const CURL_REVIEW_CHECK_NAME = "Curl review";

const COMMENT_MAX = 65_536;
const CHECK_TEXT_MAX = 65_535;

type CheckConclusion = "cancelled" | "failure" | "neutral" | "success" | "timed_out";

interface CheckRunListBody {
  readonly check_runs?: readonly { readonly id?: number }[];
}

interface PullRequestBody {
  readonly head?: { readonly sha?: string };
}

function checksEnabled(): boolean {
  return process.env.CURL_CHECK_RUN !== "0";
}

function repoPath(owner: string, repo: string): string {
  return `/repos/${owner}/${repo}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function extractVerdict(message: string): string | null {
  const match = /\*\*Verdict:\*\*\s*(.+)/i.exec(message);
  const verdict = match?.[1]?.trim();
  return verdict && verdict.length > 0 ? verdict : null;
}

/** Split long bodies the way GitHub comment limits require. */
export function splitCommentBody(body: string, maxLength = COMMENT_MAX): string[] {
  if (body.length <= maxLength) {
    return [body];
  }
  const chunks: string[] = [];
  let rest = body;
  while (rest.length > maxLength) {
    let splitAt = rest.lastIndexOf("\n", maxLength);
    if (splitAt < maxLength * 0.5) {
      splitAt = rest.lastIndexOf(" ", maxLength);
    }
    if (splitAt < maxLength * 0.5) {
      splitAt = maxLength;
    }
    chunks.push(rest.slice(0, splitAt).trimEnd());
    rest = rest.slice(splitAt).trimStart();
  }
  if (rest.length > 0) {
    chunks.push(rest);
  }
  return chunks;
}

async function findInProgressCheckRunId(
  github: GitHubHandle,
  owner: string,
  repo: string,
  headSha: string,
): Promise<number | null> {
  const response = await github.request<CheckRunListBody>({
    method: "GET",
    path: `${repoPath(owner, repo)}/commits/${headSha}/check-runs?check_name=${encodeURIComponent(CURL_REVIEW_CHECK_NAME)}&status=in_progress&filter=latest`,
  });
  const id = response.body.check_runs?.[0]?.id;
  return typeof id === "number" ? id : null;
}

/** Resolve the PR head SHA when the inbound event did not include it. */
export async function resolvePullRequestHeadSha(
  github: GitHubHandle,
  owner: string,
  repo: string,
  pullRequestNumber: number,
): Promise<string | null> {
  try {
    const response = await github.request<PullRequestBody>({
      method: "GET",
      path: `${repoPath(owner, repo)}/pulls/${pullRequestNumber}`,
    });
    const sha = response.body.head?.sha;
    return typeof sha === "string" && sha.length > 0 ? sha : null;
  } catch {
    return null;
  }
}

/**
 * Opens (or reuses) an in-progress "Curl review" check run for a commit.
 * Errors are swallowed so a missing Checks permission never blocks the review.
 */
export async function startReviewCheckRun(input: {
  readonly github: GitHubHandle;
  readonly headSha: string | null | undefined;
  readonly owner: string;
  readonly repo: string;
}): Promise<void> {
  if (!checksEnabled()) {
    return;
  }
  const { github, owner, repo, headSha } = input;
  if (!headSha) {
    return;
  }

  try {
    const existing = await findInProgressCheckRunId(github, owner, repo, headSha);
    if (existing !== null) {
      return;
    }

    await github.request({
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
  } catch {
    // Missing Checks: write, transient API errors, etc.
  }
}

/**
 * Completes the in-progress check run for the current PR head.
 * Uses conclusion `neutral` by default so findings never block merges.
 */
export async function completeReviewCheckRun(
  channel: GitHubEventContext,
  input: {
    readonly conclusion?: CheckConclusion;
    readonly summary: string;
    readonly title: string;
    readonly text?: string;
  },
): Promise<void> {
  if (!checksEnabled()) {
    return;
  }
  const { owner, repo, headSha, pullRequestNumber } = channel.state;
  if (pullRequestNumber === null || !headSha) {
    return;
  }

  try {
    const checkRunId = await findInProgressCheckRunId(channel.github, owner, repo, headSha);
    if (checkRunId === null) {
      return;
    }

    const summary = truncate(input.summary, CHECK_TEXT_MAX);
    const text = input.text ? truncate(input.text, CHECK_TEXT_MAX) : undefined;

    await channel.github.request({
      method: "PATCH",
      path: `${repoPath(owner, repo)}/check-runs/${checkRunId}`,
      body: {
        status: "completed",
        conclusion: input.conclusion ?? "neutral",
        output: {
          title: truncate(input.title, 255),
          summary,
          ...(text ? { text } : {}),
        },
      },
    });
  } catch {
    // Same as start — never fail the turn over check-run bookkeeping.
  }
}

/** Build check-run copy from a finished review comment body. */
export function reviewCheckOutput(message: string): {
  readonly summary: string;
  readonly title: string;
  readonly text: string;
} {
  const verdict = extractVerdict(message);
  return {
    title: verdict ? `Verdict: ${verdict}` : "Review complete",
    summary: verdict
      ? `Curl finished with verdict **${verdict}**. Full findings are in the PR comment and below.`
      : "Curl finished reviewing. Full findings are in the PR comment and below.",
    text: message,
  };
}

/**
 * Whether a timeline/review comment should dispatch a bot turn.
 * Mirrors eve's default mention gate closely enough for Curl.
 */
export function shouldDispatchBotMention(input: {
  readonly authorLogin?: string;
  readonly authorType?: string;
  readonly body: string;
  readonly botName: string;
}): boolean {
  const botName = input.botName.trim();
  if (!botName) {
    return false;
  }
  if (input.body.includes("<!-- eve:github:")) {
    return false;
  }
  if (input.authorType === "Bot") {
    return false;
  }
  const botLogin = `${botName}[bot]`.toLowerCase();
  if (input.authorLogin?.toLowerCase() === botLogin) {
    return false;
  }
  const mention = new RegExp(`@${escapeRegExp(botName)}(?=$|[^A-Za-z0-9_-])`, "iu");
  return mention.test(input.body);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
