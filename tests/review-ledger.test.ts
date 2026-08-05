import { expect, spyOn, test } from "bun:test";
import { ReviewLedger, summarizeReviewMessage } from "../agent/lib/review-ledger";

test("summarizes severity bullets without counting notes", () => {
  expect(
    summarizeReviewMessage(
      [
        "### Critical",
        "- Critical finding",
        "",
        "### High",
        "- High finding one",
        "- High finding two",
        "",
        "### Notes",
        "- This note is not a finding",
      ].join("\n"),
    ),
  ).toEqual({
    findingCount: 3,
    severityCounts: { Critical: 1, High: 2, Medium: 0 },
  });
});

test("keeps a bounded source-free outcome ledger", () => {
  const ledger = new ReviewLedger(1);
  const info = spyOn(console, "info").mockImplementation(() => undefined);

  try {
    ledger.record({
      delivered: true,
      durationMs: 12.4,
      findingCount: 2,
      pullRequestNumber: 42,
      repository: " Acme/Widgets ",
      reviewedHeadSha: "A".repeat(40),
      severityCounts: { Critical: 0, High: 2, Medium: 0 },
      stale: false,
    });
    ledger.record({
      delivered: false,
      durationMs: null,
      findingCount: 0,
      pullRequestNumber: 43,
      repository: "Acme/Widgets",
      reviewedHeadSha: "bad",
      severityCounts: { Critical: 0, High: 0, Medium: 0 },
      stale: null,
    });
  } finally {
    info.mockRestore();
  }

  expect(ledger.snapshot()).toEqual([
    {
      delivered: false,
      durationMs: null,
      findingCount: 0,
      pullRequestNumber: 43,
      repository: "Acme/Widgets",
      reviewedHeadSha: null,
      severityCounts: { Critical: 0, High: 0, Medium: 0 },
      stale: null,
    },
  ]);
});
