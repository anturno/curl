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

## Default review pack

Correctness and security only. Style nits are out of scope unless they cause a
real bug or vulnerability. Output is one prioritized summary comment. Progress
appears as a GitHub Check Run named **Curl review** (requires Checks: write;
disable with `CURL_CHECK_RUN=0`). The check always concludes `neutral` so it
does not block merges.

## Out of scope (for now)

Not included yet: hosted multi-tenant product, dashboard/login, automatic code
fixes, dense inline comment threads, or ticket filing.
