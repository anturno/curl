# Curl — agent notes

This project is an [eve](https://eve.dev/) agent. Before changing integrations,
read the matching guide under `node_modules/eve/docs/` (or https://eve.dev/docs).

## Product

- Public docs: [`docs/`](./docs/)
- Maintainer-only notes: [`internal/`](./internal/) (gitignored except `README.md`)
- Review pack: correctness + security only (`agent/instructions.md`)
- Inference: OpenCode Go via `OPENCODE_API_KEY` (`agent/agent.ts`; default `gpt-5.6-luna` @ high, Responses API)
- Ingress: GitHub channel at `/eve/v1/github` (`agent/channels/github.ts`)
- Deploy: `eve deploy`

## Integrations

Prefer the registry over hand-rolled wiring:

```bash
bunx eve registry search github
bunx eve registry view channel/github
```

Vercel Connect is the preferred path for GitHub App credentials and webhook
forwarding. Self-managed App credentials are supported with `CURL_GITHUB_AUTH=app`.

## Local commands

```bash
bun run check       # Biome
bun run typecheck
bun run build
bun run eval        # golden fixtures (CURL_EVAL_MOCK=1)
bun run eval:live   # same fixtures via OpenCode Zen
bun run dev
bun run deploy
```

**Bun ≥ 1.2** and **Node.js 24.x** are required (`packageManager` / `engines` in
`package.json`).
