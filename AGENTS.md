# Curl — agent notes

This project is an [eve](https://eve.dev/) agent. Before changing integrations,
read the matching guide under `node_modules/eve/docs/` (or https://eve.dev/docs).

## Product

- Public docs: [`docs/`](./docs/)
- Engineering principles: [`principles.md`](./principles.md)
- Public contribution rules: [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- Review pack: correctness + security only (`agent/instructions.md`)
- Inference: OpenCode Go via `OPENCODE_API_KEY` (`agent/lib/agent-runtime.ts`; default `gpt-5.6-luna` @ medium reasoning, Responses API)
- Ingress: GitHub channel at `/eve/v1/github` (`agent/channels/github.ts`)
- Deploy: `eve deploy`

## Integrations

This is a minimal, self-managed GitHub App deployment. Credentials are set via
`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_WEBHOOK_SECRET`.

## Local commands

```bash
bun run check       # Biome
bun run typecheck
bun run build
bun run test
bun run dev
bun run deploy
```

**Bun ≥ 1.2** and **Node.js 24.x** are required (`packageManager` / `engines` in
`package.json`).

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for `anturno/curl`, using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the canonical labels `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md` if it exists.

### Domain docs

This is a single-context repo: read the root `CONTEXT.md` and relevant ADRs under `docs/adr/`. See `docs/agents/domain.md`.
