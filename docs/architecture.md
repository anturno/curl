# Architecture

Curl is an [eve](https://eve.dev/) agent. There is no separate web app — the
product is the `agent/` directory, deployed with `eve deploy` (or
`eve build` + `eve start`).

```text
@anturno-curl review  (on a PR)
        │
        ▼
GitHub App / Vercel Connect
        │  webhook
        ▼
Deployed eve host  →  POST /eve/v1/github
        │
        ├─ verify webhook
        ├─ installation token for that repo
        ├─ PR diff + sandbox checkout (eve)
        ├─ check run: Curl review (in_progress)
        └─ agent/ (instructions, OpenCode Go model)
                │
                ▼
        Prioritized summary comment + check run completed (neutral)
```

## Runtime modules

The deployed entry points are intentionally thin composition roots:

- `agent/agent.ts` wires Eve to `createAgentDefinition`.
- `agent/channels/github.ts` adapts Eve webhook and lifecycle callbacks to the
  review workflow and owns only GitHub credentials and channel configuration.
- `agent/lib/review-workflow.ts` is the deep review module. Its two entry points
  are `dispatch` for inbound triggers and `handle` for turn/session events. It
  owns review policy, check-run ordering, stale-head protection, comment
  identity, failure delivery, and durable check-run metadata.
- `agent/lib/review-check-run.ts` contains the GitHub Check Run adapter and
  defensive parsing primitives used behind the workflow seam.
- `agent/lib/config.ts` validates environment input. `loadReviewConfig` accepts
  an explicit environment, while the exported runtime config is composed once
  for production.
- `agent/lib/agent-runtime.ts` composes the provider model and runtime guards
  from validated configuration; provider construction is not part of the Eve
  channel adapter.
- `agent/sandbox.ts` wires `@anturno/curlos/sandbox` (just-bash Eve backend).
- CurlOS ([anturno/curlos](https://github.com/anturno/curlos)) owns the review
  workspace: policy, session API, host adapters, and GitHub checkout provider.
  Tools use `@anturno/curlos` / `@anturno/curlos/eve`; the GitHub channel opens
  sessions via `@anturno/curlos/github`.

## CurlOS boundary

CurlOS confines model-facing reads and searches to `/workspace`, bounds their
inputs and outputs, and exposes no model-controlled write, shell, network, or
process capability. The custom sandbox uses just-bash's in-memory virtual
filesystem, has no guest network, and only permits bounded `find`/`grep`
commands. This is a small application-owned backend inspired by AgentOS's
capability model, not a copy of its Rust kernel or VFS.

Canonical docs and the `@anturno/curlos` package live in
[anturno/curlos](https://github.com/anturno/curlos). See the local pointer
[`curlos.md`](./curlos.md).

The workflow interface is the test surface. Tests provide fake Eve GitHub
contexts and GitHub request responses, so lifecycle behavior can be verified
without a deployed webhook or provider call. No speculative cross-platform port
is introduced until a second production adapter exists.

## Default review pack

Correctness and security only. Style nits are out of scope unless they cause a
real bug or vulnerability. Output is one prioritized summary comment. Progress
appears as a GitHub Check Run named **Curl review** (requires Checks: write;
disable with `CURL_CHECK_RUN=0`). Completed reviews conclude `neutral` so findings
do not block merges; cancelled or failed sessions use their matching conclusion.

## Out of scope (for now)

Not included yet: hosted multi-tenant product, dashboard/login, automatic code
fixes, dense inline comment threads, or ticket filing.
