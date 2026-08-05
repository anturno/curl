import type { ReviewHeadStatus } from "./review-head";

export const REVIEW_COMMENT_MAX = 65_536;

export interface ReviewCheckOutput {
  readonly summary: string;
  readonly text: string;
  readonly title: string;
}

function extractVerdict(message: string): string | null {
  const match = /\*\*Verdict:\*\*\s*(.+)/i.exec(message);
  const verdict = match?.[1]?.trim();
  return verdict && verdict.length > 0 ? verdict : null;
}

function shortSha(sha: string): string {
  return sha.slice(0, 12);
}

/** Split long bodies the way GitHub comment limits require. */
export function splitCommentBody(body: string, maxLength = REVIEW_COMMENT_MAX): string[] {
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

/** Add an explicit historical warning rather than presenting old findings as current. */
export function annotateHistoricalReview(
  message: string,
  headStatus: ReviewHeadStatus | null,
): string {
  if (!headStatus?.stale || !headStatus.currentHeadSha) {
    return message;
  }
  return [
    message,
    "",
    `> **Historical review:** Curl reviewed commit \`${shortSha(headStatus.reviewedHeadSha)}\`, but this pull request now points to \`${shortSha(headStatus.currentHeadSha)}\`. These findings may not apply to the current head.`,
  ].join("\n");
}

/** Build check-run copy from a finished review comment body. */
export function reviewCheckOutput(
  message: string,
  headStatus: ReviewHeadStatus | null = null,
): ReviewCheckOutput {
  const verdict = extractVerdict(message);
  const title = verdict ? `Verdict: ${verdict}` : "Review complete";
  if (headStatus?.stale && headStatus.currentHeadSha) {
    return {
      title: `Historical — ${title}`,
      summary: `Curl reviewed commit **${shortSha(headStatus.reviewedHeadSha)}**, but the PR now points to **${shortSha(headStatus.currentHeadSha)}**. Findings may be stale; see the historical review comment below.`,
      text: message,
    };
  }
  return {
    title,
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
