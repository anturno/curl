# CurlOS

CurlOS — the read-only review workspace runtime — lives in:

**https://github.com/anturno/curlos** (`@anturno/curlos`)

Curl consumes it as a package dependency (`@anturno/curlos`):

| Import | Use |
|---|---|
| `@anturno/curlos` | Policy + session (`openCurlOs`, limits, meters, remember/close) |
| `@anturno/curlos/fixture` | Local/in-memory checkout for evals |
| `@anturno/curlos/sandbox` | just-bash Eve `SandboxBackend` (`agent/sandbox.ts`) |
| `@anturno/curlos/eve` | `curlOsForSandbox` for model tools |
| `@anturno/curlos/github` | Host-side GitHub checkout (`openGitHubCurlOs`) |

Canonical docs: [README](https://github.com/anturno/curlos#readme),
[API](https://github.com/anturno/curlos/blob/main/docs/api.md),
[contract](https://github.com/anturno/curlos/blob/main/docs/contract.md).
