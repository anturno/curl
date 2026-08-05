import { connectGitHubCredentials } from "@vercel/connect/eve";
import { defaultGitHubAuth, type GitHubHandle, githubChannel } from "eve/channels/github";
import {
  completeReviewCheckRun,
  resolvePullRequestHeadSha,
  reviewCheckOutput,
  shouldDispatchBotMention,
  splitCommentBody,
  startReviewCheckRun,
} from "../lib/review-check-run";

/**
 * Bot mention slug. Prefer matching the GitHub App / Connect connector name.
 * Override with GITHUB_APP_SLUG when the App slug differs.
 */
const botName = process.env.GITHUB_APP_SLUG ?? "anturno-curl";

/**
 * Vercel Connect connector uid (default: github/<botName>).
 * Set CURL_GITHUB_AUTH=app to use a self-managed GitHub App via env instead.
 */
const connectorUid = process.env.CURL_GITHUB_CONNECTOR ?? `github/${botName}`;
const useConnect = process.env.CURL_GITHUB_AUTH !== "app";

/**
 * Auto-review on pull_request events for every repository where the App is
 * installed. Set CURL_AUTO_REVIEW=0 to disable.
 */
const autoReview = process.env.CURL_AUTO_REVIEW !== "0";

// Skip synchronize — every push would re-review and burn Luna quota.
const autoReviewActions = new Set(["opened", "reopened", "ready_for_review"]);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required when CURL_GITHUB_AUTH=app`);
  }
  return value;
}

async function postComment(
  channel: { thread: { post(message: string): Promise<unknown> } },
  body: string,
) {
  for (const chunk of splitCommentBody(body)) {
    await channel.thread.post(chunk);
  }
}

async function beginReviewCheck(input: {
  readonly github: GitHubHandle;
  readonly headSha?: string | null;
  readonly owner: string;
  readonly pullRequestNumber: number | null;
  readonly repo: string;
}): Promise<void> {
  if (input.pullRequestNumber === null) {
    return;
  }
  const headSha =
    input.headSha ??
    (await resolvePullRequestHeadSha(
      input.github,
      input.owner,
      input.repo,
      input.pullRequestNumber,
    ));
  await startReviewCheckRun({
    github: input.github,
    owner: input.owner,
    repo: input.repo,
    headSha,
  });
}

export default githubChannel({
  botName,
  credentials: useConnect
    ? connectGitHubCredentials(connectorUid)
    : {
        appId: () => requireEnv("GITHUB_APP_ID"),
        privateKey: () => requireEnv("GITHUB_APP_PRIVATE_KEY"),
        webhookSecret: () => requireEnv("GITHUB_WEBHOOK_SECRET"),
      },
  onComment: async (ctx, comment) => {
    if (
      !shouldDispatchBotMention({
        body: comment.body,
        botName,
        authorLogin: comment.author?.login,
        authorType: comment.author?.type,
      })
    ) {
      return null;
    }

    await beginReviewCheck({
      github: ctx.github,
      owner: ctx.repository.owner,
      repo: ctx.repository.name,
      pullRequestNumber: ctx.conversation.pullRequestNumber,
    });

    return { auth: defaultGitHubAuth(ctx) };
  },
  onPullRequest: async (ctx, pr) => {
    if (!autoReview) {
      return null;
    }
    if (!autoReviewActions.has(pr.action)) {
      return null;
    }

    await beginReviewCheck({
      github: ctx.github,
      owner: ctx.repository.owner,
      repo: ctx.repository.name,
      pullRequestNumber: pr.pullRequestNumber,
      headSha: pr.headSha,
    });

    return {
      auth: defaultGitHubAuth(ctx),
      context: [
        [
          "Automatic review for this repository.",
          "Run the default correctness + security review pack.",
          "Reply with one prioritized summary comment.",
        ].join(" "),
      ],
    };
  },
  events: {
    // Replaces the built-in poster so we can also complete the check run with
    // the review body (eve replaces handlers; it does not compose them).
    async "message.completed"(data, channel) {
      if (data.finishReason === "tool-calls" || !data.message) {
        return;
      }
      await postComment(channel, data.message);
      const output = reviewCheckOutput(data.message);
      await completeReviewCheckRun(channel, {
        conclusion: "neutral",
        title: output.title,
        summary: output.summary,
        text: output.text,
      });
    },

    // Fallback when a turn ends without a posted review message.
    async "turn.completed"(_data, channel) {
      await completeReviewCheckRun(channel, {
        conclusion: "neutral",
        title: "Review complete",
        summary: "Curl finished. See the review comment on this pull request.",
      });
    },

    async "turn.cancelled"(_data, channel) {
      await completeReviewCheckRun(channel, {
        conclusion: "cancelled",
        title: "Review cancelled",
        summary: "The review turn was cancelled before completion.",
      });
    },

    // Replaces built-in failure comments — keep a short error note and close the check.
    async "turn.failed"(data, channel) {
      await postComment(
        channel,
        [
          "I hit an error while handling your request.",
          "",
          "Please try again, rephrase, or reach out if it keeps failing.",
          data.message ? `\n\`${data.message}\`` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
      await completeReviewCheckRun(channel, {
        conclusion: "neutral",
        title: "Review failed",
        summary: data.message || "Curl hit an error while reviewing.",
      });
    },

    async "session.failed"(data, channel) {
      await postComment(
        channel,
        [
          "This session could not recover from an error.",
          "",
          "Start a new comment to continue.",
          data.message ? `\n\`${data.message}\`` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
      await completeReviewCheckRun(channel, {
        conclusion: "neutral",
        title: "Review failed",
        summary: data.message || "Curl session failed during review.",
      });
    },
  },
});
