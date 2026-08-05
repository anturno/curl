import type {
  GitHubComment,
  GitHubEventContext,
  GitHubInboundContext,
  GitHubInboundResult,
  GitHubPullRequestEvent,
} from "eve/channels/github";
import type { SessionAuthContext } from "eve/context";
import { type AutomaticReviewConfig, isAutomaticReviewAllowed } from "./config";
import { isRecord, repoPath } from "./github-api";
import { buildGitHubFailureContext, logGitHubFailure } from "./github-failure";
import { completeReviewCheckRun, completeReviewCheckRunIfOpen } from "./review-check-completion";
import {
  findReviewCheckRunForChannel,
  type ReviewCheckRun,
  reviewCheckRunFromAuth,
  startReviewCheckRun,
  withReviewCheckRun,
} from "./review-check-run";
import {
  annotateHistoricalReview,
  REVIEW_COMMENT_MAX,
  reviewCheckOutput,
  shouldDispatchBotMention,
  splitCommentBody,
} from "./review-content";
import {
  type ReviewHeadStatus,
  resolvePullRequestHeadSha,
  resolveReviewHeadStatus,
} from "./review-head";

const REVIEW_SUMMARY_MARKER = "<!-- curl:review-summary -->";
const REVIEW_HEAD_MARKER_PREFIX = "<!-- curl:review-head:";
const REVIEW_HEAD_MARKER_SUFFIX = " -->";

export interface ReviewWorkflowOptions {
  readonly automaticReview: AutomaticReviewConfig;
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

/**
 * Deep review workflow module. The Eve channel only dispatches inbound data and
 * lifecycle events through this interface; comment identity, stale-head safety,
 * and check-run ordering remain local to the implementation.
 */
export interface ReviewWorkflow {
  dispatch(input: ReviewDispatchInput): Promise<GitHubInboundResult | null>;
  handle(input: ReviewLifecycleEvent): Promise<void>;
}

export function createReviewWorkflow(options: ReviewWorkflowOptions): ReviewWorkflow {
  return new DefaultReviewWorkflow(options);
}

class DefaultReviewWorkflow implements ReviewWorkflow {
  constructor(private readonly options: ReviewWorkflowOptions) {}

  async dispatch(input: ReviewDispatchInput): Promise<GitHubInboundResult | null> {
    return input.type === "comment" ? this.dispatchComment(input) : this.dispatchPullRequest(input);
  }

  async handle(input: ReviewLifecycleEvent): Promise<void> {
    switch (input.type) {
      case "message.completed":
        // A final message is authoritative and is allowed to carry the detailed
        // check output.
        await this.handleMessageCompleted(input);
        return;
      case "turn.completed":
        // Fallback when a turn ends without a posted review message. The remote
        // status check prevents this generic output from replacing final details.
        await completeReviewCheckRunIfOpen(
          input.channel,
          {
            authoritative: false,
            conclusion: "neutral",
            title: "Review complete",
            summary: "Curl finished. See the review comment on this pull request.",
          },
          reviewCheckRunFromAuth(input.auth),
        );
        return;
      case "turn.cancelled":
        await completeReviewCheckRun(
          input.channel,
          {
            authoritative: true,
            conclusion: "cancelled",
            title: "Review cancelled",
            summary: "The review turn was cancelled before completion.",
          },
          reviewCheckRunFromAuth(input.auth),
        );
        return;
      case "turn.failed":
        await this.handleTurnFailure(input);
        return;
      case "session.failed":
        await this.handleSessionFailure(input);
        return;
    }
  }

  private async dispatchComment(
    input: Extract<ReviewDispatchInput, { readonly type: "comment" }>,
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
        botName: this.options.botName,
        authorLogin: input.comment.author?.login,
        authorType: input.comment.author?.type,
      })
    ) {
      return null;
    }

    const checkRun = await this.beginReviewCheck({
      github: input.context.github,
      owner: input.context.repository.owner,
      repo: input.context.repository.name,
      pullRequestNumber: input.context.conversation.pullRequestNumber,
    });

    return { auth: withReviewCheckRun(input.auth, checkRun) };
  }

  private async dispatchPullRequest(
    input: Extract<ReviewDispatchInput, { readonly type: "pull_request" }>,
  ): Promise<GitHubInboundResult | null> {
    if (
      input.pullRequest.action !== "opened" ||
      !isAutomaticReviewAllowed(
        input.context.repository.owner,
        input.context.repository.name,
        this.options.automaticReview,
      )
    ) {
      return null;
    }

    const checkRun = await this.beginReviewCheck({
      github: input.context.github,
      owner: input.context.repository.owner,
      repo: input.context.repository.name,
      pullRequestNumber: input.pullRequest.pullRequestNumber,
      headSha: input.pullRequest.headSha,
    });

    return {
      auth: withReviewCheckRun(input.auth, checkRun),
      context: [
        [
          "Automatic review for this repository.",
          "Run the default correctness + security review pack.",
          "Reply with one prioritized summary comment.",
        ].join(" "),
      ],
    };
  }

  private async beginReviewCheck(input: {
    readonly github: GitHubEventContext["github"];
    readonly headSha?: string | null;
    readonly owner: string;
    readonly pullRequestNumber: number | null;
    readonly repo: string;
  }): Promise<ReviewCheckRun | null> {
    if (input.pullRequestNumber === null) {
      return null;
    }
    const headSha =
      input.headSha ??
      (await resolvePullRequestHeadSha(
        input.github,
        input.owner,
        input.repo,
        input.pullRequestNumber,
      ));
    return startReviewCheckRun({
      github: input.github,
      owner: input.owner,
      repo: input.repo,
      pullRequestNumber: input.pullRequestNumber,
      headSha,
    });
  }

  private async handleMessageCompleted(
    input: Extract<ReviewLifecycleEvent, { readonly type: "message.completed" }>,
  ): Promise<void> {
    if (input.finishReason === "tool-calls" || !input.message) {
      return;
    }

    const checkRun = reviewCheckRunFromAuth(input.auth);
    const headStatus = await resolveReviewHeadStatus({
      checkId: checkRun?.id ?? null,
      github: input.channel.github,
      owner: input.channel.state.owner,
      repo: input.channel.state.repo,
      pullRequestNumber: input.channel.state.pullRequestNumber,
      reviewedHeadSha: checkRun?.headSha ?? input.channel.state.headSha,
    });
    const reviewMessage = annotateHistoricalReview(input.message, headStatus);
    let posted = false;
    try {
      await this.postReviewResponse(input.channel, reviewMessage, checkRun, headStatus);
      posted = true;
    } finally {
      const output = posted
        ? reviewCheckOutput(reviewMessage, headStatus)
        : {
            title: "Review failed",
            summary: "Curl could not post the review comment.",
            text: undefined,
          };
      await completeReviewCheckRun(
        input.channel,
        {
          authoritative: true,
          conclusion: posted ? "neutral" : "failure",
          title: output.title,
          summary: output.summary,
          ...(output.text ? { text: output.text } : {}),
        },
        checkRun,
      );
    }
  }

  private async handleTurnFailure(
    input: Extract<ReviewLifecycleEvent, { readonly type: "turn.failed" }>,
  ): Promise<void> {
    const checkRun = reviewCheckRunFromAuth(input.auth);
    await this.postFailure(
      input.channel,
      "I hit an error while handling your request.",
      safeErrorId(input.details),
      checkRun,
    );
    await completeReviewCheckRun(
      input.channel,
      {
        authoritative: true,
        conclusion: "failure",
        title: "Review failed",
        summary: "Curl could not complete this review.",
      },
      checkRun,
    );
  }

  private async handleSessionFailure(
    input: Extract<ReviewLifecycleEvent, { readonly type: "session.failed" }>,
  ): Promise<void> {
    const checkRun = await findReviewCheckRunForChannel(input.channel);
    await this.postFailure(
      input.channel,
      "This session could not recover from an error.",
      safeErrorId(input.details),
      checkRun,
    );
    await completeReviewCheckRun(
      input.channel,
      {
        authoritative: true,
        conclusion: "failure",
        title: "Review failed",
        summary: "Curl could not complete this review session.",
      },
      checkRun,
    );
  }

  private async postComment(
    channel: GitHubEventContext,
    body: string,
    checkRun: ReviewCheckRun | null = null,
    operation = "comment.post",
  ): Promise<void> {
    for (const chunk of splitCommentBody(body)) {
      try {
        await channel.thread.post(chunk);
      } catch (error) {
        logGitHubFailure(buildGitHubFailureContext(channel, checkRun, operation), error);
        throw error;
      }
    }
  }

  private async postFailure(
    channel: GitHubEventContext,
    message: string,
    errorId: string | null,
    checkRun: ReviewCheckRun | null = null,
  ): Promise<void> {
    try {
      await this.postComment(
        channel,
        failureComment(message, errorId),
        checkRun,
        "comment.failure",
      );
    } catch {
      // The check-run cleanup below still reports the failure when comments fail.
    }
  }

  private async postReviewResponse(
    channel: GitHubEventContext,
    message: string,
    checkRun: ReviewCheckRun | null,
    headStatus: ReviewHeadStatus | null,
  ): Promise<void> {
    // Review-thread replies must continue through Eve's thread binding; a
    // timeline summary marker cannot be patched through the review-comment API.
    if (channel.thread.kind === "review_thread" || channel.state.pullRequestNumber === null) {
      await this.postComment(channel, message, checkRun);
      return;
    }
    await this.postTimelineReviewSummary(channel, message, checkRun, headStatus);
  }

  private async postTimelineReviewSummary(
    channel: GitHubEventContext,
    message: string,
    checkRun: ReviewCheckRun | null,
    headStatus: ReviewHeadStatus | null,
  ): Promise<void> {
    const reviewedHeadSha = checkRun?.headSha ?? channel.state.headSha;
    const body = summaryBody(message, reviewedHeadSha);

    // Preserve the established chunking behavior for unusually large reviews.
    // A split body cannot be updated as one sticky comment without inventing a
    // multi-comment identity protocol, so the marker is used for normal-sized
    // prioritized summaries only.
    if (body.length > REVIEW_COMMENT_MAX) {
      await this.postComment(channel, message, checkRun, "comment.post-long-summary");
      return;
    }

    const existing = await this.findExistingReviewSummary(channel, checkRun);
    const sameReviewSummary =
      existing?.reviewedHeadSha !== null &&
      existing?.reviewedHeadSha !== undefined &&
      reviewedHeadSha !== null &&
      existing.reviewedHeadSha.toLowerCase() === reviewedHeadSha.toLowerCase();
    if (existing !== null && headStatus?.stale && !sameReviewSummary) {
      // An older run must not replace a summary that may describe the current
      // head. Deliver the historical result as a normal timeline comment; its
      // explicit SHA warning keeps it from looking current.
      await this.postComment(channel, message, checkRun, "comment.post-historical-summary");
      return;
    }

    if (existing !== null) {
      try {
        await channel.github.request({
          method: "PATCH",
          path: `${repoPath(channel.state.owner, channel.state.repo)}/issues/comments/${existing.id}`,
          body: { body },
        });
        return;
      } catch (error) {
        logGitHubFailure(
          buildGitHubFailureContext(channel, checkRun, "comment.summary.update"),
          error,
        );
        // Keep the review deliverable even when an old summary became
        // uneditable. The next review can find the marker and retry an update.
        await this.postComment(
          channel,
          message,
          checkRun,
          "comment.post-after-summary-update-failure",
        );
        return;
      }
    }

    try {
      await channel.thread.post(body);
    } catch (error) {
      logGitHubFailure(
        buildGitHubFailureContext(channel, checkRun, "comment.summary.create"),
        error,
      );
      throw error;
    }
  }

  private async findExistingReviewSummary(
    channel: GitHubEventContext,
    checkRun: ReviewCheckRun | null,
  ): Promise<ExistingReviewSummary | null> {
    const pullRequestNumber = channel.state.pullRequestNumber;
    if (pullRequestNumber === null) {
      return null;
    }

    try {
      const response = await channel.github.request<unknown>({
        method: "GET",
        path: `${repoPath(channel.state.owner, channel.state.repo)}/issues/${pullRequestNumber}/comments?per_page=100&page=1`,
      });
      if (!Array.isArray(response.body)) {
        throw new Error("GitHub comment list response was not an array");
      }

      let existing: ExistingReviewSummary | null = null;
      for (const comment of response.body) {
        if (!isRecord(comment) || typeof comment.body !== "string") {
          continue;
        }
        if (!comment.body.includes(REVIEW_SUMMARY_MARKER)) {
          continue;
        }
        const id = safeCommentId(comment.id);
        if (id !== null && (existing === null || id > existing.id)) {
          // Comment ids are monotonic. Keep the newest marked comment if an
          // earlier failed update left a duplicate behind, regardless of API
          // response ordering.
          existing = { id, reviewedHeadSha: reviewHeadFromSummary(comment.body) };
        }
      }
      return existing;
    } catch (error) {
      logGitHubFailure(buildGitHubFailureContext(channel, checkRun, "comment.summary.list"), error);
      return null;
    }
  }
}

interface ExistingReviewSummary {
  readonly id: number;
  readonly reviewedHeadSha: string | null;
}

function failureComment(message: string, errorId: string | null): string {
  return [
    message,
    "",
    "Please try again, rephrase, or reach out if it keeps failing.",
    errorId ? `Error id: ${errorId}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function reviewHeadFromSummary(body: string): string | null {
  const match = /<!--\s*curl:review-head:([0-9a-f]{7,64})\s*-->/iu.exec(body);
  return match?.[1] ?? null;
}

function summaryBody(message: string, reviewedHeadSha: string | null): string {
  const headMarker =
    reviewedHeadSha && /^[0-9a-f]{7,64}$/iu.test(reviewedHeadSha)
      ? `${REVIEW_HEAD_MARKER_PREFIX}${reviewedHeadSha}${REVIEW_HEAD_MARKER_SUFFIX}`
      : null;
  return [REVIEW_SUMMARY_MARKER, headMarker, "", message].filter(Boolean).join("\n");
}

function safeCommentId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function safeErrorId(details: unknown): string | null {
  if (typeof details !== "object" || details === null || Array.isArray(details)) {
    return null;
  }
  const id = (details as { readonly errorId?: unknown }).errorId;
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(id) ? id : null;
}
