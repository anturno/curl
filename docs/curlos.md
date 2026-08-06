# CurlOS

CurlOS is Curl's review-only capability boundary, and `curl-sandbox` is the
runtime that hosts it. Together they are deliberately smaller than a
general-purpose agent operating system: a review needs to *inspect* a checkout,
never to run it.

Curl owns this backend outright. There is no Docker daemon, no microVM, and no
Vercel Sandbox in the review path — the workspace is an in-memory virtual
filesystem inside the Eve server process, driven by
[just-bash](https://github.com/vercel-labs/just-bash).

## Layers

```text
agent/sandbox.ts                 defineSandbox({ backend })
        │
        ▼
agent/lib/curl-sandbox.ts        Eve SandboxBackend over just-bash
        │                        in-memory VFS · command allow-list · limits
        │
agent/lib/curlos-session.ts      open → inspect → close
        │                        CheckoutProvider · CurlOsSession · manifest
        ├─────────────► agent/lib/github-checkout.ts
        │                        host-side blob materialization (no token inside)
        ├─────────────► agent/lib/curlos-sandbox-host.ts
        │                        SandboxSession → CurlOsHost / WorkspaceWriter
        ▼
agent/lib/curlos.ts              model-facing capability policy
        │                        path anchoring · input bounds · output caps
        ▼
agent/tools/{read_file,glob,grep}.ts
```

The split is deliberate. `curl-sandbox.ts` is *mechanism* — one host that
happens to be just-bash. `curlos.ts` is *policy* — what the model may ask for,
independent of who executes it. `curlos-session.ts` owns the
`open → inspect → close` loop. Policy imports nothing Eve-specific or
just-bash-specific, so a future host can satisfy the same contract without
touching the review agent.

## Contract

- The workspace root is `/workspace`.
- `read_file`, `glob`, and `grep` reject any path outside that root, including
  `..` traversal and `$HOME`.
- Search and read inputs have finite size and match limits.
- Tool output is capped before it enters model context.
- Each command has a wall-clock deadline; each session has a resident
  workspace ceiling.
- `bash`, `write_file`, `web_fetch`, `web_search`, `agent`, and `ask_question`
  are disabled.
- The sandbox has **no guest network** at all.
- GitHub credentials never enter the sandbox.
- No long-lived processes: `spawn` throws.

## Limits

| Limit | Value | Enforced by |
|---|---|---|
| Resident workspace bytes | 64 MB | just-bash `maxFileSystemBytes` → `ENOSPC` |
| Wall-clock per command | 10 s | just-bash `maxExecutionTimeMs` → exit `124` |
| Command output | 100 KB | just-bash `maxOutputSize` |
| Commands per exec | 32 | just-bash `maxCommandCount` |
| Open file descriptors | 16 | just-bash `maxFileDescriptors` |
| Glob operations | 2,000 | just-bash `maxGlobOperations` |
| Checkout files / per-file / total bytes | 500 / 2 MB / 64 MB | `DEFAULT_CURL_OS_LIMITS` |
| Blob fetch concurrency | 8 | `github-checkout.ts` |
| Model-facing read/search bounds | `CURL_OS_LIMITS` | `curlos.ts` |

The workspace lives in the Eve server's heap, so the byte and time ceilings are
load-bearing rather than cosmetic: repository content is untrusted, and an
oversized or slow checkout would otherwise be a memory- or CPU-exhaustion
vector against the host process. Both fail loudly instead.

## Command allow-list

just-bash is constructed with `commands: ["find", "grep", "head"]`, so no other
builtin is even registered. On top of that, `assertAllowedCommand` requires the
whole command to match a bounded shape:

```text
find … -type f -path … -print | head -n <N>
grep -R …                     | head -n <N>
```

and rejects `&&`, `||`, `;`, `$(…)`, backticks, redirection, newlines, and
`find`'s side-effecting actions (`-delete`, `-exec`, `-fprintf`, …). Everything
runs with a fixed `SAFE_ENV`; no deployment environment variable is copied in.

## Checkout

Eve's built-in GitHub checkout runs `git init` / `git fetch` inside the
sandbox and brokers the installation token at a network firewall. CurlOS does
not use it, because CurlOS has no network and no `git`.

Instead, [`github-checkout.ts`](../agent/lib/github-checkout.ts) materializes
the review workspace **host-side**: it resolves a commit SHA (not a branch
name), reads the Git Trees API, fetches blobs concurrently through Eve's
authenticated GitHub handle, and writes decoded bytes into the virtual
filesystem. Only blobs that report a tree `size` are fetched, and their total
is capped at the same 64 MB as the resident workspace — so the budget is known
before materialization. The installation token stays in the host process. The
sandbox never receives a token, a remote URL, or a credential helper — there is
no firewall to configure because there is no egress to govern.

Clearing `/workspace` restores it as an empty directory, so a tree with no
blobs still leaves a usable working directory for `find` and `grep`.

## Threat model

**Covered.** Untrusted repository content cannot execute: no interpreter, no
package scripts, no daemons, no PTYs, no `spawn`. It cannot reach the network,
read outside `/workspace`, see credentials or deployment environment, write to
the host filesystem, or exhaust host memory or CPU without hitting a bound.
Because the VFS is purely in-memory with no host filesystem binding, a
path-resolution bug has nothing to escape *into*.

**Not covered.** There is no VM or process isolation — this runs in the Eve
server process, which is only acceptable because repository code is never
executed. Concurrent sessions share host memory, so the 64 MB ceiling
multiplies across in-flight reviews. And no sandbox stops **prompt injection**
from repository content; that is handled in the review pack
(`agent/instructions.md`), not here.

just-bash's `defenseInDepth` layer is deliberately **off**. It installs Node
module hooks that Bun does not implement, so leaving it at its 3.2 default
breaks every local test run; its `"auto"` mode does not detect the gap. It is a
secondary layer by just-bash's own documentation, and dev/prod parity on a
security boundary is worth more than a layer that only works in one of them.

## Deployment constraint

**`BACKEND_NAME` must stay `"just-bash"`.** This is not cosmetic.

Eve decides which optional engine packages to trace into a hosted build by
matching the backend name recorded in the compiled manifest against a fixed
table (`OPTIONAL_ENGINE_PACKAGES_BY_BACKEND_NAME` in Eve's Nitro host).
Configured packages take Nitro's externalize-and-trace path; unconfigured ones
are pinned as plain externals that are "never inlined and never traced." A name
Eve does not recognize therefore ships a function whose `import … from
"just-bash"` resolves to nothing, and the deployment dies on cold start:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'just-bash'
imported from /var/task/index.mjs
```

The same match keeps Eve from pruning local sandbox backends out of the Vercel
build.

This does not reproduce locally. `bun run build` uses the `node-server` preset,
which resolves from your `node_modules`; only the `vercel` preset traces. To
reproduce a hosted build before deploying:

```bash
VERCEL=1 bun run build
ls .vercel/output/functions/__server.func/node_modules/just-bash   # must exist
```

For a stronger check, copy `.vercel/output/functions/__server.func` to an empty
directory and run `node index.mjs` there — that simulates `/var/task` and fails
exactly as production would.

## Known gaps

- **just-bash is beta** and pinned exactly. Read its changelog before bumping;
  the 3.1 → 3.2 bump silently flipped `defenseInDepth` on by default.

## Testing

| File | Covers |
|---|---|
| [`tests/curl-sandbox.test.ts`](../tests/curl-sandbox.test.ts) | isolation, command rejection, path escape, byte ceiling, budget release, cancellation, shutdown |
| [`tests/github-checkout.test.ts`](../tests/github-checkout.test.ts) | host-side materialization, request shape, empty-tree workspace restore, unsized-blob skip, workspace-budget rejection, multi-blob checkout, branch-ref → commit SHA |
| [`tests/curlos.test.ts`](../tests/curlos.test.ts) | path policy, output bounds, host list/search seam |
| [`tests/curlos-session.test.ts`](../tests/curlos-session.test.ts) | open → inspect → close, manifest, shutdown |

## Relationship to AgentOS

CurlOS borrows [AgentOS](https://github.com/rivet-dev/agentos)'s useful
concepts — deny-by-default capabilities, scoped filesystem access, bounded
resource use — and none of its implementation. It does not copy the Rust
kernel, VFS, sidecar protocol, process table, or virtual network, and it does
not depend on AgentOS at all. Those parts are unnecessary for a read-only
review pack and would create a second security-critical operating system to
maintain; the published AgentOS tree is roughly 765 MB against just-bash's
21 MB.

## Session surface

The intended caller-facing API is `open → inspect → close`: host-side checkout
into `/workspace`, then bounded `readFile` / `glob` / `grep`, then release.
See [ADR 0001](./adr/0001-curlos-session-surface.md) for the TypeScript
contract (`CurlOsSession`, `CheckoutProvider`, `CheckoutManifest`). Today's
modules already implement the pieces; the ADR is the seam they should converge
on.

## Contract for a future host

Replace the backend only after measuring a real limitation. Any replacement
must preserve:

1. one isolated runtime per review session;
2. a fresh or explicitly identified checkout;
3. no guest-visible secrets and no outbound network;
4. bounded reads, searches, output, wall-clock time, and memory;
5. no writes, interpreters, package scripts, daemons, or PTYs.

`curlos.ts` should not need to change when that happens. If it does, the seam
is in the wrong place.
