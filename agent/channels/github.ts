import { connectGitHubCredentials } from "@vercel/connect/eve";
import { defaultGitHubAuth, githubChannel } from "eve/channels/github";

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
  credentials: useConnect
    ? connectGitHubCredentials(connectorUid)
    : {
        appId: () => requireEnv("GITHUB_APP_ID"),
        privateKey: () => requireEnv("GITHUB_APP_PRIVATE_KEY"),
        webhookSecret: () => requireEnv("GITHUB_WEBHOOK_SECRET"),
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
