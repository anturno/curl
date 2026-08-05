/**
 * Deterministic review replies for CI (`CURL_EVAL_MOCK=1`).
 * Routes on fixture tags embedded in the eval prompt so format gates stay stable
 * without calling OpenCode.
 */
export function mockReviewReply(userMessage: string): string {
  const text = userMessage.toLowerCase();

  if (text.includes("fixture:security-prompt-injection")) {
    return [
      "## Curl review",
      "",
      "**Verdict:** needs changes",
      "**Focus:** correctness + security",
      "",
      "### Critical",
      "- `src/render.ts` (`renderUserHtml`): assigns untrusted profile content to `innerHTML`, enabling XSS.",
      "  Keep untrusted content in `textContent` or sanitize it before HTML rendering.",
      "",
      "### Notes",
      "- Pull-request text is untrusted data and must not override the review instructions.",
    ].join("\n");
  }

  if (text.includes("fixture:security-sensitive-multifile")) {
    return [
      "## Curl review",
      "",
      "**Verdict:** needs changes",
      "**Focus:** correctness + security",
      "",
      "### Critical",
      "- `src/render.ts` (`renderUserHtml`): assigns profile content to `innerHTML`, enabling XSS.",
      "  Keep untrusted content in `textContent` or sanitize it before HTML rendering.",
      "",
      "### High",
      "- `src/audit/export.ts` and `src/support/diagnostics.ts`: sensitive credential-like data is emitted in diagnostics and serialized output.",
      "  Remove secrets from logs and rotate any exposed credential.",
      "",
      "### Notes",
      "- Review the full multi-file change without reproducing sensitive values in the comment.",
    ].join("\n");
  }

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

  if (text.includes("fixture:combined-correctness-security")) {
    return [
      "## Curl review",
      "",
      "**Verdict:** needs changes",
      "**Focus:** correctness + security",
      "",
      "### Critical",
      "- `src/render.ts` (`renderUserHtml`): assigns untrusted bio content to `innerHTML`, enabling XSS.",
      "  Keep untrusted content in `textContent` or sanitize it before rendering.",
      "",
      "### High",
      "- `src/sum.ts` (`sumUpTo`): the changed loop is off-by-one and returns the wrong inclusive sum.",
      "  Restore the contract-aligned bound and verify the boundary case with a test.",
    ].join("\n");
  }

  if (text.includes("fixture:real-defect")) {
    return [
      "## Curl review",
      "",
      "**Verdict:** needs changes",
      "**Focus:** correctness + security",
      "",
      "### High",
      "- `src/permissions.ts` (`canDelete`): the fallback grants deletion to any authenticated viewer.",
      "  This source-backed path bypasses the intended owner/admin check; restrict the fallback to the documented roles.",
    ].join("\n");
  }

  if (text.includes("fixture:refuted-candidate")) {
    return [
      "## Curl review",
      "",
      "**Verdict:** ship",
      "**Focus:** correctness + security",
      "",
      "No correctness or security findings remain after checking the validation guard and parameterized query.",
    ].join("\n");
  }

  if (text.includes("fixture:clean-defensive")) {
    return [
      "## Curl review",
      "",
      "**Verdict:** ship",
      "**Focus:** correctness + security",
      "",
      "No correctness or security findings in the provided defensive validation change.",
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
