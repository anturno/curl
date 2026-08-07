# Architecture

Curl is a minimal [eve](https://eve.dev/) agent. There is no separate web app.
The product is the `agent/` directory, deployed with `eve deploy`.

```text
@anturno-curl review  (on a PR)
        │
        ▼
Self-managed GitHub App
        │  webhook
        ▼
Deployed eve host  →  POST /eve/v1/github
        │
        ├─ verify webhook
        ├─ installation token for that repo
        ├─ PR diff + diff-only sandbox checkout
        └─ agent/ (instructions, OpenCode Go model)
                │
                ▼
        One new prioritized summary comment
```

## Runtime modules

- `agent/agent.ts` wires Eve to `createAgentDefinition`.
- `agent/channels/github.ts` adapts the GitHub webhook and lifecycle callbacks.
  It owns self-managed GitHub App credentials and the diff-only CurlOS session.
- `agent/lib/review-workflow.ts` has two entry points: `dispatch` for mentions
  and `handle` for turn/session events. It posts one summary comment.
- `agent/lib/config.ts` validates the small environment surface.
- `agent/lib/agent-runtime.ts` composes the OpenCode Go provider.
- `agent/lib/checkout.ts` implements a diff-only `CheckoutProvider` that
  materializes only the pull request's changed files.
- `agent/sandbox.ts` wires `@anturno/curlos/sandbox` (just-bash Eve backend).

## CurlOS boundary

CurlOS confines model-facing reads and searches to `/workspace`, bounds their
inputs and outputs, and exposes no model-controlled write, shell, network, or
process capability. The custom sandbox uses just-bash's in-memory virtual
filesystem and has no guest network.

Curl now uses its own diff-only checkout. It fetches the PR changed files via
`pulls/{n}/files`, then each blob via `git/blobs/{sha}`. Credentials stay on the
host; only decoded file bytes enter the workspace.

## Default review pack

Correctness and security only. Style nits are out of scope. Output is one
prioritized summary comment posted as a new comment on each review.

There are no automatic reviews, no Check Runs, and no historical/stale-head
annotations.
