# Troubleshooting

Start with the offline configuration check. It makes no GitHub or OpenCode requests and never prints secret values:

```bash
bun run verify:config
```

For a deployed issue, record the repository, pull-request number, head SHA, and any safe error id. Do not paste API keys, private keys, webhook secrets, provider responses, or full environment dumps into an issue.

## Missing comments

- Confirm the event is on a pull request or review thread, not an ordinary issue.
- For a mention-driven turn, use the configured slug exactly: `@<GITHUB_APP_SLUG>`. The default is `@anturno-curl`; the mention must not be authored by the App or another bot.
- Confirm the App receives **Issue comments** and **Pull request review comments**, and that the webhook points to `/eve/v1/github`.
- Confirm the App has **Issues: Read and write** and **Pull requests: Read and write**. Check Runs are not required for the comment itself.
- For an automatic turn, confirm `CURL_AUTO_REVIEW` is `1`/`true`, `CURL_AUTO_REVIEW_ALLOWLIST` includes the exact repository when set, and the App receives **Pull requests**. Automatic dispatch currently handles only a newly opened pull request; pushes to an existing PR do not start a new automatic turn.

## Missing Check Runs

- Check that `CURL_CHECK_RUN` is unset, `1`, or `true`. `0` and `false` intentionally disable it.
- Check **Checks: Read and write** on the GitHub App and make sure the App is installed on the repository.
- Check Runs are created only when Curl has a pull-request number and head SHA. They are best effort: a permission or API failure should still leave the review comment.
- Look for the exact name **Curl review** on the commit checked by Curl. A run may be attached to an earlier head if the PR changed while the review was running.

## Failed reviews

- Read the short failure comment and retain its error id; Curl deliberately omits provider response bodies and exception messages from diagnostics.
- Run `bun run verify:config` and confirm `OPENCODE_API_KEY` is present for the deployed runtime, the selected model id is valid for OpenCode Go, and the token/session limits are within their documented ranges.
- If using a self-managed App, confirm all three values are present: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_WEBHOOK_SECRET`. With Connect, confirm the connector UID is attached to the deployment instead.
- Confirm `CURL_EVAL_MOCK` is not enabled in production. The mock is for local deterministic evals only and cannot publish a production review.
- After correcting configuration or permissions, mention Curl again on the current PR head. A failed run is not automatically retried.

## Stale or historical reviews

Curl records the reviewed commit SHA. If the pull request receives a new commit before the review is delivered, Curl posts a historical-review warning instead of making old findings look current. The Check Run remains attached to the commit it reviewed and its output identifies the two SHAs.

Run a fresh mention on the current head to review the new diff. Do not treat a historical comment or its `neutral` Check Run as a statement about code that Curl did not inspect.

## Configuration errors

Configuration parsing is strict:

- Booleans accept only `1`, `0`, `true`, or `false`, in lowercase.
- `CURL_GITHUB_AUTH` accepts only `connect` or `app`.
- Token and timeout settings require positive decimal integers; `0`, negative values, decimals, and exponent notation are rejected.
- An allowlist must contain comma-separated exact `owner/repo` entries with no empty items, wildcard, URL, or extra path segment.
- `CURL_GITHUB_AUTH=app` requires non-empty App id, PEM private key, and webhook secret values.

Fix the named variable without printing its value, then rerun `bun run verify:config`. A build can succeed without `OPENCODE_API_KEY`, but a deployed or production runtime cannot serve real reviews without it.

## Local eval teardown warnings

`bun run eval` uses `CURL_EVAL_MOCK=1` and does not call OpenCode or GitHub. Eve may emit a best-effort sandbox/session teardown warning after fixture assertions have completed. First check the command exit status and `.eve/junit.xml`: a zero exit status with zero JUnit failures means the fixture assertions passed, while a non-zero status or failed testcase still needs investigation.

If the warning is accompanied by a failure, rerun `bun run eval` with no live provider credentials required and inspect the first failing fixture. Do not use `CURL_EVAL_MOCK=1` to validate a production deployment; it is intentionally rejected there. The live suite is opt-in with `bun run eval:live` and is not a mandatory CI gate.

## Deployment verification

Run the same deterministic checks used before release:

```bash
bun run check
bun run typecheck
bun test
bun run build
bun run verify:config
bun run eval
```

After `eve deploy`, verify the deployment has the expected secret presence and non-secret settings with `bun run verify:config` in the deployment environment, then send a mention-driven review on a disposable or non-sensitive pull request. Confirm both the single summary comment and the `Curl review` Check Run when Checks are enabled. If the smoke review fails, use the deployment logs and safe error id; do not enable the eval mock or copy secrets into logs while debugging.
