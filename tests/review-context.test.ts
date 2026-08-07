import { describe, expect, test } from "bun:test";
import {
  buildReviewContextMessage,
  loadReviewContext,
  type ReviewGitHubReader,
} from "../agent/lib/review-context";
import { DEFAULT_REVIEW_POLICY, parsePolicyDocument } from "../agent/lib/review-contract";

describe("review context loading", () => {
  test("loads the policy and diff from the pull request base and reviewed head", async () => {
    const requested: string[] = [];
    const reader: ReviewGitHubReader = {
      request: async ({ path }) => {
        requested.push(path);
        if (path.includes("/pulls/23")) {
          return {
            body: {
              base: { sha: "base-sha" },
              head: { sha: "head-sha" },
            },
          };
        }
        if (path.includes("/compare/")) {
          return {
            body: {
              files: [
                {
                  filename: "src/review.ts",
                  patch: "@@ -1,0 +1,1 @@\n+const changed = true;",
                },
              ],
            },
          };
        }
        if (path.includes("/contents/")) {
          return {
            body: {
              content: Buffer.from(
                JSON.stringify({
                  version: 1,
                  minimumPublicationSeverity: "high",
                }),
              ).toString("base64"),
            },
          };
        }
        return { body: { check_runs: [] } };
      },
    };

    const context = await loadReviewContext({
      github: reader,
      state: {
        baseSha: null,
        headSha: null,
        owner: "anturno",
        pullRequestNumber: 23,
        repo: "curl",
      },
    });

    expect(context.policy.minimumPublicationSeverity).toBe("high");
    expect(context.changedFiles).toEqual([{ path: "src/review.ts", changedLines: [1] }]);
    expect(requested).toContain(
      "/repos/anturno/curl/contents/.curl/review-policy.json?ref=base-sha",
    );
    expect(requested).toContain("/repos/anturno/curl/compare/base-sha...head-sha");
    expect(requested).not.toContain(
      "/repos/anturno/curl/contents/.curl/review-policy.json?ref=head-sha",
    );
    expect(
      buildReviewContextMessage({
        ...context,
        policy: { ...context.policy, frameworks: ["Eve"], languages: ["TypeScript"] },
      }),
    ).toContain('"frameworks":["Eve"]');
  });

  test("uses safe defaults for missing or malformed policy", async () => {
    expect(parsePolicyDocument("x".repeat(65_537))).toBeNull();

    const missing = await loadReviewContext({
      github: readerThatThrows({ status: 404 }),
      state: {
        baseSha: "base-sha",
        headSha: "head-sha",
        owner: "anturno",
        pullRequestNumber: 23,
        repo: "curl",
      },
    });
    expect(missing.policy).toEqual(DEFAULT_REVIEW_POLICY);
    expect(missing.policyStatus).toBe("missing");

    const malformed = await loadReviewContext({
      github: readerThatReturns({
        "/pulls/23": { base: { sha: "base-sha" }, head: { sha: "head-sha" } },
        "/compare/": { files: [] },
        "/contents/": { content: Buffer.from('{"version":2}').toString("base64") },
        "check-runs": { check_runs: [] },
      }),
      state: {
        baseSha: "base-sha",
        headSha: "head-sha",
        owner: "anturno",
        pullRequestNumber: 23,
        repo: "curl",
      },
    });
    expect(malformed.policy).toEqual(DEFAULT_REVIEW_POLICY);
    expect(malformed.policyStatus).toBe("invalid");
  });

  test("keeps only check evidence for the reviewed head", async () => {
    const context = await loadReviewContext({
      github: readerThatReturns({
        "/pulls/23": { base: { sha: "base-sha" }, head: { sha: "head-sha" } },
        "/compare/": { files: [] },
        "/contents/": { content: Buffer.from('{"version":1}').toString("base64") },
        "check-runs": {
          check_runs: [
            { name: "typecheck", conclusion: "success", head_sha: "head-sha" },
            { name: "stale", conclusion: "success", head_sha: "old-sha" },
          ],
        },
      }),
      state: {
        baseSha: "base-sha",
        headSha: "head-sha",
        owner: "anturno",
        pullRequestNumber: 23,
        repo: "curl",
      },
    });

    expect(context.checks).toEqual([{ name: "typecheck", status: "passed" }]);
  });

  test("marks duplicate check names as ambiguous", async () => {
    const context = await loadReviewContext({
      github: readerThatReturns({
        "/pulls/23": { base: { sha: "base-sha" }, head: { sha: "head-sha" } },
        "/compare/": { files: [] },
        "/contents/": { content: Buffer.from('{"version":1}').toString("base64") },
        "check-runs": {
          check_runs: [
            { name: "test", conclusion: "success", head_sha: "head-sha" },
            { name: "test", conclusion: "failure", head_sha: "head-sha" },
          ],
        },
      }),
      state: {
        baseSha: "base-sha",
        headSha: "head-sha",
        owner: "anturno",
        pullRequestNumber: 23,
        repo: "curl",
      },
    });

    expect(context.checks).toEqual([{ name: "test", status: "unknown" }]);
  });

  test("reports only authoritative check conclusions", async () => {
    const context = await loadReviewContext({
      github: readerThatReturns({
        "/pulls/23": { base: { sha: "base-sha" }, head: { sha: "head-sha" } },
        "/compare/": { files: [] },
        "/contents/": { content: Buffer.from('{"version":1}').toString("base64") },
        "check-runs": {
          check_runs: [
            { name: "passed", conclusion: "success", head_sha: "head-sha" },
            { name: "failed", conclusion: "failure", head_sha: "head-sha" },
            { name: "skipped", conclusion: "skipped", head_sha: "head-sha" },
            { name: "stale", conclusion: "stale", head_sha: "head-sha" },
          ],
        },
      }),
      state: {
        baseSha: "base-sha",
        headSha: "head-sha",
        owner: "anturno",
        pullRequestNumber: 23,
        repo: "curl",
      },
    });

    expect(context.checks).toEqual([
      { name: "passed", status: "passed" },
      { name: "failed", status: "failed" },
      { name: "skipped", status: "unknown" },
      { name: "stale", status: "unknown" },
    ]);
  });
});

function readerThatThrows(error: unknown): ReviewGitHubReader {
  return {
    request: async ({ path }) => {
      if (path.includes("/pulls/23")) {
        return {
          body: {
            base: { sha: "base-sha" },
            head: { sha: "head-sha" },
          },
        };
      }
      if (path.includes("/compare/")) {
        return { body: { files: [] } };
      }
      if (path.includes("check-runs")) {
        return { body: { check_runs: [] } };
      }
      throw error;
    },
  };
}

function readerThatReturns(responses: Readonly<Record<string, unknown>>): ReviewGitHubReader {
  return {
    request: async ({ path }) => {
      const response = Object.entries(responses).find(([key]) => path.includes(key));
      return { body: response?.[1] ?? {} };
    },
  };
}
