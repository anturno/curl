import {
  closeAllRememberedCurlOsSessions,
  closeRememberedCurlOsSession,
} from "@anturno/curlos/eve";
import { defaultGitHubAuth, githubChannel } from "eve/channels/github";
import { openDiffCurlOs } from "../lib/checkout";
import { config } from "../lib/config";
import { createReviewWorkflow } from "../lib/review-workflow";

async function closeCurlOs(ctx: { getSandbox(): Promise<{ readonly id: string }> }): Promise<void> {
  await closeRememberedCurlOsSession((await ctx.getSandbox()).id);
}

const reviewWorkflow = createReviewWorkflow({ botName: config.botName });

export default githubChannel({
  botName: config.botName,
  credentials: {
    appId: () => config.githubApp.appId,
    privateKey: () => config.githubApp.privateKey,
    webhookSecret: () => config.githubApp.webhookSecret,
  },
  onComment: (ctx, comment) =>
    reviewWorkflow.dispatch({
      auth: defaultGitHubAuth(ctx),
      comment,
      context: ctx,
      type: "comment",
    }),
  onPullRequest: () => null,
  events: {
    async "turn.started"(_data, channel, ctx) {
      await channel.thread.react("eyes");
      await openDiffCurlOs(channel, await ctx.getSandbox());
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
