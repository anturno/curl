import { describe, expect, test } from "bun:test";
import {
  DEFAULT_REVIEW_POLICY,
  parseReviewCandidate,
  type ReviewCandidate,
  type ReviewContext,
  type ReviewFinding,
  validateReview,
} from "../agent/lib/review-contract";

const changedFile = {
  path: "src/runner.ts",
  changedLines: [12],
  changedContent: [{ line: 12, content: "exec(userInput);" }],
} as const;

const finding: ReviewFinding = {
  category: "security",
  confidence: "high",
  evidence: "The changed sink calls `exec(userInput);` with attacker-controlled input.",
  fix: "Pass the value as a non-shell argument and validate the accepted command set.",
  impact: "An attacker can execute commands with the review service account privileges.",
  path: changedFile.path,
  rootCause: "User-controlled input reaches an executable shell sink.",
  endLine: 12,
  severity: "high",
  startLine: 12,
  title: "User input reaches the shell",
};

const baseContext: ReviewContext = {
  changedFiles: [changedFile],
  policy: DEFAULT_REVIEW_POLICY,
};

const candidate = (overrides: Partial<ReviewCandidate> = {}): ReviewCandidate => ({
  findings: [finding],
  notes: [],
  scrutiny: [],
  verdict: "findings",
  version: 1,
  ...overrides,
});

const scenarios: readonly {
  readonly name: string;
  readonly message: string;
  readonly context: ReviewContext;
  readonly expected: "accepted" | "invalid-schema" | "rejected";
  readonly expectedFindingCount?: number;
  readonly expectedNote?: string;
}[] = [
  {
    name: "valid finding",
    message: JSON.stringify(candidate()),
    context: baseContext,
    expected: "accepted",
    expectedFindingCount: 1,
  },
  {
    name: "invalid schema",
    message: JSON.stringify({ version: 1, verdict: "clean" }),
    context: baseContext,
    expected: "invalid-schema",
  },
  {
    name: "speculative finding is policy-filtered",
    message: JSON.stringify(candidate({ findings: [{ ...finding, confidence: "low" }] })),
    context: baseContext,
    expected: "accepted",
    expectedFindingCount: 0,
  },
  {
    name: "duplicate findings collapse",
    message: JSON.stringify(
      candidate({
        findings: [finding, { ...finding, title: "Same defect, different title" }],
      }),
    ),
    context: baseContext,
    expected: "accepted",
    expectedFindingCount: 1,
  },
  {
    name: "out-of-range finding is rejected",
    message: JSON.stringify(candidate({ findings: [{ ...finding, startLine: 13, endLine: 13 }] })),
    context: baseContext,
    expected: "rejected",
  },
  {
    name: "publication policy filters low severity",
    message: JSON.stringify(candidate({ findings: [{ ...finding, severity: "low" }] })),
    context: {
      ...baseContext,
      policy: { ...DEFAULT_REVIEW_POLICY, minimumPublicationSeverity: "high" },
    },
    expected: "accepted",
    expectedFindingCount: 0,
  },
  {
    name: "empty review is accepted",
    message: JSON.stringify(candidate({ findings: [], verdict: "clean" })),
    context: baseContext,
    expected: "accepted",
    expectedFindingCount: 0,
  },
  {
    name: "generated-file finding remains publishable",
    message: JSON.stringify(
      candidate({
        findings: [{ ...finding, path: "generated/client.ts" }],
        scrutiny: [
          {
            path: "generated/client.ts",
            evidence: [{ line: 12, content: "exec(userInput);" }],
            rationale: "Reviewed the generated shell sink `exec(userInput);` for security impact.",
          },
        ],
      }),
    ),
    context: {
      changedFiles: [
        {
          path: "generated/client.ts",
          changedLines: changedFile.changedLines,
          changedContent: changedFile.changedContent,
        },
      ],
      policy: {
        ...DEFAULT_REVIEW_POLICY,
        extraScrutinyPaths: ["generated/**"],
        generatedPaths: ["generated/**"],
      },
    },
    expected: "accepted",
    expectedFindingCount: 1,
  },
  {
    name: "security-sensitive extra scrutiny requires grounded evidence",
    message: JSON.stringify(
      candidate({
        scrutiny: [
          {
            path: changedFile.path,
            evidence: [{ line: 12, content: "exec(userInput);" }],
            rationale: "The sensitive sink `exec(userInput);` needs shell-safe handling.",
          },
        ],
      }),
    ),
    context: {
      ...baseContext,
      policy: {
        ...DEFAULT_REVIEW_POLICY,
        extraScrutinyPaths: ["src/**"],
        securitySensitivePaths: ["src/**"],
      },
    },
    expected: "accepted",
    expectedFindingCount: 1,
  },
  {
    name: "required-check evidence is preserved",
    message: JSON.stringify(candidate({ findings: [], verdict: "clean" })),
    context: {
      ...baseContext,
      checks: [{ name: "typecheck", status: "passed" }],
      policy: { ...DEFAULT_REVIEW_POLICY, requiredChecks: ["typecheck"] },
    },
    expected: "accepted",
    expectedFindingCount: 0,
    expectedNote: "Required checks: typecheck=passed.",
  },
];

describe("deterministic review fixtures", () => {
  for (const scenario of scenarios) {
    test(scenario.name, () => {
      const parsed = parseReviewCandidate(scenario.message);
      if (scenario.expected === "invalid-schema") {
        expect(parsed).toBeNull();
        return;
      }

      expect(parsed).not.toBeNull();
      if (!parsed) {
        return;
      }
      const result = validateReview(parsed, scenario.context);
      if (scenario.expected === "rejected") {
        expect(result.ok).toBe(false);
      } else {
        expect(result).toMatchObject({ ok: true });
        if (result.ok) {
          if (scenario.expectedFindingCount !== undefined) {
            expect(result.review.findings).toHaveLength(scenario.expectedFindingCount);
          }
          if (scenario.expectedNote !== undefined) {
            expect(result.review.notes).toContain(scenario.expectedNote);
          }
        }
      }
    });
  }
});
