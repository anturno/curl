import { connectGitHubCredentials } from "@vercel/connect/eve";
import { defaultGitHubAuth, githubChannel } from "eve/channels/github";
import { reviewConfig } from "../lib/config";
import {
  closeAllRememberedCurlOsSessions,
  closeRememberedCurlOsSession,
} from "../lib/curlos-session";
import { openGitHubCurlOs } from "../lib/github-checkout";
import { createReviewWorkflow } from "../lib/review-workflow";

async function closeCurlOs(ctx: { getSandbox(): Promise<{ readonly id: string }> }): Promise<void> {
  await closeRememberedCurlOsSession((await ctx.getSandbox()).id);
}

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
const useConnect = reviewConfig.github.authMode === "connect";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required when CURL_GITHUB_AUTH=app`);
  }
  return value;
}

const reviewWorkflow = createReviewWorkflow({
  automaticReview: reviewConfig.automaticReview,
  botName,
});

export default githubChannel({
  botName,
  credentials: useConnect
    ? connectGitHubCredentials(connectorUid)
    : {
        appId: () => requireEnv("GITHUB_APP_ID"),
        privateKey: () => requireEnv("GITHUB_APP_PRIVATE_KEY"),
        webhookSecret: () => requireEnv("GITHUB_WEBHOOK_SECRET"),
      },
  onComment: (ctx, comment) =>
    reviewWorkflow.dispatch({
      auth: defaultGitHubAuth(ctx),
      comment,
      context: ctx,
      type: "comment",
    }),
  onPullRequest: (ctx, pullRequest) =>
    reviewWorkflow.dispatch({
      auth: defaultGitHubAuth(ctx),
      context: ctx,
      pullRequest,
      type: "pull_request",
    }),
  events: {
    async "turn.started"(_data, channel, ctx) {
      await channel.thread.react("eyes");
      await openGitHubCurlOs(channel, await ctx.getSandbox());
    },

    async "message.completed"(data, channel, ctx) {
      await reviewWorkflow.handle({
        auth: ctx.session.auth.current,
        channel,
        finishReason: data.finishReason,
        message: data.message,
        type: "message.completed",
      });
    },

    async "turn.completed"(_data, channel, ctx) {
      try {
        await reviewWorkflow.handle({
          auth: ctx.session.auth.current,
          channel,
          type: "turn.completed",
        });
      } finally {
        await closeCurlOs(ctx);
      }
    },

    async "turn.cancelled"(_data, channel, ctx) {
      try {
        await reviewWorkflow.handle({
          auth: ctx.session.auth.current,
          channel,
          type: "turn.cancelled",
        });
      } finally {
        await closeCurlOs(ctx);
      }
    },

    async "turn.failed"(data, channel, ctx) {
      try {
        await reviewWorkflow.handle({
          auth: ctx.session.auth.current,
          channel,
          details: data.details,
          type: "turn.failed",
        });
      } finally {
        await closeCurlOs(ctx);
      }
    },

    async "session.failed"(data, channel) {
      try {
        await reviewWorkflow.handle({
          channel,
          details: data.details,
          type: "session.failed",
        });
      } finally {
        await closeAllRememberedCurlOsSessions();
      }
    },
  },
});
