# Curl — agent notes

This project is an [eve](https://eve.dev/) agent. Before changing integrations,
read the matching guide under `node_modules/eve/docs/` (or https://eve.dev/docs).

## Product

- Product docs: [`README.md`](./README.md) and [`agent/instructions.md`](./agent/instructions.md)
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

# Principles

- **Less is more.** Prefer the smallest design that works.
- **Move fast.** Users are few; breaking changes are expected. Delete, rewrite, and simplify instead of preserving compatibility too early.
- **Earn complexity.** No speculative configs, checks, abstractions, or seams. Add them only when real use demands them.
- **Hide complexity.** Product, technology, and design should absorb complexity and present simple surfaces.
- **Keep signal high.** Optimize for useful outcomes, locality, and clear defaults—not ceremony.

## Design

- **OOP.** Put behavior with the data and invariants it protects; prefer cohesive modules and composition over inheritance. Use functions when clearer.
- **SOLID.** Use it as a pressure test, not ceremony: one reason to change, small interfaces, substitutability, and inversion only at real seams.
- **Clean design.** Separate policy from mechanism; keep policy dependencies pointed inward; push side effects to the edges.
- **Deep modules.** Small interface, rich implementation. Optimize for leverage, locality, and testability.
- **Seams.** Inject dependencies at real seams. Add an adapter only when two real implementations exist. Test through the interface.
- **Patterns.** Earn them. If indirection does not hide complexity or add leverage, delete it.

## TypeScript

- Keep `strict` on. Prefer `unknown` plus narrowing at runtime boundaries; never use `any` to silence errors.
- Use discriminated unions for finite states and events; make transitions exhaustive.
- Prefer `readonly`, immutable data, type-only imports, and inferred local types. Use `type` for unions; use `interface` when an object contract benefits from extension.
- Types are not validation: parse env and external data at the edge, then pass trusted types inward.
- Avoid casts and non-null assertions. Isolate and justify them when a boundary makes one unavoidable.
- Tighten compiler options when earned, not for configuration ceremony.

**References:** [Everyday Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html) · [Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) · [Functions](https://www.typescriptlang.org/docs/handbook/2/functions.html) · [`strict`](https://www.typescriptlang.org/tsconfig/strict.html)
