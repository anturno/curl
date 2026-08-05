export const REVIEW_LEDGER_SEVERITIES = ["Critical", "High", "Medium"] as const;

export type ReviewLedgerSeverity = (typeof REVIEW_LEDGER_SEVERITIES)[number];

export interface ReviewFindingSummary {
  readonly findingCount: number;
  readonly severityCounts: Readonly<Record<ReviewLedgerSeverity, number>>;
}

export interface ReviewLedgerEntry extends ReviewFindingSummary {
  readonly delivered: boolean;
  readonly durationMs: number | null;
  readonly pullRequestNumber: number | null;
  readonly repository: string;
  readonly reviewedHeadSha: string | null;
  readonly stale: boolean | null;
}

export function summarizeReviewMessage(message: string): ReviewFindingSummary {
  const severityCounts = {
    Critical: 0,
    High: 0,
    Medium: 0,
  } satisfies Record<ReviewLedgerSeverity, number>;
  const headings = [...message.matchAll(/^###\s+(Critical|High|Medium)\s*$/gimu)];

  for (const heading of headings) {
    const severityName = heading[1]?.toLowerCase();
    const severity =
      REVIEW_LEDGER_SEVERITIES.find((name) => name.toLowerCase() === severityName) ?? null;
    if (severity === null) {
      continue;
    }
    const sectionStart = (heading.index ?? 0) + heading[0].length;
    const remaining = message.slice(sectionStart);
    const nextHeading = /^###\s+/mu.exec(remaining);
    const section = remaining.slice(0, nextHeading?.index ?? remaining.length);
    const findingCount = section.match(/^[ \t]*-[ \t]+\S.*$/gmu)?.length ?? 0;
    severityCounts[severity] += findingCount;
  }

  return {
    findingCount: Object.values(severityCounts).reduce((total, count) => total + count, 0),
    severityCounts: Object.freeze(severityCounts),
  };
}

export class ReviewLedger {
  private readonly entries: ReviewLedgerEntry[] = [];

  constructor(private readonly maxEntries = 1_024) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new Error("Review ledger capacity must be a positive safe integer");
    }
  }

  record(input: ReviewLedgerEntry): void {
    const entry = normalizeEntry(input);
    this.entries.push(entry);
    while (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    try {
      globalThis.console.info("[curl] Review ledger", entry);
    } catch {
      // Ledger logging is best-effort and must not turn a review outcome into a failure.
    }
  }

  snapshot(): readonly ReviewLedgerEntry[] {
    return [...this.entries];
  }
}

export const reviewLedger = new ReviewLedger();

function normalizeEntry(input: ReviewLedgerEntry): ReviewLedgerEntry {
  const severityCounts = Object.freeze({
    Critical: safeCount(input.severityCounts.Critical),
    High: safeCount(input.severityCounts.High),
    Medium: safeCount(input.severityCounts.Medium),
  });
  return Object.freeze({
    delivered: input.delivered === true,
    durationMs: safeDuration(input.durationMs),
    findingCount: safeCount(input.findingCount),
    pullRequestNumber: safePositiveInteger(input.pullRequestNumber),
    repository: input.repository.trim().slice(0, 200),
    reviewedHeadSha: safeSha(input.reviewedHeadSha),
    severityCounts,
    stale: input.stale === null ? null : input.stale === true,
  });
}

function safeCount(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeDuration(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function safePositiveInteger(value: number | null): number | null {
  return value !== null && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function safeSha(value: string | null): string | null {
  return value && /^[0-9a-f]{7,64}$/iu.test(value) ? value.toLowerCase() : null;
}
