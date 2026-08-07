export const REVIEW_COMMENT_MAX = 65_536;

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

/** Whether a timeline/review comment should dispatch a bot turn. */
export function shouldDispatchBotMention(input: {
  readonly authorLogin?: string;
  readonly authorType?: string;
  readonly body: string;
  readonly botName: string;
}): boolean {
  const botName = normalizeBotName(input.botName);
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

export function normalizeBotName(botName: string): string {
  return botName.trim().replace(/\[bot\]$/iu, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function failureComment(message: string, errorId: string | null): string {
  return [
    message,
    "",
    "Please try again, rephrase, or reach out if it keeps failing.",
    errorId ? `Error id: ${errorId}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
