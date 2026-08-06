# Configuration

Curl reads environment variables when the agent starts. Copy [`.env.example`](../.env.example) for a local reference, keep real values in the deployment secret store, and run the offline verifier before deploying:

```bash
bun run verify:config
```

The verifier does not contact GitHub or OpenCode. It validates the values that can be checked locally and reports only presence, mode, and other non-secret facts.

## Environment variables

### Inference and evaluation

| Variable | Accepted value | Default | Notes |
| --- | --- | --- | --- |
| `OPENCODE_API_KEY` | Any non-empty provider key | None | Required for deployed and production reviews, and for live evals. Never expose it to the sandbox or commit it. |
| `OPENCODE_MODEL` | A non-empty model id; surrounding whitespace is trimmed | `gpt-5.6-luna` | Curl uses OpenCode Go's Responses API with high reasoning. An unset or blank value selects the default. |
| `OPENCODE_MODEL_CONTEXT_WINDOW_TOKENS` | Positive decimal integer from `1` through `10000000` | `200000` | Zero, negative numbers, decimals, exponent notation, and non-numeric text are rejected. |
| `CURL_MAX_INPUT_TOKENS_PER_SESSION` | Positive decimal integer from `1` through `100000000` | `1000000` | Maximum input-token budget for one session. |
| `CURL_MAX_OUTPUT_TOKENS_PER_SESSION` | Positive decimal integer from `1` through `10000000` | `20000` | Maximum output-token budget for one session. |
| `CURL_SESSION_TIMEOUT_MS` | Positive decimal integer from `1` through `31536000000` | `604800000` (7 days) | Maximum session lifetime in milliseconds. |
| `CURL_EVAL_MOCK` | Exactly `1`, `0`, `true`, or `false` | `false` | Enables the deterministic local/CI model. It is not a provider fallback and is rejected on Vercel or in a production runtime. |

Boolean values are case-sensitive. Values such as `TRUE`, `yes`, `on`, and an empty string are not accepted. The integer settings are parsed strictly rather than coerced.

### GitHub authentication

Curl supports two credential paths. Connect is the default and is recommended for deployed apps:

| Variable | Accepted value | Default | Notes |
| --- | --- | --- | --- |
| `CURL_GITHUB_AUTH` | Exactly `connect` or `app` | `connect` | `connect` uses Vercel Connect. `app` uses the self-managed GitHub App variables below. |
| `GITHUB_APP_SLUG` | A non-empty GitHub App slug / mention name, without `@` | `anturno-curl` | The value is the bot name used in `@` mentions. It also supplies the default Connect UID. |
| `CURL_GITHUB_CONNECTOR` | A non-empty Connect UID, normally `github/<slug>` | `github/<GITHUB_APP_SLUG>` | Used only when `CURL_GITHUB_AUTH=connect`. |
| `GITHUB_APP_ID` | A non-empty positive decimal GitHub App id | None | Required only for `CURL_GITHUB_AUTH=app`. |
| `GITHUB_APP_PRIVATE_KEY` | A non-empty GitHub App PEM private key | None | Required only for `CURL_GITHUB_AUTH=app`; store it as a deployment secret. |
| `GITHUB_WEBHOOK_SECRET` | Any non-empty webhook secret | None | Required only for `CURL_GITHUB_AUTH=app`; verifies direct GitHub webhook signatures. |

With Connect, the connector manages the installation token and inbound webhook verification. Do not set self-managed App credentials just to use Connect. With `app`, point the App webhook at `https://<deployment>/eve/v1/github`; the three self-managed values must be available to the server only.

### Automatic review and Checks

| Variable | Accepted value | Default | Notes |
| --- | --- | --- | --- |
| `CURL_AUTO_REVIEW` | Exactly `1`, `0`, `true`, or `false` | `false` | Automatic review is opt-in. When enabled, Curl reviews only `pull_request` events whose action is `opened`. |
| `CURL_AUTO_REVIEW_ALLOWLIST` | Unset, or a comma-separated list of exact `owner/repo` names | Unset | Matching is case-insensitive. Names may contain letters, digits, `_`, `-`, and `.`, must have one owner and one repo, and cannot contain empty entries, wildcards, URLs, refs, or extra `/` characters. |
| `CURL_CHECK_RUN` | Exactly `1`, `0`, `true`, or `false` | `true` | Creates the `Curl review` Check Run. Set it to `0` or `false` to disable Check Runs without disabling review comments. |

Automatic review is independent of mention-driven review. A repository allowlist applies only to automatic `pull_request` dispatch; it does not prevent a user from explicitly mentioning Curl. If automatic review is enabled without an allowlist, every repository where the App is installed is eligible. The allowlist is exact after case normalization, and duplicate entries are collapsed.

When a review starts for a pull request, Curl opens a `Curl review` Check Run on that head SHA with `in_progress` status. A successful review is completed with `neutral`, so findings do not block merging; cancellation and failure use `cancelled` and `failure`. Missing Checks permission or a failed Check Run API call is best effort and does not prevent Curl from posting the review comment. A Check Run is not created for ordinary issues.

## GitHub App setup

The App should have only these repository permissions:

- **Contents: Read-only** — read the repository and the pull-request checkout.
- **Issues: Read and write** — list, create, and update the timeline summary comment.
- **Pull requests: Read and write** — read pull-request metadata/diffs and participate in review-comment surfaces.
- **Checks: Read and write** — create, find, and complete the `Curl review` Check Run. This can be omitted only when Check Runs are disabled.
- **Metadata: Read-only** — required GitHub App repository metadata access.

Subscribe to these events:

- **Issue comments** — mention-driven comments on pull requests arrive on this event.
- **Pull request review comments** — mention-driven inline review-thread turns.
- **Pull requests** — required only when `CURL_AUTO_REVIEW` is enabled; Curl currently dispatches the `opened` action.

No administration, Actions, deployments, packages, repository secrets, or other write permission is required. Grant the App access only to the repositories that should be reviewable. For automatic review, use `CURL_AUTO_REVIEW_ALLOWLIST` as a second, deployment-side boundary.

## Model, privacy, and execution boundaries

Curl sends the pull-request metadata, diff, review instructions, and any repository files it reads to the configured OpenCode Go model. The provider endpoint is `https://opencode.ai/zen/go/v1/responses`; review the provider's data handling and your organization's policy before using Curl on private or regulated code. A changed file can contain sensitive material, so repository access and model-provider access must be treated as production data access.

The GitHub installation token is used by the channel/runtime and is not copied into the sandbox. Keep `OPENCODE_API_KEY`, App keys, webhook secrets, and other credentials in the deployment secret store; do not put them in prompts, fixtures, or repository files. Curl's default review is read-only: its Bash, web, and write-file tools are disabled, and its instructions prohibit executing repository code or changing the checkout.

Curl uses its own `just-bash` sandbox backend. Each session gets a private
in-memory `/workspace`; the guest has no network, credentials, interpreters,
package scripts, or long-lived processes. The channel uses its authenticated
GitHub API handle to materialize bounded repository blobs before the review,
so the installation token never enters the sandbox. These controls limit the
agent's sandbox; they do not replace GitHub App permissions, deployment secret
controls, or provider privacy review.

## Token and session limits

All limits are per session and must be positive decimal integers. The configured model context window and session budgets are separate caps:

| Setting | Default | Maximum |
| --- | ---: | ---: |
| Model context window | `200000` tokens | `10000000` tokens |
| Input budget | `1000000` tokens | `100000000` tokens |
| Output budget | `20000` tokens | `10000000` tokens |
| Session timeout | `604800000` ms (7 days) | `31536000000` ms (365 days) |

These are runtime safeguards, not provider billing guarantees. Increasing them can increase the amount of repository context and model output processed in one session.

## Platform-managed variables

Eve and Vercel may set the following variables. They are read to distinguish local builds from deployed/production runtimes; normally you should not set or override them as Curl configuration:

- `VERCEL=1` or a non-empty `VERCEL_ENV` identifies a Vercel environment. `VERCEL_ENV=development` is treated as local development; other values are treated as deployed by the production guard.
- `NODE_ENV=production` identifies a production runtime unless `EVE_DEV=1` is present. `EVE_DEV=1` is a local development override.

These variables are not credentials. The important safety rule is that `CURL_EVAL_MOCK` must remain disabled on deployed and production runtimes.

## Deployment checklist

1. Choose Connect or self-managed App credentials; do not configure both paths unnecessarily.
2. Grant only the App permissions listed above and subscribe only to the events you use.
3. Set `OPENCODE_API_KEY` in the deployment secret store.
4. Leave automatic review off until the webhook and mention-driven path work; then set `CURL_AUTO_REVIEW=1` and, for least privilege, set an explicit allowlist.
5. Run `bun run verify:config`, then deploy with `eve deploy`.
6. Send a test mention on a non-sensitive pull request and verify the summary comment and, when enabled, the `Curl review` Check Run.
