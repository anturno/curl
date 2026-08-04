import { connectGitHubCredentials } from "@vercel/connect/eve";
import { defaultGitHubAuth, githubChannel } from "eve/channels/github";
import { materializeGitHubCheckout } from "../lib/github-host-checkout";

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
const connectCredentials = connectGitHubCredentials(connectorUid);

const credentials = useConnect
  ? connectCredentials
  : {
      appId: () => requireEnv("GITHUB_APP_ID"),
      privateKey: () => requireEnv("GITHUB_APP_PRIVATE_KEY"),
      webhookVerifier: connectCredentials.webhookVerifier,
    };

/**
 * Auto-review on pull_request events only for the dogfood repo (Phase 0).
 * Set CURL_DOGFOOD_AUTO_REVIEW=0 to disable. Override repo with CURL_DOGFOOD_REPO.
 */
const dogfoodRepo = (process.env.CURL_DOGFOOD_REPO ?? "anturno/curl").toLowerCase();
const dogfoodAutoReview = process.env.CURL_DOGFOOD_AUTO_REVIEW !== "0";

// Skip synchronize — every push would re-review and burn Luna quota.
const dogfoodActions = new Set(["opened", "reopened", "ready_for_review"]);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required when CURL_GITHUB_AUTH=app`);
  }
  return value;
}

export default githubChannel({
  botName,
  credentials,
  events: {
    /**
     * Replace Eve's default checkout (firewall credential brokering via
     * setNetworkPolicy — unsupported on agentOS). Materialize the tree on the
     * host into the agentOS host_dir mount so the installation token never
     * enters the guest VM.
     */
    async "turn.started"(_data, channel, ctx) {
      try {
        await channel.thread.react("eyes");
      } catch (error) {
        console.error("[curl:github] reaction failed — swallowed", error);
      }

      try {
        const sandbox = await ctx.getSandbox();
        const checkout = await materializeGitHubCheckout({
          credentials,
          sessionKey: sandbox.id,
          state: channel.state,
        });
        channel.state.checkoutPath = checkout.path;
        if (/^[a-f0-9]{40}$/iu.test(checkout.ref)) {
          channel.state.headSha = checkout.ref;
        }
      } catch (error) {
        console.error("[curl:github] host checkout failed — swallowed", error);
      }
    },
  },
  onPullRequest: (ctx, pr) => {
    if (!dogfoodAutoReview) {
      return null;
    }
    if (ctx.repository.fullName.toLowerCase() !== dogfoodRepo) {
      return null;
    }
    if (!dogfoodActions.has(pr.action)) {
      return null;
    }
    return {
      auth: defaultGitHubAuth(ctx),
      context: [
        [
          "Auto-review for the Curl dogfood repository.",
          "Run the default correctness + security review pack.",
          "Reply with one prioritized summary comment.",
        ].join(" "),
      ],
    };
  },
});
