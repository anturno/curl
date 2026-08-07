# Contributing to Curl

Thanks for helping improve Curl. Prefer changes that can be exercised on pull
requests to this repository.

## Development

Requirements:

- [Bun](https://bun.sh) **≥ 1.2** (package manager + scripts)
- Node.js **24.x** (eve runtime)

```bash
bun install
cp .env.example .env.local   # fill OPENCODE_API_KEY and GitHub App credentials
bun run check                # Biome format + lint
bun run typecheck
bun test
bun run build
bun run dev                  # eve HMR + REPL
```

The product is the `agent/` directory (instructions, tools, sandbox, and GitHub
channel). Deploy with `eve deploy` — there is no separate frontend host. Read
[`.env.example`](./.env.example) before changing deployment variables.

Curl is mention-driven only: `@<GITHUB_APP_SLUG> review` on a pull request. There
is no automatic review, no Check Run, and no eval mock. Grant only the
documented GitHub App permissions and keep all keys in `.env.local` or the
deployment secret store.

## Review contract

Default reviews cover **correctness + security** only. Keep PRs focused. Prefer
small releases over large speculative features. Public scope is in
[`agent/instructions.md`](./agent/instructions.md), [`CONTEXT.md`](./CONTEXT.md),
and the [CurlOS package](https://github.com/anturno/curlos).

## Changesets

User-facing changes should include a changeset:

```bash
bunx changeset
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
