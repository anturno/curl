# Curl

Curl is an open-source GitHub pull request reviewer. Ask it to look at a PR and
it posts **one clear summary**: correctness and security issues first, ranked by
severity. Noise stays out of the way.

## What you get

- **Correctness** — logic bugs, broken contracts, risky edge cases
- **Security** — auth gaps, injection, secret leaks, and similar issues in the diff
- **One comment** — a prioritized digest you can act on, not a pile of optional nits

On a pull request:

```text
@anturno-curl review
```

## Why it exists

Most review bots optimize for volume. Curl optimizes for signal: fewer comments,
higher stakes. Self-host it, bring your own model key, run it on the repos you
choose — including this one.

## Get started

Install dependencies with `bun install`, configure the values in
[`.env.example`](./.env.example), then deploy with `bun run deploy`.

Curl is mention-driven only. Ask it with `@anturno-curl review` on a pull
request, and it checks only the changed files. There are no automatic reviews,
published check runs, or web hooks beyond the GitHub App webhook. Curl reads
check runs only to report configured required-check evidence; grant the GitHub
App the repository permission **Checks: read**. If that permission is
unavailable, the check status is reported as `unknown`—Curl never infers a
passing check. See the
[`agent/instructions.md`](./agent/instructions.md) for the review contract and
the [CurlOS package](https://github.com/anturno/curlos) for the read-only
workspace lifecycle.

For local changes, run `bun run check`, `bun run typecheck`, and `bun test`.
Keep secrets in `.env.local` or the deployment secret store.

## Docs

- [Review contract](./agent/instructions.md)
- [Repository review policy](./docs/review-policy.md)
- [Domain glossary](./CONTEXT.md)
- [Agent development notes](./AGENTS.md)
- [CurlOS](https://github.com/anturno/curlos) — read-only review workspace runtime
- [Contributing](./CONTRIBUTING.md)
- [Security](./SECURITY.md)
- [Changelog](./CHANGELOG.md)

## License

[Apache-2.0](./LICENSE)
