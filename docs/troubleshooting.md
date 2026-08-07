# Troubleshooting

For a deployed issue, record the repository, pull-request number, and head SHA.
Do not paste API keys, private keys, webhook secrets, provider responses, or
full environment dumps into an issue.

## Missing comments

- Confirm the event is on a pull request or review thread, not an ordinary issue.
- Use the configured slug exactly: `@<GITHUB_APP_SLUG>`. The default is
  `@anturno-curl`; the mention must not be authored by the App or another bot.
- Confirm the App receives **Issue comments** and **Pull request review
  comments**, and that the webhook points to `/eve/v1/github`.
- Confirm the App has **Issues: Read and write** and **Pull requests: Read and
  write**.

## Failed reviews

- Read the short failure comment and retain its error id; Curl deliberately omits
  provider response bodies and exception messages from diagnostics.
- Confirm `OPENCODE_API_KEY`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and
  `GITHUB_WEBHOOK_SECRET` are present in the deployed environment.
- Confirm the selected `OPENCODE_MODEL` id is valid for OpenCode Go.
- After correcting configuration or permissions, mention Curl again on the
  current PR head. A failed run is not automatically retried.

## Diff-only checkout limits

Curl fetches only the changed files for a pull request. If a PR changes more
files or bytes than the configured CurlOS limits, the review fails loudly. The
limits are hardcoded defaults; reduce the review scope or split the PR.

## Configuration errors

- Integer settings require positive decimal integers; `0`, negative values,
  decimals, and exponent notation are rejected.
- `OPENCODE_REASONING` accepts only `high`, `medium`, or `low`.

A build can succeed without `OPENCODE_API_KEY`, but a deployed runtime cannot
serve real reviews without it.
