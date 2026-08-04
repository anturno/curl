/**
 * Deterministic review replies for CI (`CURL_EVAL_MOCK=1`).
 * Routes on fixture tags embedded in the eval prompt so format gates stay stable
 * without calling OpenCode.
 */
export function mockReviewReply(userMessage: string): string {
  const text = userMessage.toLowerCase();

  if (text.includes("fixture:security")) {
    return [
      "## Curl review",
      "",
      "**Verdict:** needs changes",
      "**Focus:** correctness + security",
      "",
      "### Critical",
      "- `src/render.ts` (`renderUserHtml`): assigns unsanitized user input to `innerHTML`, enabling XSS.",
      "  Prefer `textContent` or a vetted sanitizer before HTML injection.",
      "",
      "### Notes",
      "- No other correctness issues in the provided diff.",
    ].join("\n");
  }

  if (text.includes("fixture:correctness")) {
    return [
      "## Curl review",
      "",
      "**Verdict:** needs changes",
      "**Focus:** correctness + security",
      "",
      "### High",
      "- `src/sum.ts` (`sumUpTo`): loop uses `i <= n` and seeds `total` incorrectly, off-by-one vs the documented inclusive sum.",
      "  Align the loop bound and initial value with the function contract / tests.",
    ].join("\n");
  }

  if (text.includes("fixture:clean")) {
    return [
      "## Curl review",
      "",
      "**Verdict:** ship",
      "**Focus:** correctness + security",
      "",
      "No correctness or security findings in the provided diff.",
    ].join("\n");
  }

  return [
    "## Curl review",
    "",
    "**Verdict:** ship",
    "**Focus:** correctness + security",
    "",
    "No correctness or security findings in the provided context.",
  ].join("\n");
}
