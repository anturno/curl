import type {
  GitHubChannelState,
  GitHubComment,
  GitHubInboundContext,
  GitHubInboundResult,
  GitHubPullRequestEvent,
  GitHubThread,
} from "eve/channels/github";
import type { SessionAuthContext } from "eve/context";
import { buildGitHubFailureContext, logGitHubFailure } from "./github-failure";
import { failureComment, shouldDispatchBotMention, splitCommentBody } from "./review-content";
import {
  buildReviewContextMessage,
  loadReviewContext,
  type ReviewGitHubReader,
} from "./review-context";
import {
  MAX_REVIEW_SUMMARY_LENGTH,
  parseReviewCandidate,
  renderReview,
  validateReview,
} from "./review-contract";

export interface ReviewWorkflowOptions {
  readonly botName: string;
}

export interface ReviewChannel {
  readonly github: ReviewGitHubReader;
  readonly state: GitHubChannelState;
  readonly thread: Pick<GitHubThread, "post">;
}

export type ReviewDispatchInput =
  | {
      readonly auth: SessionAuthContext;
      readonly comment: GitHubComment;
      readonly context: GitHubInboundContext;
      readonly type: "comment";
    }
  | {
      readonly auth: SessionAuthContext;
      readonly context: GitHubInboundContext;
      readonly pullRequest: GitHubPullRequestEvent;
      readonly type: "pull_request";
    };

export type ReviewLifecycleEvent =
  | {
      readonly auth: SessionAuthContext | null | undefined;
      readonly channel: ReviewChannel;
      readonly finishReason: string;
      readonly message: string | null | undefined;
      readonly type: "message.completed";
    }
  | {
      readonly auth: SessionAuthContext | null | undefined;
      readonly channel: ReviewChannel;
      readonly type: "turn.completed";
    }
  | {
      readonly auth: SessionAuthContext | null | undefined;
      readonly channel: ReviewChannel;
      readonly type: "turn.cancelled";
    }
  | {
      readonly auth: SessionAuthContext | null | undefined;
      readonly channel: ReviewChannel;
      readonly details: unknown;
      readonly type: "turn.failed";
    }
  | {
      readonly channel: ReviewChannel;
      readonly details: unknown;
      readonly type: "session.failed";
    };

export interface ReviewWorkflow {
  dispatch(input: ReviewDispatchInput): Promise<GitHubInboundResult | null>;
  handle(input: ReviewLifecycleEvent): Promise<void>;
}

export function createReviewWorkflow(options: ReviewWorkflowOptions): ReviewWorkflow {
  return {
    async dispatch(input) {
      return input.type === "comment" ? dispatchComment(input, options.botName) : null;
    },
    async handle(input) {
      switch (input.type) {
        case "message.completed":
          await handleMessageCompleted(input);
          return;
        case "turn.completed":
          return;
        case "turn.cancelled":
          await handleTurnCancelled(input);
          return;
        case "turn.failed":
          await handleTurnFailed(input);
          return;
        case "session.failed":
          await handleSessionFailed(input);
          return;
      }
    },
  };
}

async function dispatchComment(
  input: Extract<ReviewDispatchInput, { readonly type: "comment" }>,
  botName: string,
): Promise<GitHubInboundResult | null> {
  if (
    input.context.conversation.kind !== "pull_request" &&
    input.context.conversation.kind !== "review_thread"
  ) {
    return null;
  }

  if (
    !shouldDispatchBotMention({
      body: input.comment.body,
      botName,
      authorLogin: input.comment.author?.login,
      authorType: input.comment.author?.type,
    })
  ) {
    return null;
  }

  if (input.context.conversation.pullRequestNumber === null) {
    return { auth: input.auth };
  }

  try {
    const reviewContext = await loadReviewContext({
      github: input.context.github,
      state: {
        baseSha: null,
        headSha: null,
        owner: input.context.repository.owner,
        pullRequestNumber: input.context.conversation.pullRequestNumber,
        repo: input.context.repository.name,
      },
    });
    return { auth: input.auth, context: [buildReviewContextMessage(reviewContext)] };
  } catch {
    return {
      auth: input.auth,
      context: [
        "<curl_review_context>unavailable: changed-file evidence could not be loaded.</curl_review_context>",
      ],
    };
  }
}

async function handleMessageCompleted(
  input: Extract<ReviewLifecycleEvent, { readonly type: "message.completed" }>,
): Promise<void> {
  if (input.finishReason === "tool-calls" || !input.message) {
    return;
  }

  if (input.channel.state.pullRequestNumber !== null) {
    await handlePullRequestReview(input);
    return;
  }

  await postComment(input, input.message);
}

async function handlePullRequestReview(
  input: Extract<ReviewLifecycleEvent, { readonly type: "message.completed" }>,
): Promise<void> {
  const candidate = parseReviewCandidate(input.message ?? "");
  if (!candidate) {
    await postReviewFailure(input);
    return;
  }

  let result: ReturnType<typeof validateReview>;
  try {
    const context = await loadReviewContext(input.channel);
    result = validateReview(candidate, context);
  } catch (error) {
    logGitHubFailure(buildGitHubFailureContext(input.channel, null, "review.context"), error);
    await postReviewFailure(input);
    return;
  }
  if (!result.ok) {
    await postReviewFailure(input);
    return;
  }

  const summary = renderReview(result.review);
  if (summary.length > MAX_REVIEW_SUMMARY_LENGTH) {
    await postReviewFailure(input);
    return;
  }
  await postPullRequestSummary(input, summary);
}

async function postPullRequestSummary(
  input: Extract<ReviewLifecycleEvent, { readonly type: "message.completed" }>,
  summary: string,
): Promise<void> {
  try {
    await input.channel.thread.post(summary);
  } catch (error) {
    logGitHubFailure(buildGitHubFailureContext(input.channel, null, "comment.post"), error);
    throw error;
  }
}

async function postComment(
  input: Extract<ReviewLifecycleEvent, { readonly type: "message.completed" }>,
  message: string,
): Promise<void> {
  for (const chunk of splitCommentBody(message)) {
    try {
      await input.channel.thread.post(chunk);
    } catch (error) {
      logGitHubFailure(buildGitHubFailureContext(input.channel, null, "comment.post"), error);
      throw error;
    }
  }
}

async function postReviewFailure(
  input: Extract<ReviewLifecycleEvent, { readonly type: "message.completed" }>,
): Promise<void> {
  await postComment(input, failureComment("I could not validate the review result.", null));
}

async function handleTurnCancelled(
  input: Extract<ReviewLifecycleEvent, { readonly type: "turn.cancelled" }>,
): Promise<void> {
  try {
    await input.channel.thread.post(failureComment("Review cancelled.", null));
  } catch (error) {
    logGitHubFailure(buildGitHubFailureContext(input.channel, null, "comment.cancelled"), error);
  }
}

async function handleTurnFailed(
  input: Extract<ReviewLifecycleEvent, { readonly type: "turn.failed" }>,
): Promise<void> {
  try {
    await input.channel.thread.post(
      failureComment("I hit an error while handling your request.", safeErrorId(input.details)),
    );
  } catch (error) {
    logGitHubFailure(buildGitHubFailureContext(input.channel, null, "comment.failure"), error);
  }
}

async function handleSessionFailed(
  input: Extract<ReviewLifecycleEvent, { readonly type: "session.failed" }>,
): Promise<void> {
  try {
    await input.channel.thread.post(
      failureComment("This session could not recover from an error.", safeErrorId(input.details)),
    );
  } catch (error) {
    logGitHubFailure(
      buildGitHubFailureContext(input.channel, null, "comment.session-failure"),
      error,
    );
  }
}

function safeErrorId(details: unknown): string | null {
  if (!isRecord(details)) {
    return null;
  }
  const id = details.errorId;
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(id) ? id : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
