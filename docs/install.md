# Install

Three steps to run Curl on a repository.

## 1. Deploy

```bash
bun install
eve link                 # or: vercel link
vercel env add OPENCODE_API_KEY
eve deploy
```

Self-host: `bun run build && bun start` (serves the Nitro output under `.output/`).

Prefer a **release tag** (`v0.1.0+`); `main` is the development line.

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
mention-driven turns; keep `pull_request` if you want automatic review.

Grant the App **Checks: Read and write** so Curl can post an in-progress
`Curl review` check run on the PR (same surface as Claude Code Review). Without
it, reviews still work; only the Checks-tab status is skipped.

**Self-managed GitHub App:** set `CURL_GITHUB_AUTH=app` and App credentials
(see [`.env.example`](../.env.example)). Webhook URL:

```text
https://<your-deployment>/eve/v1/github
```

## 3. Review a PR

```text
@anturno-curl review
```

Optional env: `OPENCODE_MODEL` (default `gpt-5.6-luna`), `GITHUB_APP_SLUG`,
`CURL_AUTO_REVIEW`, and `CURL_CHECK_RUN` — see `.env.example`. When automatic
review is enabled, it applies to every repository where the GitHub App is
installed. While a review runs, the PR Checks tab shows **Curl review**
(in progress → completed); the summary comment is still posted on the PR.

Inference uses OpenCode Go’s **Responses** API (`gpt-5.6-luna`). Keep
`OPENCODE_API_KEY` on the deploy; never set `CURL_EVAL_MOCK=1` in production.
