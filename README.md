# Curl

![Curl — judgment for pull requests](./docs/assets/banner.png)


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

Install and deploy: **[docs/install.md](./docs/install.md)**

Automatic review is opt-in and stays disabled until `CURL_AUTO_REVIEW=1` (or
`true`) is set. Keep the App allowlisted to the repositories you intend to
review, and use the mention-driven path first. See the
[configuration guide](./docs/configuration.md) for the exact permissions,
privacy boundary, and environment values.

For local changes, run `bun run check`, `bun run typecheck`, `bun test`,
`bun run verify:config`, and the deterministic mock-backed `bun run eval`.
`bun run eval:live` is an explicit provider-backed check and is not a mandatory
CI gate. Keep secrets in `.env.local` or the deployment secret store; never use
`CURL_EVAL_MOCK=1` in production. See [troubleshooting](./docs/troubleshooting.md)
when a review or deployment does not behave as expected.

## Docs

- [Install](./docs/install.md)
- [Configuration](./docs/configuration.md)
- [Troubleshooting](./docs/troubleshooting.md)
- [Architecture](./docs/architecture.md)
- [Contributing](./CONTRIBUTING.md)
- [Security](./SECURITY.md)
- [Changelog](./CHANGELOG.md)

## License

[Apache-2.0](./LICENSE)
