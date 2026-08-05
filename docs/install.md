# Install

Three steps to run Curl on a repository. See the [configuration guide](./configuration.md)
for the complete variable, permission, privacy, and limit reference.

## 1. Deploy

```bash
bun install
eve link                 # or: vercel link
vercel env add OPENCODE_API_KEY
eve deploy
```

Self-host: `bun run build && bun start` (serves the Nitro output under `.output/`). Before deploying, run the local deterministic checks and the offline configuration verifier:

```bash
bun run check
bun run typecheck
bun test
bun run build
bun run verify:config
bun run eval
```

Prefer a **release tag** (`v0.1.0+`); `main` is the development line. Curl is a private application, not an npm package: the release workflow creates a `vX.Y.Z` Git tag and GitHub Release after the version PR is merged.

## 2. Connect GitHub

**Vercel Connect (recommended):**

```bash
bun add -g vercel@latest
vercel link
vercel connect create github --name anturno-curl --triggers
vercel connect detach github/anturno-curl --yes
vercel connect attach github/anturno-curl --triggers --trigger-path /eve/v1/github --yes
```

Subscribe the App to `issue_comment` and `pull_request_review_comment` for
mention-driven turns. Subscribe to `pull_request` only if automatic review is
wanted; Curl dispatches that path only when a PR is opened.

Grant only these repository permissions: **Contents: Read-only**, **Issues: Read
and write**, **Pull requests: Read and write**, **Checks: Read and write**, and
**Metadata: Read-only**. Checks permission is needed for the `Curl review`
Check Run; without it, review comments still work. No administration, Actions,
deployments, packages, or repository-secrets permission is required. The exact
permission and event rationale is in [configuration](./configuration.md).

**Self-managed GitHub App:** set `CURL_GITHUB_AUTH=app` and App credentials
(see [`.env.example`](../.env.example)). Webhook URL:

```text
https://<your-deployment>/eve/v1/github
```

## 3. Review a PR

```text
@anturno-curl review
```

Automatic review is disabled by default. Opt in with `CURL_AUTO_REVIEW=1` or
`true`, subscribe to `pull_request`, and preferably set
`CURL_AUTO_REVIEW_ALLOWLIST=owner/repo` (comma-separated for multiple exact
repositories). With no allowlist, every repository where the App is installed
is eligible; an allowlist does not affect explicit `@<GITHUB_APP_SLUG>`
mentions. The automatic path runs only when a PR is opened, not on every push.

While a review runs, the PR Checks tab shows **Curl review** (`in_progress` →
`completed`); the summary comment is still posted on the PR. Successful checks
are `neutral` and do not block merges. Set `CURL_CHECK_RUN=0` to disable that
surface while retaining comments.

Inference uses OpenCode Go’s **Responses** API (`gpt-5.6-luna`). Keep
`OPENCODE_API_KEY` on the deploy and review the [privacy and sandbox
boundaries](./configuration.md#model-privacy-and-execution-boundaries). Never
set `CURL_EVAL_MOCK=1` in production. For deployment failures, see
[troubleshooting](./troubleshooting.md).
