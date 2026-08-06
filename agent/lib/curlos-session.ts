import {
  CURL_OS_LIMITS,
  CURL_OS_ROOT,
  type CurlOs,
  type CurlOsHost,
  createCurlOsBackend,
} from "./curlos";

export type { CurlOs, CurlOsHost };
export { CURL_OS_ROOT };

export type CurlOsProfile = "inspect";

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

export const DEFAULT_CURL_OS_LIMITS: CurlOsLimits = {
  maxFiles: 500,
  maxFileBytes: 2_000_000,
  maxWorkspaceBytes: 64_000_000,
  maxContextLines: CURL_OS_LIMITS.maxContextLines,
  maxGlobMatches: CURL_OS_LIMITS.maxGlobMatches,
  maxInputLength: CURL_OS_LIMITS.maxInputLength,
  maxOutputBytes: CURL_OS_LIMITS.maxOutputBytes,
  maxReadLines: CURL_OS_LIMITS.maxReadLines,
  maxReadOffset: CURL_OS_LIMITS.maxReadOffset,
  maxSearchMatches: CURL_OS_LIMITS.maxSearchMatches,
  maxSearchPatternLength: CURL_OS_LIMITS.maxSearchPatternLength,
};

export interface CheckoutRef {
  readonly owner: string;
  readonly repo: string;
  /** Prefer an object id. Providers may resolve a ref once, then pin the SHA. */
  readonly sha: string;
}

export interface CheckoutFile {
  readonly path: string;
  readonly sha: string;
  readonly bytes: number;
}

export type CheckoutSkipReason = "too-large" | "unsized" | "binary" | "filtered" | "budget";

export interface CheckoutSkip {
  readonly path: string;
  readonly reason: CheckoutSkipReason;
}

export interface CheckoutManifest {
  readonly sha: string;
  readonly root: typeof CURL_OS_ROOT;
  readonly files: readonly CheckoutFile[];
  readonly skipped: readonly CheckoutSkip[];
  readonly bytes: number;
}

export interface WorkspaceWriter {
  clearRoot(): Promise<void>;
  writeFile(path: string, content: Uint8Array): Promise<void>;
}

export interface CheckoutProvider {
  materialize(
    ref: CheckoutRef,
    writer: WorkspaceWriter,
    limits: Pick<CurlOsLimits, "maxFiles" | "maxFileBytes" | "maxWorkspaceBytes">,
  ): Promise<CheckoutManifest>;
}

export interface CurlOsOpenOptions {
  readonly profile?: CurlOsProfile;
  readonly checkout: CheckoutRef;
  readonly provider: CheckoutProvider;
  readonly host: CurlOsHost;
  readonly writer: WorkspaceWriter;
  readonly limits?: Partial<CurlOsLimits>;
}

export interface CurlOsSession extends CurlOs {
  readonly profile: CurlOsProfile;
  readonly manifest: CheckoutManifest;
  readonly limits: CurlOsLimits;
  close(): Promise<void>;
}

function mergeLimits(partial: Partial<CurlOsLimits> | undefined): CurlOsLimits {
  return { ...DEFAULT_CURL_OS_LIMITS, ...partial };
}

/**
 * Open a read-only review workspace: materialize a checkout, then expose
 * bounded inspect operations until `close()`.
 */
export async function openCurlOs(options: CurlOsOpenOptions): Promise<CurlOsSession> {
  const profile = options.profile ?? "inspect";
  if (profile !== "inspect") {
    throw new Error(`CurlOS only supports the inspect profile (got ${String(profile)})`);
  }

  const limits = mergeLimits(options.limits);
  const manifest = await options.provider.materialize(options.checkout, options.writer, {
    maxFiles: limits.maxFiles,
    maxFileBytes: limits.maxFileBytes,
    maxWorkspaceBytes: limits.maxWorkspaceBytes,
  });

  const inspect = createCurlOsBackend(options.host);
  let closed = false;

  function assertOpen(): void {
    if (closed) throw new Error("CurlOS session is shut down");
  }

  return {
    profile,
    manifest,
    limits,
    async readFile(input, abortSignal) {
      assertOpen();
      return inspect.readFile(input, abortSignal);
    },
    async glob(input, abortSignal) {
      assertOpen();
      return inspect.glob(input, abortSignal);
    },
    async grep(input, abortSignal) {
      assertOpen();
      return inspect.grep(input, abortSignal);
    },
    async close() {
      if (closed) return;
      closed = true;
      await options.writer.clearRoot();
    },
  };
}

/** Live sessions keyed by Eve sandbox id for the current durable session. */
const liveSessions = new Map<string, CurlOsSession>();

export function rememberCurlOsSession(sandboxId: string, session: CurlOsSession): void {
  liveSessions.set(sandboxId, session);
}

export function getCurlOsSession(sandboxId: string): CurlOsSession | undefined {
  return liveSessions.get(sandboxId);
}

export async function closeRememberedCurlOsSession(sandboxId: string): Promise<void> {
  const session = liveSessions.get(sandboxId);
  if (session === undefined) return;
  liveSessions.delete(sandboxId);
  await session.close();
}

/** Used when Eve's handler has no sandbox handle (`session.failed`). */
export async function closeAllRememberedCurlOsSessions(): Promise<void> {
  const ids = [...liveSessions.keys()];
  for (const id of ids) {
    await closeRememberedCurlOsSession(id);
  }
}
