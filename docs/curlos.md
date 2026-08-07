# CurlOS

CurlOS — the read-only review workspace runtime — lives in:

**https://github.com/anturno/curlos** (`@anturno/curlos`)

Curl consumes it as a package dependency (`@anturno/curlos`):

| Import | Use |
|---|---|
| `@anturno/curlos` | Policy + session (`openCurlOs`, limits, meters, remember/close) |
| `@anturno/curlos/sandbox` | just-bash Eve `SandboxBackend` (`agent/sandbox.ts`) |
| `@anturno/curlos/eve` | `curlOsForSandbox` for model tools |

Curl uses a custom diff-only `CheckoutProvider` in `agent/lib/checkout.ts`. It
fetches `pulls/{n}/files` and then `git/blobs/{sha}` for each changed file,
instead of the full-tree `openGitHubCurlOs` in `@anturno/curlos/github`.

Canonical docs: [README](https://github.com/anturno/curlos#readme),
[API](https://github.com/anturno/curlos/blob/main/docs/api.md),
[contract](https://github.com/anturno/curlos/blob/main/docs/contract.md).
