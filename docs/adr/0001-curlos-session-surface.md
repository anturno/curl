# ADR 0001 — CurlOS session surface (`open → inspect → close`)

- **Status:** Accepted
- **Date:** 2026-08-06
- **Deciders:** Curl maintainers

## Context

Curl already splits mechanism (`curl-sandbox.ts` + just-bash) from policy
(`curlos.ts`) and materializes the review head host-side
(`github-checkout.ts`). The model then inspects via `read_file` / `glob` /
`grep`.

That loop is the product. What is missing is a single session interface that
owns it — so Eve wiring stays thin, evals can feed fixture trees, and CurlOS
can later ship as a library without dragging Eve types into the inspect API.

This ADR records the target surface. It does **not** require an immediate
extract to `@anturno/curlos`; implementation can land in-tree behind the same
types.

## Decision

CurlOS's public contract is a **read-only review workspace session**:

1. **open** — resolve a commit SHA, materialize a bounded tree into
   `/workspace` through a host-side checkout provider, return a session plus a
   checkout manifest.
2. **inspect** — `readFile` / `glob` / `grep` (and later native list/search)
   under path policy and output caps. No model-facing `run`, write, network,
   or spawn.
3. **close** — drop the session; release resident workspace bytes.

Credentials never enter the workspace. Checkout providers fetch on the host
and write decoded bytes only. The default host remains an in-memory VFS
(just-bash today); the session API must not require a guest shell.

### Target TypeScript surface

```ts
/** Workspace root. All inspect paths resolve under this prefix. */
export const CURL_OS_ROOT = "/workspace";

export type CurlOsProfile = "inspect";
// Future profiles (evidence / prove) are out of scope for this ADR.

export interface CurlOsLimits {
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxWorkspaceBytes: number;
  readonly maxContextLines: number;
  readonly maxGlobMatches: number;
  readonly maxInputLength: number;
  readonly maxOutputBytes: number;
  readonly maxReadLines: number;
  readonly maxReadOffset: number;
  readonly maxSearchMatches: number;
  readonly maxSearchPatternLength: number;
}

export interface CheckoutRef {
  readonly owner: string;
  readonly repo: string;
  /** Prefer an object id. Providers may resolve a ref once, then pin the SHA. */
  readonly sha: string;
}

export interface CheckoutFile {
  readonly path: string; // workspace-relative, e.g. "src/foo.ts"
  readonly sha: string;
  readonly bytes: number;
}

export interface CheckoutSkip {
  readonly path: string;
  readonly reason: "too-large" | "unsized" | "binary" | "filtered" | "budget";
}

/** What open() actually put in /workspace — and what it refused. */
export interface CheckoutManifest {
  readonly sha: string;
  readonly root: typeof CURL_OS_ROOT;
  readonly files: readonly CheckoutFile[];
  readonly skipped: readonly CheckoutSkip[];
  readonly bytes: number;
}

/**
 * Host-side fetcher. Implementations hold credentials; the session only
 * receives decoded bytes through WorkspaceWriter.
 */
export interface CheckoutProvider {
  materialize(
    ref: CheckoutRef,
    writer: WorkspaceWriter,
    limits: Pick<CurlOsLimits, "maxFiles" | "maxFileBytes" | "maxWorkspaceBytes">,
  ): Promise<CheckoutManifest>;
}

export interface WorkspaceWriter {
  clearRoot(): Promise<void>;
  writeFile(path: string, content: Uint8Array): Promise<void>;
}

/**
 * Mechanism seam. Policy (CurlOsSession) talks only to this — never to Eve
 * or just-bash types. Relative paths are workspace-relative; absolute paths
 * must stay under /workspace.
 */
export interface CurlOsHost {
  readTextFile(input: {
    readonly path: string;
    readonly startLine?: number;
    readonly endLine?: number;
    readonly abortSignal?: AbortSignal;
  }): PromiseLike<string | null>;

  /** Preferred over shelling out to find. */
  listFiles(input: {
    readonly path: string;
    readonly pattern: string;
    readonly limit: number;
    readonly abortSignal?: AbortSignal;
  }): PromiseLike<{ readonly paths: readonly string[]; readonly truncated: boolean }>;

  /** Preferred over shelling out to grep. */
  searchFiles(input: {
    readonly path: string;
    readonly pattern: string;
    readonly glob?: string;
    readonly ignoreCase?: boolean;
    readonly literal?: boolean;
    readonly context?: number;
    readonly limit: number;
    readonly abortSignal?: AbortSignal;
  }): PromiseLike<{ readonly content: string; readonly truncated: boolean }>;
}

export interface CurlOsOpenOptions {
  readonly profile?: CurlOsProfile; // default "inspect"
  readonly checkout: CheckoutRef;
  readonly provider: CheckoutProvider;
  readonly host: CurlOsHost;
  readonly writer: WorkspaceWriter;
  readonly limits?: Partial<CurlOsLimits>;
}

export interface CurlOs {
  readFile(
    input: {
      readonly filePath: string;
      readonly limit?: number;
      readonly offset?: number;
    },
    abortSignal?: AbortSignal,
  ): Promise<{
    readonly content: string;
    readonly path: string;
    readonly truncated: boolean;
    readonly nextOffset?: number;
  }>;

  glob(
    input: {
      readonly pattern: string;
      readonly path?: string;
      readonly limit?: number;
    },
    abortSignal?: AbortSignal,
  ): Promise<{
    readonly content: string;
    readonly path: string;
    readonly truncated: boolean;
  }>;

  grep(
    input: {
      readonly pattern: string;
      readonly path?: string;
      readonly glob?: string;
      readonly ignoreCase?: boolean;
      readonly literal?: boolean;
      readonly context?: number;
      readonly limit?: number;
    },
    abortSignal?: AbortSignal,
  ): Promise<{
    readonly content: string;
    readonly path: string;
    readonly truncated: boolean;
  }>;
}

export interface CurlOsSession extends CurlOs {
  readonly profile: CurlOsProfile;
  readonly manifest: CheckoutManifest;
  readonly limits: CurlOsLimits;
  close(): Promise<void>;
}

export declare function openCurlOs(options: CurlOsOpenOptions): Promise<CurlOsSession>;
```

### Composition in Curl (Eve)

```text
turn.started
    → openCurlOs({ checkout, provider: githubProvider(channel), host, writer })
    → stash session.manifest on channel state (headSha, checkoutPath, skips)
model tools
    → session.readFile / glob / grep
session end / shutdown
    → session.close()
```

`createCurlOsBackend(sandbox)` remains valid during migration: it is the
inspect half of the session. `openCurlOs` adds checkout + manifest + close
around the same policy.

### Non-goals (this ADR)

- Guest network, credential brokering, or in-sandbox `git`
- Model-facing shell / write / spawn
- `evidence` / `prove` profiles (separate ADR when N1/N7 need them)
- Publishing `@anturno/curlos` (extract when a second consumer exists)

## Consequences

**Positive**

- One seam for tests: fake `CheckoutProvider` + in-memory `CurlOsHost`.
- Manifest makes incomplete checkouts visible to the review pack and evals.
- Native `listFiles` / `searchFiles` retires command-string construction from
  policy without changing tool names the model sees.
- Eve stays an adapter; CurlOS types stay forge- and framework-agnostic.

**Negative / accepted costs**

- `github-checkout.ts` must grow a provider adapter and stop being the only
  entry point (channel calls `openCurlOs`, not `materializeGitHubCheckout`
  directly).
- Until `listFiles` / `searchFiles` land on the just-bash host, `glob` / `grep`
  may keep a temporary shell-backed host adapter behind the same interface.
- Manifest `skipped` reasons become part of the public contract — change them
  deliberately.

## Migration steps

1. Introduce the types in-tree (e.g. `agent/lib/curlos-session.ts`) without
   changing runtime behavior.
2. Wrap today's materializer as `CheckoutProvider` + `WorkspaceWriter` over
   `SandboxSession`.
3. Point the GitHub channel at `openCurlOs`; keep tool execute bodies on
   `CurlOs`.
4. Implement native `listFiles` / `searchFiles` on the curl-sandbox host;
   delete shell construction from policy.
5. Extract a package only after a second in-repo or external consumer appears.

## Related

- [`docs/curlos.md`](../curlos.md) — runtime contract, limits, threat model
- [`agent/lib/curlos.ts`](../../agent/lib/curlos.ts) — current policy module
- [`agent/lib/github-checkout.ts`](../../agent/lib/github-checkout.ts) — current materializer
