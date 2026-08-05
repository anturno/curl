# Contributing to Curl

Thanks for helping improve Curl. Prefer changes that can be exercised on pull
requests to this repository.

## Development

Requirements:

- [Bun](https://bun.sh) **≥ 1.2** (package manager + scripts)
- Node.js **24.x** (eve runtime)

```bash
bun install
cp .env.example .env.local   # fill OPENCODE_API_KEY (and GitHub auth)
bun run check                # Biome format + lint
bun run typecheck
bun test                     # unit/integration tests
bun run build
bun run verify:config        # offline, non-secret configuration check
bun run eval                 # golden PR fixtures (mock model; CI default)
bun run eval:live            # same fixtures against OpenCode Go (needs key)
bun run dev                  # eve HMR + REPL
```

The product is the `agent/` directory (instructions + GitHub channel). Deploy
with `eve deploy` — there is no separate frontend host. Read
[`docs/configuration.md`](./docs/configuration.md) before changing deployment
variables; `bun run verify:config` makes no GitHub or model requests and never
prints secret values.

Automatic review is disabled by default. Keep it opt-in with
`CURL_AUTO_REVIEW=1`/`true`, subscribe to `pull_request` only when desired, and
use `CURL_AUTO_REVIEW_ALLOWLIST` for an explicit repository boundary. The
mention-driven path remains available independently. Grant only the documented
GitHub App permissions and keep all keys in `.env.local` or the deployment
secret store; never enable `CURL_EVAL_MOCK` in production.

Review-quality gates live under `evals/review/` with fixtures in
`evals/fixtures/`. CI runs `bun test` and then `bun run eval` with
`CURL_EVAL_MOCK=1` so format contracts stay green without a provider key. Live
model evals are explicit (`bun run eval:live`) and are not mandatory CI gates.
See [`docs/troubleshooting.md`](./docs/troubleshooting.md) for failure and
teardown guidance.

## Review contract

Default reviews cover **correctness + security** only. Keep PRs focused. Prefer
small releases over large speculative features. Public scope is in
[`docs/architecture.md`](./docs/architecture.md).

## Changesets

User-facing changes should include a changeset:

```bash
npx changeset
```

Choose an appropriate bump and describe the change in product language.
CI / the release workflow opens a “Version Packages” PR when changesets land
on `main`. After that PR is merged, the workflow runs the deterministic gates,
then creates the application’s `vX.Y.Z` Git tag and GitHub Release. Curl is
private and is not published to npm.

## Developer Certificate of Origin (DCO)

By contributing, you certify the
[Developer Certificate of Origin](https://developercertificate.org/) (DCO).
Sign off every commit:

```bash
git commit -s -m "Explain why this change exists"
```

GitHub’s “Signed-off-by” trailer is enough; we do not require a CLA for the
Apache-2.0 core today.

## Pull requests

- Use the PR template
- Include a changeset when the change is user-visible
- Keep secrets out of the tree (use `.env.local`; see `.env.example`)
- Link related issues when applicable

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Security

Report vulnerabilities privately — see [SECURITY.md](./SECURITY.md).
