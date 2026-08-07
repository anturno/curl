import type {
  GitHubComment,
  GitHubEventContext,
  GitHubInboundContext,
  GitHubInboundResult,
  GitHubPullRequestEvent,
} from "eve/channels/github";
import type { SessionAuthContext } from "eve/context";
import { buildGitHubFailureContext, logGitHubFailure } from "./github-failure";
import { failureComment, shouldDispatchBotMention, splitCommentBody } from "./review-content";

export interface ReviewWorkflowOptions {
  readonly botName: string;
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
      readonly channel: GitHubEventContext;
      readonly finishReason: string;
      readonly message: string | null | undefined;
      readonly type: "message.completed";
    }
  | {
      readonly auth: SessionAuthContext | null | undefined;
      readonly channel: GitHubEventContext;
      readonly type: "turn.completed";
    }
  | {
      readonly auth: SessionAuthContext | null | undefined;
      readonly channel: GitHubEventContext;
      readonly type: "turn.cancelled";
    }
  | {
      readonly auth: SessionAuthContext | null | undefined;
      readonly channel: GitHubEventContext;
      readonly details: unknown;
      readonly type: "turn.failed";
    }
  | {
      readonly channel: GitHubEventContext;
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

  return { auth: input.auth };
}

async function handleMessageCompleted(
  input: Extract<ReviewLifecycleEvent, { readonly type: "message.completed" }>,
): Promise<void> {
  if (input.finishReason === "tool-calls" || !input.message) {
    return;
  }

  for (const chunk of splitCommentBody(input.message)) {
    try {
      await input.channel.thread.post(chunk);
    } catch (error) {
      logGitHubFailure(buildGitHubFailureContext(input.channel, null, "comment.post"), error);
      throw error;
    }
  }
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
