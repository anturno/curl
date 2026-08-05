import { describe, expect, spyOn, test } from "bun:test";
import type { GitHubEventContext, GitHubHandle, GitHubInboundContext } from "eve/channels/github";
import type { SessionAuthContext } from "eve/context";

const configEnvironment = {
  CURL_AUTO_REVIEW: process.env.CURL_AUTO_REVIEW,
  CURL_AUTO_REVIEW_ALLOWLIST: process.env.CURL_AUTO_REVIEW_ALLOWLIST,
  CURL_CHECK_RUN: process.env.CURL_CHECK_RUN,
  CURL_EVAL_MOCK: process.env.CURL_EVAL_MOCK,
  CURL_GITHUB_AUTH: process.env.CURL_GITHUB_AUTH,
  CURL_MAX_INPUT_TOKENS_PER_SESSION: process.env.CURL_MAX_INPUT_TOKENS_PER_SESSION,
  CURL_MAX_OUTPUT_TOKENS_PER_SESSION: process.env.CURL_MAX_OUTPUT_TOKENS_PER_SESSION,
  CURL_SESSION_TIMEOUT_MS: process.env.CURL_SESSION_TIMEOUT_MS,
  OPENCODE_MODEL_CONTEXT_WINDOW_TOKENS: process.env.OPENCODE_MODEL_CONTEXT_WINDOW_TOKENS,
};

// Load the validated module with a known allowlist so the matching branch is
// exercised without relying on a developer's shell or .env file.
process.env.CURL_AUTO_REVIEW = "1";
process.env.CURL_AUTO_REVIEW_ALLOWLIST = "Acme/Widgets, Other/Repo";
process.env.CURL_CHECK_RUN = "1";
process.env.CURL_GITHUB_AUTH = "connect";
process.env.CURL_MAX_INPUT_TOKENS_PER_SESSION = "1000000";
process.env.CURL_MAX_OUTPUT_TOKENS_PER_SESSION = "20000";
process.env.CURL_SESSION_TIMEOUT_MS = "604800000";
process.env.OPENCODE_MODEL_CONTEXT_WINDOW_TOKENS = "200000";

const configModule = await import("../agent/lib/config");
const githubFailureModule = await import("../agent/lib/github-failure");
const reviewCheckCompletionModule = await import("../agent/lib/review-check-completion");
const reviewCheckRunModule = await import("../agent/lib/review-check-run");
const reviewContentModule = await import("../agent/lib/review-content");
const reviewHeadModule = await import("../agent/lib/review-head");
const reviewLedgerModule = await import("../agent/lib/review-ledger");
const reviewWorkflowModule = await import("../agent/lib/review-workflow");
const runtimeDetectionModule = await import("../agent/lib/runtime-detection");
const agentRuntimeModule = await import("../agent/lib/agent-runtime");

// The imported modules snapshot validated configuration, so restore the process
// environment before the test cases run and avoid leaking values to other files.
for (const [name, value] of Object.entries(configEnvironment)) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

const {
  reviewConfig,
  loadReviewConfig,
  parsePositiveIntegerEnv,
  parseStrictBooleanEnv,
  isAutomaticReviewAllowed,
} = configModule;
const { buildGitHubFailureContext, logGitHubFailure } = githubFailureModule;
const { completeReviewCheckRun, completeReviewCheckRunIfOpen, ReviewCompletionCoordinator } =
  reviewCheckCompletionModule;
const {
  findReviewCheckRunForChannel,
  reviewCheckRunFromAuth,
  startReviewCheckRun,
  withReviewCheckRun,
} = reviewCheckRunModule;
const { annotateHistoricalReview, reviewCheckOutput, shouldDispatchBotMention, splitCommentBody } =
  reviewContentModule;
const { resolvePullRequestHeadSha, resolveReviewHeadStatus } = reviewHeadModule;
const { reviewLedger } = reviewLedgerModule;
const { createReviewWorkflow } = reviewWorkflowModule;
const { detectRuntime } = runtimeDetectionModule;
const { createAgentDefinition } = agentRuntimeModule;

type GitHubRequest = Parameters<GitHubHandle["request"]>[0];
type FakeResponse = Awaited<ReturnType<GitHubHandle["request"]>>;
type FakeResponseFactory = (
  request: GitHubRequest,
  index: number,
) => FakeResponse | Promise<FakeResponse>;

const repository = {
  fullName: "Acme/Widgets",
  id: 88_001,
  name: "Widgets",
  owner: "Acme",
  private: true,
};

function fakeGitHub(
  bodies: readonly unknown[] = [],
  responseFactory?: FakeResponseFactory,
): { readonly github: GitHubHandle; readonly requests: GitHubRequest[] } {
  const requests: GitHubRequest[] = [];
  const github = {
    installationId: undefined,
    repository,
    async request(input: GitHubRequest): Promise<FakeResponse> {
      const index = requests.push(input) - 1;
      if (responseFactory) {
        return responseFactory(input, index);
      }
      return {
        body: bodies[index],
        ok: true,
        status: 200,
      };
    },
    // GitHubHandle.request is generic over the response body; the fake routes
    // untyped fixture bodies, so a cast is the narrowest test-boundary.
  } as GitHubHandle;
  return { github, requests };
}

let nextCheckRunId = 810_000;

function uniqueCheckRun(): { readonly headSha: string; readonly id: number } {
  const id = nextCheckRunId++;
  return {
    headSha: id.toString(16).padStart(40, "0"),
    id,
  };
}

function fakeChannel(github: GitHubHandle): GitHubEventContext {
  return {
    conversation: {
      issueNumber: 42,
      kind: "pull_request",
      pullRequestNumber: 42,
    },
    continuationToken: "session-token",
    github,
    repository,
    setContinuationToken: () => undefined,
    state: {
      baseRef: "main",
      baseSha: "b".repeat(40),
      checkoutPath: null,
      conversationKind: "pull_request",
      defaultBranch: "main",
      headRef: "feature/review",
      headSha: "a".repeat(40),
      installationId: 123,
      issueNumber: 42,
      owner: "Acme",
      pullRequestNumber: 42,
      repo: "Widgets",
      repositoryId: repository.id,
      reviewCommentId: null,
      reviewThreadRootCommentId: null,
      triggeringCommentId: 901,
      triggeringUserLogin: "reviewer",
    },
    thread: {
      kind: "pull_request",
      post: async () => ({
        htmlUrl: undefined,
        id: 902,
        raw: {},
        url: undefined,
      }),
      react: async () => undefined,
    },
  };
}

function fakeChannelWithPosts(github: GitHubHandle): {
  readonly channel: GitHubEventContext;
  readonly posts: string[];
} {
  const sourceChannel = fakeChannel(github);
  const posts: string[] = [];
  return {
    channel: {
      ...sourceChannel,
      thread: {
        ...sourceChannel.thread,
        post: async (body: string) => {
          posts.push(body);
          return {
            htmlUrl: undefined,
            id: 903,
            raw: {},
            url: undefined,
          };
        },
      },
    } as GitHubEventContext,
    posts,
  };
}

function fakeInboundContext(github: GitHubHandle): GitHubInboundContext {
  const channel = fakeChannel(github);
  return {
    conversation: channel.conversation,
    delivery: {
      event: "issue_comment",
      hookId: undefined,
      id: "delivery-1",
    },
    github,
    repository,
    sender: {
      htmlUrl: undefined,
      id: 77,
      login: "reviewer",
      type: "User",
      url: undefined,
    },
    thread: channel.thread,
  };
}

const baseAuth: SessionAuthContext = {
  attributes: {
    repository: "Acme/Widgets",
  },
  authenticator: "github-webhook",
  issuer: "github:Acme",
  principalId: "github:77",
  principalType: "user",
  subject: "reviewer",
};

describe("validated configuration helpers", () => {
  test("parse only documented boolean spellings", () => {
    expect(parseStrictBooleanEnv("FLAG", undefined, true)).toBe(true);
    expect(parseStrictBooleanEnv("FLAG", "1", false)).toBe(true);
    expect(parseStrictBooleanEnv("FLAG", "true", false)).toBe(true);
    expect(parseStrictBooleanEnv("FLAG", "0", true)).toBe(false);
    expect(parseStrictBooleanEnv("FLAG", "false", true)).toBe(false);

    for (const value of ["TRUE", "False", "yes", "", " true", "false "]) {
      expect(() => parseStrictBooleanEnv("FLAG", value, false)).toThrow(/FLAG/);
    }
  });

  test("rejects non-decimal, zero, unsafe, and over-limit numbers", () => {
    expect(parsePositiveIntegerEnv("LIMIT", undefined, 7)).toBe(7);
    expect(parsePositiveIntegerEnv("LIMIT", "1", 7)).toBe(1);
    expect(parsePositiveIntegerEnv("LIMIT", "200000", 7, 200000)).toBe(200000);

    for (const value of ["0", "-1", "1.5", "1e3", "NaN", "", " 2", "2 "]) {
      expect(() => parsePositiveIntegerEnv("LIMIT", value, 7)).toThrow(/LIMIT/);
    }
    expect(() => parsePositiveIntegerEnv("LIMIT", "200001", 7, 200000)).toThrow(/200000/);
    expect(() => parsePositiveIntegerEnv("LIMIT", "9007199254740992", 7)).toThrow(/LIMIT/);
  });

  test("matches exact, case-insensitive owner/repo allowlist entries", () => {
    expect(reviewConfig.automaticReview.enabled).toBe(true);
    expect(reviewConfig.automaticReview.repositoryAllowlist).toEqual([
      "acme/widgets",
      "other/repo",
    ]);
    expect(isAutomaticReviewAllowed("acme", "widgets")).toBe(true);
    expect(isAutomaticReviewAllowed(" ACME ", " WIDGETS ")).toBe(true);
    expect(isAutomaticReviewAllowed("acme", "widgets-fork")).toBe(false);
    expect(isAutomaticReviewAllowed("acme/widgets", "ignored")).toBe(false);
    expect(isAutomaticReviewAllowed("acme", "widgets/extra")).toBe(false);
    expect(isAutomaticReviewAllowed("", "widgets")).toBe(false);
  });

  test("loads isolated immutable configuration without reading process globals", () => {
    const config = loadReviewConfig({
      CURL_AUTO_REVIEW: "false",
      CURL_AUTO_REVIEW_ALLOWLIST: "Acme/Service,acme/service",
      CURL_CHECK_RUN: "0",
      CURL_GITHUB_AUTH: "app",
      CURL_MAX_INPUT_TOKENS_PER_SESSION: "5",
      CURL_MAX_OUTPUT_TOKENS_PER_SESSION: "6",
      CURL_SESSION_TIMEOUT_MS: "7",
      OPENCODE_API_KEY: "configured",
      OPENCODE_MODEL: "custom-model",
      OPENCODE_MODEL_CONTEXT_WINDOW_TOKENS: "8",
    });

    expect(config).toEqual({
      automaticReview: {
        enabled: false,
        repositoryAllowlist: ["acme/service"],
      },
      github: {
        authMode: "app",
        checkRunsEnabled: false,
      },
      inference: {
        apiKeyConfigured: true,
        limits: {
          maxInputTokensPerSession: 5,
          maxOutputTokensPerSession: 6,
          sessionTimeoutMs: 7,
        },
        modelContextWindowTokens: 8,
        modelId: "custom-model",
      },
      evalMockEnabled: false,
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.inference.limits)).toBe(true);
  });
});

describe("Agent runtime composition", () => {
  test("builds a provider definition from injected configuration", () => {
    const definition = createAgentDefinition({
      argv: [],
      environment: {
        OPENCODE_API_KEY: "configured",
        OPENCODE_MODEL: "test-model",
      },
    });

    expect(definition.reasoning).toBe("high");
    expect(definition.modelContextWindowTokens).toBe(200_000);
    expect(definition.limits).toEqual({
      maxInputTokensPerSession: 1_000_000,
      maxOutputTokensPerSession: 20_000,
      sessionTimeoutMs: 604_800_000,
    });
    expect(definition.model).toBeDefined();
  });

  test("rejects the eval model in a production runtime", () => {
    expect(() =>
      createAgentDefinition({
        argv: [],
        environment: {
          CURL_EVAL_MOCK: "1",
          NODE_ENV: "production",
        },
      }),
    ).toThrow("CURL_EVAL_MOCK=1 is not allowed");
  });

  test("shares build and deployment classification across runtime consumers", () => {
    expect(
      detectRuntime({
        argv: ["eve", "build"],
        environment: {
          NODE_ENV: "production",
          VERCEL: "1",
          VERCEL_ENV: "production",
        },
      }),
    ).toEqual({
      isBuildProcess: true,
      isDeployedRuntime: false,
      isDeployedVercel: true,
      isDeploymentLike: true,
      isProductionRuntime: false,
    });
    expect(
      detectRuntime({
        argv: [],
        environment: { EVE_DEV: "1", NODE_ENV: "production" },
      }).isDeploymentLike,
    ).toBe(false);
  });
});

describe("GitHub review helper parsing", () => {
  test("filters bot mentions, loops, and malformed mention boundaries", () => {
    const input = {
      authorLogin: "reviewer",
      authorType: "User",
      botName: "anturno-curl",
    };
    expect(shouldDispatchBotMention({ ...input, body: "@anturno-curl please review" })).toBe(true);
    expect(shouldDispatchBotMention({ ...input, body: "Please @ANTURNO-CURL." })).toBe(true);
    expect(shouldDispatchBotMention({ ...input, body: "@anturno-curl-helper review" })).toBe(false);
    expect(shouldDispatchBotMention({ ...input, body: "please review this" })).toBe(false);
    expect(
      shouldDispatchBotMention({ ...input, body: "<!-- eve:github:turn --> @anturno-curl" }),
    ).toBe(false);
    expect(
      shouldDispatchBotMention({ ...input, authorType: "Bot", body: "@anturno-curl review" }),
    ).toBe(false);
    expect(
      shouldDispatchBotMention({
        ...input,
        authorLogin: "anturno-curl[bot]",
        body: "@anturno-curl review",
      }),
    ).toBe(false);
    expect(shouldDispatchBotMention({ ...input, botName: "", body: "@anturno-curl" })).toBe(false);
  });

  test("builds failure diagnostics from channel state and the persisted check", () => {
    const channel = fakeChannel(fakeGitHub().github);
    const checkRun = uniqueCheckRun();

    expect(buildGitHubFailureContext(channel, checkRun, "comment.post")).toEqual({
      checkId: checkRun.id,
      headSha: checkRun.headSha,
      operation: "comment.post",
      owner: "Acme",
      pullRequestNumber: 42,
      repo: "Widgets",
    });
    expect(buildGitHubFailureContext(channel, null, "comment.list")).toEqual({
      checkId: null,
      headSha: "a".repeat(40),
      operation: "comment.list",
      owner: "Acme",
      pullRequestNumber: 42,
      repo: "Widgets",
    });
  });

  test("splits long comments at readable boundaries and hard limits", () => {
    expect(splitCommentBody("  preserve whitespace  ", 100)).toEqual(["  preserve whitespace  "]);
    expect(splitCommentBody("one two\nthree four\nfive", 10)).toEqual([
      "one two",
      "three four",
      "five",
    ]);
    expect(splitCommentBody("0123456789abcdef", 5)).toEqual(["01234", "56789", "abcde", "f"]);

    const chunks = splitCommentBody("word ".repeat(30), 12);
    expect(chunks.every((chunk) => chunk.length <= 12)).toBe(true);
    expect(chunks.every((chunk) => chunk.length > 0)).toBe(true);
  });

  test("parses verdict output and marks historical findings explicitly", () => {
    const message = [
      "## Curl review",
      "",
      "**Verdict:** needs changes",
      "",
      "### High",
      "- Fix the unsafe boundary.",
    ].join("\n");
    expect(reviewCheckOutput(message)).toEqual({
      summary:
        "Curl finished with verdict **needs changes**. Full findings are in the PR comment and below.",
      text: message,
      title: "Verdict: needs changes",
    });
    expect(reviewCheckOutput("## Curl review\nNo verdict here.")).toEqual({
      summary: "Curl finished reviewing. Full findings are in the PR comment and below.",
      text: "## Curl review\nNo verdict here.",
      title: "Review complete",
    });

    const headStatus = {
      currentHeadSha: "1234567890abcdef1234567890abcdef12345678",
      reviewedHeadSha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
      stale: true,
    } as const;
    const historical = annotateHistoricalReview(message, headStatus);
    expect(historical).toContain(
      "> **Historical review:** Curl reviewed commit `abcdefabcdef`, but this pull request now points to `1234567890ab`.",
    );
    expect(reviewCheckOutput(message, headStatus)).toEqual({
      summary:
        "Curl reviewed commit **abcdefabcdef**, but the PR now points to **1234567890ab**. Findings may be stale; see the historical review comment below.",
      text: message,
      title: "Historical — Verdict: needs changes",
    });
    expect(annotateHistoricalReview(message, { ...headStatus, stale: false })).toBe(message);
    expect(annotateHistoricalReview(message, null)).toBe(message);
  });

  test("carries only the check reference through durable auth attributes", () => {
    const checkRun = uniqueCheckRun();
    const nextAuth = withReviewCheckRun(baseAuth, checkRun);
    expect(nextAuth).not.toBe(baseAuth);
    expect(nextAuth.attributes).toMatchObject({
      repository: "Acme/Widgets",
    });
    expect(reviewCheckRunFromAuth(nextAuth)).toEqual(checkRun);
    expect(withReviewCheckRun(baseAuth, null)).toBe(baseAuth);

    const malformedAttributes: readonly Readonly<Record<string, string | readonly string[]>>[] = [
      {},
      { "curl:review-check-run-id": "1.5", "curl:review-check-run-sha": "abc" },
      { "curl:review-check-run-id": "0", "curl:review-check-run-sha": "abc" },
      {
        "curl:review-check-run-id": "999999999999999999999999",
        "curl:review-check-run-sha": "abc",
      },
      { "curl:review-check-run-id": "42", "curl:review-check-run-sha": "" },
      { "curl:review-check-run-id": "42", "curl:review-check-run-sha": ["abc"] },
    ];
    for (const attributes of malformedAttributes) {
      expect(reviewCheckRunFromAuth({ ...baseAuth, attributes })).toBeNull();
    }
    expect(reviewCheckRunFromAuth(null)).toBeNull();
    expect(reviewCheckRunFromAuth(undefined)).toBeNull();
  });
});

describe("Review workflow", () => {
  test("dispatches only eligible comments and carries the check run in auth", async () => {
    const checkRun = uniqueCheckRun();
    const { github, requests } = fakeGitHub([
      { head: { sha: checkRun.headSha } },
      { check_runs: [] },
      { id: checkRun.id },
    ]);
    const context = fakeInboundContext(github);
    const workflow = createReviewWorkflow({
      automaticReview: reviewConfig.automaticReview,
      botName: "anturno-curl",
    });

    const ignored = await workflow.dispatch({
      auth: baseAuth,
      comment: {
        author: context.sender,
        body: "@anturno-curl-helper review",
        htmlUrl: undefined,
        id: 901,
        raw: {},
        url: undefined,
      },
      context,
      type: "comment",
    });
    expect(ignored).toBeNull();
    expect(requests).toHaveLength(0);

    const dispatched = await workflow.dispatch({
      auth: baseAuth,
      comment: {
        author: context.sender,
        body: "@anturno-curl review",
        htmlUrl: undefined,
        id: 902,
        raw: {},
        url: undefined,
      },
      context,
      type: "comment",
    });
    expect(dispatched?.auth).toEqual(withReviewCheckRun(baseAuth, checkRun));
    expect(requests).toHaveLength(3);
  });

  test("dispatches eligible automatic pull requests with review context", async () => {
    const checkRun = uniqueCheckRun();
    const { github, requests } = fakeGitHub([{ check_runs: [] }, { id: checkRun.id }]);
    const context = fakeInboundContext(github);
    const workflow = createReviewWorkflow({
      automaticReview: reviewConfig.automaticReview,
      botName: "anturno-curl",
    });

    const result = await workflow.dispatch({
      auth: baseAuth,
      context,
      pullRequest: {
        action: "opened",
        headSha: checkRun.headSha,
        pullRequestNumber: 42,
        raw: {},
      },
      type: "pull_request",
    });

    expect(result?.auth).toEqual(withReviewCheckRun(baseAuth, checkRun));
    expect(result?.context).toEqual([
      "Automatic review for this repository. Run the default correctness + security review pack. Reply with one prioritized summary comment.",
    ]);
    expect(requests).toHaveLength(2);
  });

  test("keeps the exact check reference through a headless session failure", async () => {
    const checkRun = uniqueCheckRun();
    const { github, requests } = fakeGitHub([], async (request) => {
      if (request.method === "GET" && request.path.endsWith("/pulls/42")) {
        return { body: { head: { sha: checkRun.headSha } }, ok: true, status: 200 };
      }
      if (request.method === "GET" && request.path.includes("/commits/")) {
        return { body: { check_runs: [] }, ok: true, status: 200 };
      }
      if (request.method === "POST" && request.path.endsWith("/check-runs")) {
        return { body: { id: checkRun.id }, ok: true, status: 201 };
      }
      return { body: {}, ok: true, status: 200 };
    });
    const source = fakeChannelWithPosts(github);
    const channel = {
      ...source.channel,
      state: { ...source.channel.state, headSha: null },
    } satisfies GitHubEventContext;
    const workflow = createReviewWorkflow({
      automaticReview: reviewConfig.automaticReview,
      botName: "anturno-curl",
    });

    const dispatched = await workflow.dispatch({
      auth: baseAuth,
      comment: {
        author: {
          htmlUrl: undefined,
          id: 77,
          login: "reviewer",
          type: "User",
          url: undefined,
        },
        body: "@anturno-curl review",
        htmlUrl: undefined,
        id: 901,
        raw: {},
        url: undefined,
      },
      context: fakeInboundContext(github),
      type: "comment",
    });
    expect(dispatched?.auth).toEqual(withReviewCheckRun(baseAuth, checkRun));

    await workflow.handle({ channel, details: {}, type: "session.failed" });

    expect(source.posts).toHaveLength(1);
    expect(
      requests.filter(({ method, path }) => method === "GET" && path.includes("/commits/")),
    ).toHaveLength(1);
    expect(
      requests.filter(({ method, path }) => method === "PATCH" && path.includes("/check-runs/")),
    ).toHaveLength(1);
  });

  test("owns final comment delivery and check completion ordering", async () => {
    const checkRun = uniqueCheckRun();
    const { github, requests } = fakeGitHub([{ head: { sha: checkRun.headSha } }, [], {}]);
    const { channel, posts } = fakeChannelWithPosts(github);
    const workflow = createReviewWorkflow({
      automaticReview: reviewConfig.automaticReview,
      botName: "anturno-curl",
    });

    await workflow.handle({
      auth: withReviewCheckRun(baseAuth, checkRun),
      channel,
      finishReason: "stop",
      message: "## Curl review\\n\\n**Verdict:** ship",
      type: "message.completed",
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain("<!-- curl:review-summary -->");
    expect(posts[0]).toContain("**Verdict:** ship");
    expect(requests.map(({ method, path }) => ({ method, path }))).toEqual([
      { method: "GET", path: `/repos/Acme/Widgets/pulls/42` },
      {
        method: "GET",
        path: "/repos/Acme/Widgets/issues/42/comments?per_page=100&page=1",
      },
      { method: "PATCH", path: `/repos/Acme/Widgets/check-runs/${checkRun.id}` },
    ]);
  });

  test("updates only the bot-authored summary when a human spoofs the marker", async () => {
    const checkRun = uniqueCheckRun();
    const botCommentId = 904;
    const humanCommentId = 905;
    const summary = [
      "<!-- curl:review-summary -->",
      `<!-- curl:review-head:${checkRun.headSha} -->`,
      "",
      "Old summary",
    ].join("\\n");
    const { github, requests } = fakeGitHub([], async (request) => {
      if (request.method === "GET" && request.path.endsWith("/pulls/42")) {
        return { body: { head: { sha: checkRun.headSha } }, ok: true, status: 200 };
      }
      if (request.method === "GET" && request.path.includes("/issues/42/comments?")) {
        return {
          body: [
            { body: summary, id: humanCommentId, user: { login: "reviewer", type: "User" } },
            {
              body: summary,
              id: botCommentId,
              user: { login: "anturno-curl[bot]", type: "Bot" },
            },
          ],
          ok: true,
          status: 200,
        };
      }
      return { body: {}, ok: true, status: 200 };
    });
    const { channel, posts } = fakeChannelWithPosts(github);

    await createReviewWorkflow({
      automaticReview: reviewConfig.automaticReview,
      botName: "anturno-curl",
    }).handle({
      auth: withReviewCheckRun(baseAuth, checkRun),
      channel,
      finishReason: "stop",
      message: "## Curl review\\n\\n**Verdict:** ship",
      type: "message.completed",
    });

    expect(posts).toHaveLength(0);
    expect(requests.map(({ method, path }) => ({ method, path }))).toContainEqual({
      method: "PATCH",
      path: `/repos/Acme/Widgets/issues/comments/${botCommentId}`,
    });
    expect(requests.map(({ method, path }) => ({ method, path }))).not.toContainEqual({
      method: "PATCH",
      path: `/repos/Acme/Widgets/issues/comments/${humanCommentId}`,
    });
  });

  test("paginates issue comments until it finds the bot summary", async () => {
    const checkRun = uniqueCheckRun();
    const botCommentId = 1_001;
    const pageOne = Array.from({ length: 100 }, (_, index) => ({
      body: `Human comment ${index + 1}`,
      id: index + 1,
      user: { login: "reviewer", type: "User" },
    }));
    const pageTwo = [
      {
        body: `<!-- curl:review-summary -->\\n<!-- curl:review-head:${checkRun.headSha} -->`,
        id: botCommentId,
        user: { login: "anturno-curl[bot]", type: "Bot" },
      },
    ];
    const { github, requests } = fakeGitHub([], async (request) => {
      if (request.method === "GET" && request.path.endsWith("/pulls/42")) {
        return { body: { head: { sha: checkRun.headSha } }, ok: true, status: 200 };
      }
      if (request.method === "GET" && request.path.includes("/issues/42/comments?")) {
        const page = Number(/(?:\?|&)page=(\d+)/u.exec(request.path)?.[1] ?? "0");
        return {
          body: page === 1 ? pageOne : page === 2 ? pageTwo : [],
          ok: true,
          status: 200,
        };
      }
      return { body: {}, ok: true, status: 200 };
    });
    const { channel, posts } = fakeChannelWithPosts(github);

    await createReviewWorkflow({
      automaticReview: reviewConfig.automaticReview,
      botName: "anturno-curl",
    }).handle({
      auth: withReviewCheckRun(baseAuth, checkRun),
      channel,
      finishReason: "stop",
      message: "## Curl review\\n\\n**Verdict:** ship",
      type: "message.completed",
    });

    expect(posts).toHaveLength(0);
    expect(
      requests
        .filter(({ method, path }) => method === "GET" && path.includes("/comments?"))
        .map(({ path }) => path),
    ).toEqual([
      "/repos/Acme/Widgets/issues/42/comments?per_page=100&page=1",
      "/repos/Acme/Widgets/issues/42/comments?per_page=100&page=2",
    ]);
    expect(requests.map(({ method, path }) => ({ method, path }))).toContainEqual({
      method: "PATCH",
      path: `/repos/Acme/Widgets/issues/comments/${botCommentId}`,
    });
  });

  test("avoids creating a duplicate summary when a later comment page fails", async () => {
    const checkRun = uniqueCheckRun();
    const pageOne = Array.from({ length: 100 }, (_, index) => ({
      body: `Human comment ${index + 1}`,
      id: index + 1,
      user: { login: "reviewer", type: "User" },
    }));
    const { github, requests } = fakeGitHub([], async (request) => {
      if (request.method === "GET" && request.path.endsWith("/pulls/42")) {
        return { body: { head: { sha: checkRun.headSha } }, ok: true, status: 200 };
      }
      if (request.method === "GET" && request.path.includes("/issues/42/comments?")) {
        if (request.path.endsWith("page=2")) {
          throw Object.assign(new Error("comment page unavailable"), { status: 503 });
        }
        return { body: pageOne, ok: true, status: 200 };
      }
      return { body: {}, ok: true, status: 200 };
    });
    const { channel, posts } = fakeChannelWithPosts(github);
    const warning = spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await createReviewWorkflow({
        automaticReview: reviewConfig.automaticReview,
        botName: "anturno-curl",
      }).handle({
        auth: withReviewCheckRun(baseAuth, checkRun),
        channel,
        finishReason: "stop",
        message: `<!-- curl:review-summary -->\n<!-- curl:review-head:${"a".repeat(40)} -->\n\n## Curl review\n\n**Verdict:** ship`,
        type: "message.completed",
      });
    } finally {
      warning.mockRestore();
    }

    expect(posts).toHaveLength(1);
    expect(posts[0]).not.toContain("<!-- curl:review-summary -->");
    expect(
      requests.filter(
        ({ method, path }) => method === "PATCH" && path.includes("/issues/comments/"),
      ),
    ).toHaveLength(0);
  });

  test("does not update another-head summaries when the current head is unavailable", async () => {
    const checkRun = uniqueCheckRun();
    const existingCommentId = 1_008;
    const differentHeadSha = "b".repeat(40);
    const existingSummary = [
      "<!-- curl:review-summary -->",
      `<!-- curl:review-head:${differentHeadSha} -->`,
      "",
      "Different-head summary",
    ].join("\n");
    const { github, requests } = fakeGitHub([], async (request) => {
      if (request.method === "GET" && request.path.endsWith("/pulls/42")) {
        return { body: { head: null }, ok: true, status: 200 };
      }
      if (request.method === "GET" && request.path.includes("/issues/42/comments?")) {
        return {
          body: [
            {
              body: existingSummary,
              id: existingCommentId,
              user: { login: "anturno-curl[bot]", type: "Bot" },
            },
          ],
          ok: true,
          status: 200,
        };
      }
      return { body: {}, ok: true, status: 200 };
    });
    const { channel, posts } = fakeChannelWithPosts(github);
    const warning = spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await createReviewWorkflow({
        automaticReview: reviewConfig.automaticReview,
        botName: "anturno-curl",
      }).handle({
        auth: withReviewCheckRun(baseAuth, checkRun),
        channel,
        finishReason: "stop",
        message: "## Curl review\n\n**Verdict:** ship",
        type: "message.completed",
      });
    } finally {
      warning.mockRestore();
    }

    expect(posts).toHaveLength(1);
    expect(posts[0]).not.toContain("<!-- curl:review-summary -->");
    expect(
      requests.filter(
        ({ method, path }) => method === "PATCH" && path.includes("/issues/comments/"),
      ),
    ).toHaveLength(0);
  });

  test("keeps a missing reviewed head out of the canonical summary path", async () => {
    const { github } = fakeGitHub([[]]);
    const source = fakeChannelWithPosts(github);
    const channel = {
      ...source.channel,
      state: { ...source.channel.state, headSha: null },
    } satisfies GitHubEventContext;

    await createReviewWorkflow({
      automaticReview: reviewConfig.automaticReview,
      botName: "anturno-curl",
    }).handle({
      auth: baseAuth,
      channel,
      finishReason: "stop",
      message: "## Curl review\n\n**Verdict:** ship",
      type: "message.completed",
    });

    expect(source.posts).toHaveLength(1);
    expect(source.posts[0]).not.toContain("<!-- curl:review-summary -->");
  });

  test("posts stale findings without replacing the current-head summary", async () => {
    const checkRun = uniqueCheckRun();
    const currentHeadSha = "b".repeat(40);
    const existingCommentId = 1_003;
    const existingSummary = [
      "<!-- curl:review-summary -->",
      `<!-- curl:review-head:${currentHeadSha} -->`,
      "",
      "Current-head summary",
    ].join("\n");
    const { github, requests } = fakeGitHub([], async (request) => {
      if (request.method === "GET" && request.path.endsWith("/pulls/42")) {
        return { body: { head: { sha: currentHeadSha } }, ok: true, status: 200 };
      }
      if (request.method === "GET" && request.path.includes("/issues/42/comments?")) {
        return {
          body: [
            {
              body: existingSummary,
              id: existingCommentId,
              user: { login: "anturno-curl[bot]", type: "Bot" },
            },
          ],
          ok: true,
          status: 200,
        };
      }
      return { body: {}, ok: true, status: 200 };
    });
    const { channel, posts } = fakeChannelWithPosts(github);

    await createReviewWorkflow({
      automaticReview: reviewConfig.automaticReview,
      botName: "anturno-curl",
    }).handle({
      auth: withReviewCheckRun(baseAuth, checkRun),
      channel,
      finishReason: "stop",
      message: "## Curl review\n\n**Verdict:** needs changes",
      type: "message.completed",
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain("Historical review");
    expect(requests.map(({ method, path }) => ({ method, path }))).not.toContainEqual({
      method: "PATCH",
      path: `/repos/Acme/Widgets/issues/comments/${existingCommentId}`,
    });
  });

  test("records cancellation outcomes without review content", async () => {
    const checkRun = uniqueCheckRun();
    const { github } = fakeGitHub([{}]);
    const channel = fakeChannel(github);

    await createReviewWorkflow({
      automaticReview: reviewConfig.automaticReview,
      botName: "anturno-curl",
    }).handle({
      auth: withReviewCheckRun(baseAuth, checkRun),
      channel,
      type: "turn.cancelled",
    });

    expect(reviewLedger.snapshot().slice(-1)[0]).toMatchObject({
      delivered: false,
      findingCount: 0,
      pullRequestNumber: 42,
      repository: "Acme/Widgets",
      reviewedHeadSha: checkRun.headSha,
      stale: null,
    });
  });

  test("records one terminal outcome when failure events repeat", async () => {
    const checkRun = uniqueCheckRun();
    const { github } = fakeGitHub([{}, { check_runs: [] }]);
    const { channel, posts } = fakeChannelWithPosts(github);
    const workflow = createReviewWorkflow({
      automaticReview: reviewConfig.automaticReview,
      botName: "anturno-curl",
    });
    const before = reviewLedger.snapshot().length;

    await workflow.handle({
      auth: withReviewCheckRun(baseAuth, checkRun),
      channel,
      details: { errorId: "turn-failed" },
      type: "turn.failed",
    });
    await workflow.handle({
      channel,
      details: { errorId: "session-failed" },
      type: "session.failed",
    });

    expect(posts).toHaveLength(2);
    expect(reviewLedger.snapshot()).toHaveLength(before + 1);
  });

  test("retries an uneditable summary on the next review", async () => {
    const checkRun = uniqueCheckRun();
    const existingCommentId = 1_005;
    const existingSummary = [
      "<!-- curl:review-summary -->",
      `<!-- curl:review-head:${checkRun.headSha} -->`,
      "",
      "Old summary",
    ].join("\n");
    let updateAttempts = 0;
    const { github, requests } = fakeGitHub([], async (request) => {
      if (request.method === "GET" && request.path.endsWith("/pulls/42")) {
        return { body: { head: { sha: checkRun.headSha } }, ok: true, status: 200 };
      }
      if (request.method === "GET" && request.path.includes("/issues/42/comments?")) {
        return {
          body: [
            {
              body: existingSummary,
              id: existingCommentId,
              user: { login: "anturno-curl[bot]", type: "Bot" },
            },
          ],
          ok: true,
          status: 200,
        };
      }
      if (request.method === "PATCH" && request.path.includes("/issues/comments/")) {
        updateAttempts += 1;
        if (updateAttempts === 1) {
          throw Object.assign(new Error("comment temporarily unavailable"), { status: 403 });
        }
      }
      return { body: {}, ok: true, status: 200 };
    });
    const { channel, posts } = fakeChannelWithPosts(github);
    const workflow = createReviewWorkflow({
      automaticReview: reviewConfig.automaticReview,
      botName: "anturno-curl",
    });
    const warning = spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      for (let review = 0; review < 2; review += 1) {
        await workflow.handle({
          auth: withReviewCheckRun(baseAuth, checkRun),
          channel,
          finishReason: "stop",
          message: "## Curl review\n\n**Verdict:** ship",
          type: "message.completed",
        });
      }
    } finally {
      warning.mockRestore();
    }

    expect(posts).toHaveLength(1);
    expect(updateAttempts).toBe(2);
    expect(
      requests.filter(
        ({ method, path }) => method === "PATCH" && path.includes("/issues/comments/"),
      ),
    ).toHaveLength(2);
  });
});

describe("GitHub request helpers", () => {
  test("reuses an in-progress check run and uses the exact lookup path", async () => {
    const existingId = 820_001;
    const { github, requests } = fakeGitHub([
      {
        check_runs: [
          { id: "malformed" },
          { id: 0, status: "in_progress" },
          { id: existingId, status: "in_progress" },
        ],
      },
    ]);
    const checkRun = await startReviewCheckRun({
      github,
      headSha: "a".repeat(40),
      owner: "Acme",
      pullRequestNumber: 42,
      repo: "Widgets",
    });

    expect(checkRun).toEqual({ headSha: "a".repeat(40), id: existingId });
    expect(requests).toEqual([
      {
        method: "GET",
        path: "/repos/Acme/Widgets/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/check-runs?check_name=Curl%20review&status=in_progress&filter=latest",
      },
    ]);
  });

  test("creates a check run with the expected request body", async () => {
    const checkRun = uniqueCheckRun();
    const { github, requests } = fakeGitHub([{ check_runs: [] }, { id: checkRun.id }]);
    const result = await startReviewCheckRun({
      github,
      headSha: checkRun.headSha,
      owner: "Acme",
      pullRequestNumber: 42,
      repo: "Widgets",
    });

    expect(result).toEqual(checkRun);
    expect(requests).toEqual([
      {
        method: "GET",
        path: `/repos/Acme/Widgets/commits/${checkRun.headSha}/check-runs?check_name=Curl%20review&status=in_progress&filter=latest`,
      },
      {
        method: "POST",
        path: "/repos/Acme/Widgets/check-runs",
        body: {
          head_sha: checkRun.headSha,
          name: "Curl review",
          output: {
            summary: "Curl is reviewing this pull request for **correctness** and **security**.",
            title: "Review in progress",
          },
          status: "in_progress",
        },
      },
    ]);
  });

  test("degrades to no check run for permission errors and malformed responses", async () => {
    const denied = fakeGitHub([], async () => {
      throw Object.assign(new Error("do not log this secret"), { status: 403 });
    });
    expect(
      await startReviewCheckRun({
        github: denied.github,
        headSha: "c".repeat(40),
        owner: "Acme",
        pullRequestNumber: 42,
        repo: "Widgets",
      }),
    ).toBeNull();

    const malformedList = fakeGitHub([{ check_runs: {} }]);
    expect(
      await startReviewCheckRun({
        github: malformedList.github,
        headSha: "d".repeat(40),
        owner: "Acme",
        pullRequestNumber: 42,
        repo: "Widgets",
      }),
    ).toBeNull();

    const malformedCreate = fakeGitHub([], async (_request, index) =>
      index === 0
        ? { body: { check_runs: [] }, ok: true, status: 200 }
        : { body: { id: "not-a-number" }, ok: true, status: 201 },
    );
    expect(
      await startReviewCheckRun({
        github: malformedCreate.github,
        headSha: "e".repeat(40),
        owner: "Acme",
        pullRequestNumber: 42,
        repo: "Widgets",
      }),
    ).toBeNull();
  });

  test("resolves a PR head defensively and reports stale reviews", async () => {
    const valid = fakeGitHub([{ head: { sha: "f".repeat(40) } }]);
    await expect(resolvePullRequestHeadSha(valid.github, "Acme", "Widgets", 42)).resolves.toBe(
      "f".repeat(40),
    );
    expect(valid.requests).toEqual([
      {
        method: "GET",
        path: "/repos/Acme/Widgets/pulls/42",
      },
    ]);

    const malformed = fakeGitHub([{ head: { sha: 42 } }]);
    await expect(
      resolvePullRequestHeadSha(malformed.github, "Acme", "Widgets", 42),
    ).resolves.toBeNull();

    const status = await resolveReviewHeadStatus({
      checkId: 830_001,
      github: fakeGitHub([{ head: { sha: "1".repeat(40) } }]).github,
      owner: "Acme",
      pullRequestNumber: 42,
      repo: "Widgets",
      reviewedHeadSha: "2".repeat(40),
    });
    expect(status).toEqual({
      currentHeadSha: "1".repeat(40),
      reviewedHeadSha: "2".repeat(40),
      stale: true,
    });

    const unavailable = await resolveReviewHeadStatus({
      github: fakeGitHub([{ head: null }]).github,
      owner: "Acme",
      pullRequestNumber: 42,
      repo: "Widgets",
      reviewedHeadSha: "3".repeat(40),
    });
    expect(unavailable).toEqual({
      currentHeadSha: null,
      reviewedHeadSha: "3".repeat(40),
      stale: false,
    });
  });

  test("finds the persisted-head check run without switching to a newer PR head", async () => {
    const { github, requests } = fakeGitHub([{ check_runs: [{ id: 840_001 }] }]);
    const result = await findReviewCheckRunForChannel(fakeChannel(github));

    expect(result).toEqual({ headSha: "a".repeat(40), id: 840_001 });
    expect(requests[0]).toEqual({
      method: "GET",
      path: "/repos/Acme/Widgets/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/check-runs?check_name=Curl%20review&status=in_progress&filter=latest",
    });

    const missingHead = fakeChannel(fakeGitHub([{ check_runs: [{ id: 840_002 }] }]).github);
    missingHead.state.headSha = null;
    const missingResult = await findReviewCheckRunForChannel(missingHead);
    expect(missingResult).toBeNull();
  });
});

describe("Check Run completion lifecycle", () => {
  test("keeps completion authority isolated per coordinator instance", async () => {
    const first = new ReviewCompletionCoordinator();
    const second = new ReviewCompletionCoordinator();
    let calls = 0;

    await first.complete(42, true, async () => {
      calls += 1;
      return true;
    });
    await first.complete(42, false, async () => {
      calls += 1;
      return true;
    });
    await second.complete(42, false, async () => {
      calls += 1;
      return true;
    });

    expect(calls).toBe(2);
  });

  test("does not let turn.completed fallback overwrite authoritative final output", async () => {
    const checkRun = uniqueCheckRun();
    const { github, requests } = fakeGitHub([{}]);
    const channel = fakeChannel(github);
    const finalSummary = "Curl finished with verdict **needs changes**. Full findings are below.";
    const finalText = "## Curl review\n\n**Verdict:** needs changes\n\n- Detailed finding.";

    await completeReviewCheckRun(
      channel,
      {
        authoritative: true,
        conclusion: "neutral",
        summary: finalSummary,
        text: finalText,
        title: "Verdict: needs changes",
      },
      checkRun,
    );
    await completeReviewCheckRunIfOpen(
      channel,
      {
        authoritative: false,
        conclusion: "neutral",
        summary: "Curl finished. See the review comment on this pull request.",
        title: "Review complete",
      },
      checkRun,
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      method: "PATCH",
      path: `/repos/Acme/Widgets/check-runs/${checkRun.id}`,
      body: {
        conclusion: "neutral",
        output: {
          summary: finalSummary,
          text: finalText,
          title: "Verdict: needs changes",
        },
        status: "completed",
      },
    });
  });

  test("serializes a final and fallback race in favor of the final message", async () => {
    const checkRun = uniqueCheckRun();
    const { github, requests } = fakeGitHub([{}]);
    const channel = fakeChannel(github);
    const final = completeReviewCheckRun(
      channel,
      {
        authoritative: true,
        conclusion: "neutral",
        summary: "Authoritative summary",
        text: "Authoritative full review",
        title: "Verdict: ship",
      },
      checkRun,
    );
    const fallback = completeReviewCheckRunIfOpen(
      channel,
      {
        authoritative: false,
        conclusion: "neutral",
        summary: "Fallback summary",
        title: "Review complete",
      },
      checkRun,
    );
    await Promise.all([final, fallback]);

    expect(requests.filter((request) => request.method === "PATCH")).toHaveLength(1);
    expect(requests[0]?.body).toEqual({
      conclusion: "neutral",
      output: {
        summary: "Authoritative summary",
        text: "Authoritative full review",
        title: "Verdict: ship",
      },
      status: "completed",
    });
  });

  test("fallback closes an otherwise-open run, but skips an already-completed run", async () => {
    const openRun = uniqueCheckRun();
    const open = fakeGitHub([{ status: "in_progress" }, {}]);
    await completeReviewCheckRunIfOpen(
      fakeChannel(open.github),
      {
        conclusion: "neutral",
        summary: "Fallback summary",
        title: "Review complete",
      },
      openRun,
    );
    expect(open.requests).toEqual([
      {
        method: "GET",
        path: `/repos/Acme/Widgets/check-runs/${openRun.id}`,
      },
      {
        method: "PATCH",
        path: `/repos/Acme/Widgets/check-runs/${openRun.id}`,
        body: {
          conclusion: "neutral",
          output: {
            summary: "Fallback summary",
            title: "Review complete",
          },
          status: "completed",
        },
      },
    ]);

    const completedRun = uniqueCheckRun();
    const completed = fakeGitHub([{ status: "completed" }]);
    await completeReviewCheckRunIfOpen(
      fakeChannel(completed.github),
      {
        conclusion: "neutral",
        summary: "Should not replace completed output",
        title: "Review complete",
      },
      completedRun,
    );
    expect(completed.requests).toEqual([
      {
        method: "GET",
        path: `/repos/Acme/Widgets/check-runs/${completedRun.id}`,
      },
    ]);
  });

  test("patches after a status-read failure and swallows completion permission failures", async () => {
    const statusReadFails = fakeGitHub([], async (_request, index) => {
      if (index === 0) {
        throw Object.assign(new Error("response contains a credential"), { status: 403 });
      }
      return { body: {}, ok: true, status: 200 };
    });
    const checkRun = uniqueCheckRun();
    await expect(
      completeReviewCheckRunIfOpen(
        fakeChannel(statusReadFails.github),
        {
          conclusion: "failure",
          summary: "Could not finish the review.",
          title: "Review failed",
        },
        checkRun,
      ),
    ).resolves.toBeUndefined();
    expect(statusReadFails.requests.map(({ method, path }) => ({ method, path }))).toEqual([
      { method: "GET", path: `/repos/Acme/Widgets/check-runs/${checkRun.id}` },
      { method: "PATCH", path: `/repos/Acme/Widgets/check-runs/${checkRun.id}` },
    ]);

    const patchDenied = fakeGitHub([], async () => {
      throw Object.assign(new Error("do not expose this response body"), { status: 403 });
    });
    await expect(
      completeReviewCheckRun(
        fakeChannel(patchDenied.github),
        {
          conclusion: "failure",
          summary: "Permission degraded",
          title: "Review failed",
        },
        uniqueCheckRun(),
      ),
    ).resolves.toBeUndefined();
  });

  test("logs only safe failure metadata and ignores malformed status bodies", async () => {
    const warning = spyOn(console, "warn").mockImplementation(() => undefined);
    logGitHubFailure(
      {
        checkId: 850_001,
        headSha: "not-a-sha-secret",
        operation: "check-run.complete",
        owner: "Acme",
        pullRequestNumber: 42,
        repo: "Widgets",
      },
      {
        details: { errorId: "safe-id" },
        message: "contains a token and prompt that must not be logged",
        status: 500,
      },
    );
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning.mock.calls[0]?.[1]).toEqual({
      checkId: 850_001,
      errorId: "safe-id",
      headSha: null,
      operation: "check-run.complete",
      pullRequestNumber: 42,
      repository: "Acme/Widgets",
      status: 500,
    });
    warning.mockRestore();

    const malformedStatus = fakeGitHub([{ status: ["completed"] }, {}]);
    const checkRun = uniqueCheckRun();
    await completeReviewCheckRunIfOpen(
      fakeChannel(malformedStatus.github),
      {
        conclusion: "neutral",
        summary: "Close malformed status response",
        title: "Review complete",
      },
      checkRun,
    );
    expect(malformedStatus.requests[1]?.method).toBe("PATCH");
  });

  test("updates the bot summary on the final full page under the comment pagination cap", async () => {
    const checkRun = uniqueCheckRun();
    const summaryId = 10_000;
    const { github, requests } = fakeGitHub([], async (request) => {
      if (request.method === "GET" && request.path.endsWith("/pulls/42")) {
        return { body: { head: { sha: checkRun.headSha } }, ok: true, status: 200 };
      }
      if (request.method === "GET" && request.path.includes("/issues/42/comments?")) {
        const page = Number(/(?:\?|&)page=(\d+)/u.exec(request.path)?.[1] ?? "0");
        const body = Array.from({ length: 100 }, (_, index) => ({
          body: `Human comment ${(page - 1) * 100 + index + 1}`,
          id: (page - 1) * 100 + index + 1,
          user: { login: "reviewer", type: "User" },
        }));
        if (page === 100) {
          body[99] = {
            body: `<!-- curl:review-summary -->\n<!-- curl:review-head:${checkRun.headSha} -->`,
            id: summaryId,
            user: { login: "anturno-curl[bot]", type: "Bot" },
          };
        }
        return { body, ok: true, status: 200 };
      }
      return { body: {}, ok: true, status: 200 };
    });
    const { channel, posts } = fakeChannelWithPosts(github);

    await createReviewWorkflow({
      automaticReview: reviewConfig.automaticReview,
      botName: "anturno-curl",
    }).handle({
      auth: withReviewCheckRun(baseAuth, checkRun),
      channel,
      finishReason: "stop",
      message: "## Curl review\n\n**Verdict:** ship",
      type: "message.completed",
    });

    expect(posts).toHaveLength(0);
    expect(
      requests.filter(({ method, path }) => method === "GET" && path.includes("/comments?")),
    ).toHaveLength(100);
    expect(requests.map(({ method, path }) => ({ method, path }))).toContainEqual({
      method: "PATCH",
      path: `/repos/Acme/Widgets/issues/comments/${summaryId}`,
    });
  });
});
