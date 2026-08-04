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

Prefer a **release tag** (`v0.1.0+`); `main` is the dogfood line.

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
mention-driven turns; keep `pull_request` if you want dogfood auto-review.

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
`CURL_DOGFOOD_REPO`, `CURL_DOGFOOD_AUTO_REVIEW` — see `.env.example`.

Inference uses OpenCode Go’s **Responses** API (`gpt-5.6-luna`). Keep
`OPENCODE_API_KEY` on the deploy; never set `CURL_EVAL_MOCK=1` in production.
