import { describe, expect, test } from "bun:test";
import {
  DEFAULT_REVIEW_POLICY,
  parsePolicyDocument,
  parseReviewCandidate,
  type ReviewCandidate,
  type ReviewContext,
  type ReviewFinding,
  renderReview,
  validateReview,
} from "../agent/lib/review-contract";
import { createReviewWorkflow, type ReviewChannel } from "../agent/lib/review-workflow";

const finding: ReviewFinding = {
  category: "security" as const,
  confidence: "high" as const,
  evidence: "The changed request path passes user-controlled input directly to the shell.",
  fix: "Pass the value as a non-shell argument and validate the accepted command set.",
  impact: "An attacker can execute commands with the review service account privileges.",
  path: "src/runner.ts",
  endLine: 12,
  severity: "high" as const,
  startLine: 12,
  title: "User input reaches the shell",
};

const context: ReviewContext = {
  changedFiles: [{ path: "src/runner.ts", changedLines: [10, 11, 12, 13] }],
  policy: DEFAULT_REVIEW_POLICY,
};

describe("review contract", () => {
  test("accepts an explicitly empty review", () => {
    const candidate = parseReviewCandidate(
      JSON.stringify({
        findings: [],
        notes: [],
        scrutinizedPaths: [],
        verdict: "clean",
        version: 1,
      }),
    );

    if (!candidate) {
      throw new Error("expected an empty review candidate");
    }
    expect(validateReview(candidate, context)).toEqual({
      ok: true,
      review: {
        findings: [],
        notes: [],
        requiredChecks: [],
        verdict: "clean",
      },
    });
  });

  test("rejects malformed and out-of-diff findings", () => {
    expect(parseReviewCandidate("{}")).toBeNull();

    const candidate = validCandidate({
      path: "src/other.ts",
    });
    expect(validateReview(candidate, context)).toEqual({
      ok: false,
      reason: "invalid-semantic-content",
    });
  });

  test("filters generated noise but retains security findings", () => {
    const candidate = validCandidate({
      category: "correctness",
      path: "generated/client.ts",
    });
    const generatedContext: ReviewContext = {
      ...context,
      changedFiles: [{ path: "generated/client.ts", changedLines: [12] }],
      policy: {
        ...DEFAULT_REVIEW_POLICY,
        generatedPaths: ["generated/**"],
      },
    };

    expect(validateReview(candidate, generatedContext)).toMatchObject({
      ok: true,
      review: { findings: [], verdict: "clean" },
    });

    expect(
      validateReview(
        validCandidate({ category: "security", path: "generated/client.ts" }),
        generatedContext,
      ),
    ).toMatchObject({
      ok: true,
      review: { findings: [expect.objectContaining({ category: "security" })] },
    });
  });

  test("deduplicates and orders findings before rendering", () => {
    const candidate: ReviewCandidate = {
      findings: [
        finding,
        { ...finding, title: "User input reaches the shell" },
        {
          ...finding,
          category: "correctness",
          confidence: "medium",
          severity: "medium",
          title: "A second concrete defect",
        },
      ],
      notes: [],
      scrutinizedPaths: [],
      verdict: "findings",
      version: 1,
    };
    const result = validateReview(candidate, context);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.review.findings).toHaveLength(2);
    expect(renderReview(result.review)).toMatch(/### High[\s\S]*### Medium/);
  });

  test("fails closed for malformed policy and reports unavailable checks", () => {
    expect(parsePolicyDocument('{"version":1,"generatedPaths":["../src/**"]}')).toBeNull();

    const candidate = validCandidate();
    const result = validateReview(candidate, {
      ...context,
      policy: {
        ...DEFAULT_REVIEW_POLICY,
        requiredChecks: ["build"],
      },
    });
    expect(result).toMatchObject({
      ok: true,
      review: {
        requiredChecks: [{ name: "build", status: "unknown" }],
        notes: ["Required checks: build=unknown."],
      },
    });
  });

  test("requires and reports an extra-scrutiny pass", () => {
    const policyContext: ReviewContext = {
      ...context,
      policy: {
        ...DEFAULT_REVIEW_POLICY,
        extraScrutinyPaths: ["src/**"],
      },
    };
    expect(validateReview(validCandidate(), policyContext)).toEqual({
      ok: false,
      reason: "invalid-semantic-content",
    });

    const result = validateReview(
      { ...validCandidate(), scrutinizedPaths: ["src/runner.ts"] },
      policyContext,
    );
    expect(result).toMatchObject({
      ok: true,
      review: { notes: ["Additional scrutiny completed for: src/runner.ts."] },
    });
  });

  test("posts a controlled failure instead of arbitrary PR output", async () => {
    const posted: string[] = [];
    const workflow = createReviewWorkflow({ botName: "anturno-curl" });

    await workflow.handle({
      auth: null,
      channel: mockChannel(posted),
      finishReason: "stop",
      message: "The code looks good.",
      type: "message.completed",
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("could not validate");
    expect(posted[0]).not.toContain("The code looks good.");
  });

  test("renders one validated summary for a PR", async () => {
    const posted: string[] = [];
    const workflow = createReviewWorkflow({ botName: "anturno-curl" });

    await workflow.handle({
      auth: null,
      channel: mockChannel(posted),
      finishReason: "stop",
      message: JSON.stringify(validCandidate()),
      type: "message.completed",
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("## Curl review");
    expect(posted[0]).toContain("User input reaches the shell");
  });
});

function validCandidate(overrides: Partial<typeof finding> = {}): ReviewCandidate {
  return {
    findings: [{ ...finding, ...overrides }],
    notes: [],
    scrutinizedPaths: [],
    verdict: "findings",
    version: 1,
  };
}

function mockChannel(posted: string[]): ReviewChannel {
  return {
    github: {
      request: async ({ path }: { readonly path: string }) => {
        if (path.includes("/pulls/23")) {
          return {
            body: { base: { sha: "base-sha" }, head: { sha: "head-sha" } },
            ok: true,
            status: 200,
          };
        }
        if (path.includes("/compare/")) {
          return {
            body: {
              files: [
                {
                  filename: "src/runner.ts",
                  patch: "@@ -11,2 +11,3 @@\n context\n+changed\n context",
                },
              ],
            },
            ok: true,
            status: 200,
          };
        }
        if (path.includes("/contents/")) {
          throw { status: 404 };
        }
        return { body: { check_runs: [] }, ok: true, status: 200 };
      },
    },
    state: {
      baseRef: "main",
      baseSha: "base-sha",
      checkoutPath: null,
      conversationKind: "pull_request",
      defaultBranch: "main",
      headRef: "feature",
      headSha: "head-sha",
      installationId: 1,
      issueNumber: 23,
      owner: "anturno",
      pullRequestNumber: 23,
      repo: "curl",
      repositoryId: 1,
      reviewCommentId: null,
      reviewThreadRootCommentId: null,
      triggeringCommentId: 1,
      triggeringUserLogin: "author",
    },
    thread: {
      post: async (message: string) => {
        posted.push(message);
        return { id: 1, raw: {}, htmlUrl: undefined, url: undefined };
      },
    },
    // The channel mock implements only the runtime fields exercised by this workflow.
  };
}
