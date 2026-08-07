import { defaultGitHubAuth, githubChannel } from "eve/channels/github";
import { openDiffCurlOs } from "../lib/checkout";
import { config } from "../lib/config";
import { createReviewWorkflow } from "../lib/review-workflow";

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
      await reviewWorkflow.handle({
        auth: ctx.session.auth.current,
        channel,
        type: "turn.completed",
      });
    },

    async "turn.cancelled"(_data, channel, ctx) {
      await reviewWorkflow.handle({
        auth: ctx.session.auth.current,
        channel,
        type: "turn.cancelled",
      });
    },

    async "turn.failed"(data, channel, ctx) {
      await reviewWorkflow.handle({
        auth: ctx.session.auth.current,
        channel,
        details: data.details,
        type: "turn.failed",
      });
    },

    async "session.failed"(data, channel) {
      await reviewWorkflow.handle({
        channel,
        details: data.details,
        type: "session.failed",
      });
    },
  },
});
