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
  normalizeBotName,
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
import { reviewLedger, summarizeReviewMessage } from "./review-ledger";

const REVIEW_SUMMARY_MARKER = "<!-- curl:review-summary -->";
const REVIEW_HEAD_MARKER_PREFIX = "<!-- curl:review-head:";
const REVIEW_HEAD_MARKER_SUFFIX = " -->";
const COMMENT_PAGE_SIZE = 100;
const MAX_COMMENT_PAGES = 100;
const MAX_TRACKED_ACTIVE_CHECK_RUNS = 1_024;
const MAX_TRACKED_REVIEW_STARTS = 1_024;
// A review may write both a check and a conversation key, so the ledger
// deduplication map is sized for two keys per tracked review.
const MAX_TRACKED_REVIEW_KEYS = 2_048;

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
  private readonly activeCheckRuns = new Map<string, ReviewCheckRun>();
  private readonly reviewStarts = new Map<number, number>();
  private readonly recordedReviewKeys = new Map<string, boolean>();

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
      case "turn.completed": {
        // Fallback when a turn ends without a posted review message. The remote
        // status check prevents this generic output from replacing final details.
        const checkRun = reviewCheckRunFromAuth(input.auth);
        const durationMs = this.consumeReviewDuration(checkRun);
        try {
          await completeReviewCheckRunIfOpen(
            input.channel,
            {
              authoritative: false,
              conclusion: "neutral",
              title: "Review complete",
              summary: "Curl finished. See the review comment on this pull request.",
            },
            checkRun,
          );
        } finally {
          this.writeReviewLedger(input.channel, checkRun, null, null, false, durationMs, false);
        }
        return;
      }
      case "turn.cancelled": {
        const checkRun = reviewCheckRunFromAuth(input.auth);
        const durationMs = this.consumeReviewDuration(checkRun);
        try {
          await completeReviewCheckRun(
            input.channel,
            {
              authoritative: true,
              conclusion: "cancelled",
              title: "Review cancelled",
              summary: "The review turn was cancelled before completion.",
            },
            checkRun,
          );
        } finally {
          this.writeReviewLedger(input.channel, checkRun, null, null, false, durationMs, true);
        }
        return;
      }
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
    this.rememberReviewStart(
      input.context.repository.owner,
      input.context.repository.name,
      input.context.conversation.pullRequestNumber,
      checkRun,
    );

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
    this.rememberReviewStart(
      input.context.repository.owner,
      input.context.repository.name,
      input.pullRequest.pullRequestNumber,
      checkRun,
    );

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

  private rememberReviewStart(
    owner: string,
    repo: string,
    pullRequestNumber: number | null,
    checkRun: ReviewCheckRun | null,
  ): void {
    const conversationKey = reviewConversationKey(owner, repo, pullRequestNumber);
    this.recordedReviewKeys.delete(`conversation:${conversationKey}`);
    if (checkRun === null) {
      this.activeCheckRuns.delete(conversationKey);
      return;
    }
    this.recordedReviewKeys.delete(`check:${checkRun.id}`);
    this.activeCheckRuns.set(conversationKey, checkRun);
    while (this.activeCheckRuns.size > MAX_TRACKED_ACTIVE_CHECK_RUNS) {
      const oldest = this.activeCheckRuns.keys().next().value;
      if (typeof oldest !== "string") {
        break;
      }
      this.activeCheckRuns.delete(oldest);
    }
    this.reviewStarts.set(checkRun.id, Date.now());
    while (this.reviewStarts.size > MAX_TRACKED_REVIEW_STARTS) {
      const oldest = this.reviewStarts.keys().next().value;
      if (typeof oldest !== "number") {
        break;
      }
      this.reviewStarts.delete(oldest);
    }
  }

  private consumeReviewDuration(checkRun: ReviewCheckRun | null): number | null {
    if (checkRun === null) {
      return null;
    }
    const startedAt = this.reviewStarts.get(checkRun.id);
    this.reviewStarts.delete(checkRun.id);
    return startedAt === undefined ? null : Math.max(0, Date.now() - startedAt);
  }

  private writeReviewLedger(
    channel: GitHubEventContext,
    checkRun: ReviewCheckRun | null,
    headStatus: ReviewHeadStatus | null,
    message: string | null,
    delivered: boolean,
    durationMs: number | null,
    authoritative: boolean,
  ): void {
    const conversationIdentity = reviewConversationKey(
      channel.state.owner,
      channel.state.repo,
      channel.state.pullRequestNumber,
    );
    const trackedCheckRun =
      checkRun !== null && this.activeCheckRuns.get(conversationIdentity)?.id === checkRun.id;
    if (trackedCheckRun && (message !== null || authoritative)) {
      this.activeCheckRuns.delete(conversationIdentity);
    }
    const conversationKey = `conversation:${conversationIdentity}`;
    const keys = [
      ...reviewLedgerKeys(channel, checkRun),
      ...(message === null || authoritative ? [conversationKey] : []),
    ].filter((key, index, all) => all.indexOf(key) === index);
    const existing = keys.map((key) => this.recordedReviewKeys.get(key));
    if (existing.some((value) => value === true)) {
      return;
    }
    if (!authoritative && existing.some((value) => value !== undefined)) {
      return;
    }
    for (const key of keys) {
      this.recordedReviewKeys.set(key, authoritative);
    }
    while (this.recordedReviewKeys.size > MAX_TRACKED_REVIEW_KEYS) {
      const oldest = this.recordedReviewKeys.keys().next().value;
      if (typeof oldest !== "string") {
        break;
      }
      this.recordedReviewKeys.delete(oldest);
    }
    reviewLedger.record({
      ...summarizeReviewMessage(message ?? ""),
      delivered,
      durationMs,
      pullRequestNumber: channel.state.pullRequestNumber,
      repository: `${channel.state.owner}/${channel.state.repo}`,
      reviewedHeadSha: checkRun?.headSha ?? channel.state.headSha,
      stale: headStatus?.currentHeadSha === null ? null : (headStatus?.stale ?? null),
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
      const durationMs = this.consumeReviewDuration(checkRun);
      try {
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
      } finally {
        this.writeReviewLedger(
          input.channel,
          checkRun,
          headStatus,
          reviewMessage,
          posted,
          durationMs,
          true,
        );
      }
    }
  }

  private async handleTurnFailure(
    input: Extract<ReviewLifecycleEvent, { readonly type: "turn.failed" }>,
  ): Promise<void> {
    const checkRun = reviewCheckRunFromAuth(input.auth);
    const durationMs = this.consumeReviewDuration(checkRun);
    try {
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
    } finally {
      this.writeReviewLedger(input.channel, checkRun, null, null, false, durationMs, true);
    }
  }

  private async handleSessionFailure(
    input: Extract<ReviewLifecycleEvent, { readonly type: "session.failed" }>,
  ): Promise<void> {
    const persistedCheckRun = await findReviewCheckRunForChannel(input.channel);
    const conversationKey = reviewConversationKey(
      input.channel.state.owner,
      input.channel.state.repo,
      input.channel.state.pullRequestNumber,
    );
    const checkRun = persistedCheckRun ?? this.activeCheckRuns.get(conversationKey) ?? null;
    const durationMs = this.consumeReviewDuration(checkRun);
    try {
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
    } finally {
      this.writeReviewLedger(input.channel, checkRun, null, null, false, durationMs, true);
    }
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
      await this.postComment(channel, stripReviewMarkers(message), checkRun);
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
    const stripped = stripReviewMarkers(message);
    const reviewedHeadSha = checkRun?.headSha ?? channel.state.headSha;
    if (!isReviewHeadSha(reviewedHeadSha)) {
      await this.postComment(channel, stripped, checkRun, "comment.post-unknown-head");
      return;
    }
    const body = summaryBody(stripped, reviewedHeadSha);

    // Preserve the established chunking behavior for unusually large reviews.
    // A split body cannot be updated as one sticky comment without inventing a
    // multi-comment identity protocol, so the marker is used for normal-sized
    // prioritized summaries only.
    if (body.length > REVIEW_COMMENT_MAX) {
      await this.postComment(channel, stripped, checkRun, "comment.post-long-summary");
      return;
    }

    const lookup = await this.findExistingReviewSummary(channel, checkRun);
    if (lookup.kind === "unavailable") {
      await this.postComment(channel, stripped, checkRun, "comment.post-summary-lookup-failure");
      return;
    }
    const existing = lookup.kind === "found" ? lookup.summary : null;
    const sameReviewSummary =
      existing?.reviewedHeadSha !== null &&
      existing?.reviewedHeadSha !== undefined &&
      reviewedHeadSha !== null &&
      existing.reviewedHeadSha.toLowerCase() === reviewedHeadSha.toLowerCase();
    if (existing !== null && !sameReviewSummary) {
      await this.postComment(
        channel,
        stripped,
        checkRun,
        headStatus?.stale ? "comment.post-historical-summary" : "comment.post-unmatched-summary",
      );
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
          stripped,
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
  ): Promise<ExistingReviewSummaryLookup> {
    const pullRequestNumber = channel.state.pullRequestNumber;
    if (pullRequestNumber === null) {
      return { kind: "not-found" };
    }

    try {
      let existing: ExistingReviewSummary | null = null;
      for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
        const response = await channel.github.request<unknown>({
          method: "GET",
          path: `${repoPath(channel.state.owner, channel.state.repo)}/issues/${pullRequestNumber}/comments?per_page=${COMMENT_PAGE_SIZE}&page=${page}`,
        });
        if (!Array.isArray(response.body)) {
          throw new Error("GitHub comment list response was not an array");
        }

        for (const comment of response.body) {
          if (!isRecord(comment) || typeof comment.body !== "string") {
            continue;
          }
          if (
            !comment.body.includes(REVIEW_SUMMARY_MARKER) ||
            !isBotAuthoredSummary(comment, this.options.botName)
          ) {
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

        if (response.body.length < COMMENT_PAGE_SIZE) {
          return existing === null ? { kind: "not-found" } : { kind: "found", summary: existing };
        }
      }
      return existing === null ? { kind: "unavailable" } : { kind: "found", summary: existing };
    } catch (error) {
      logGitHubFailure(buildGitHubFailureContext(channel, checkRun, "comment.summary.list"), error);
      return { kind: "unavailable" };
    }
  }
}

type ExistingReviewSummaryLookup =
  | { readonly kind: "found"; readonly summary: ExistingReviewSummary }
  | { readonly kind: "not-found" }
  | { readonly kind: "unavailable" };

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

function reviewConversationKey(
  owner: string,
  repo: string,
  pullRequestNumber: number | null,
): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}#${pullRequestNumber ?? "unknown"}`;
}

function reviewLedgerKeys(
  channel: GitHubEventContext,
  checkRun: ReviewCheckRun | null,
): readonly string[] {
  const conversation = `conversation:${reviewConversationKey(
    channel.state.owner,
    channel.state.repo,
    channel.state.pullRequestNumber,
  )}`;
  return checkRun === null ? [conversation] : [`check:${checkRun.id}`];
}

function isReviewHeadSha(value: string | null): value is string {
  return value !== null && /^[0-9a-f]{7,64}$/iu.test(value);
}

function summaryBody(message: string, reviewedHeadSha: string | null): string {
  const headMarker = isReviewHeadSha(reviewedHeadSha)
    ? `${REVIEW_HEAD_MARKER_PREFIX}${reviewedHeadSha}${REVIEW_HEAD_MARKER_SUFFIX}`
    : null;
  return [REVIEW_SUMMARY_MARKER, headMarker, "", message].filter(Boolean).join("\n");
}

function stripReviewMarkers(message: string): string {
  return message.replace(
    /<!--\s*curl:review-summary\s*-->|<!--\s*curl:review-head:[0-9a-f]{7,64}\s*-->/giu,
    "",
  );
}

function isBotAuthoredSummary(comment: Record<string, unknown>, botName: string): boolean {
  const user = comment.user;
  if (!isRecord(user) || user.type !== "Bot") {
    return false;
  }
  const login = typeof user.login === "string" ? user.login : null;
  const normalizedBotName = normalizeBotName(botName);
  return (
    login !== null &&
    normalizedBotName.length > 0 &&
    login.toLowerCase() === `${normalizedBotName}[bot]`.toLowerCase()
  );
}

function safeCommentId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function safeErrorId(details: unknown): string | null {
  if (!isRecord(details)) {
    return null;
  }
  const id = details.errorId;
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(id) ? id : null;
}
