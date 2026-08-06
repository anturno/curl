import type {
  SandboxBackend,
  SandboxBackendCreateInput,
  SandboxBackendHandle,
  SandboxCommandResult,
  SandboxNetworkPolicy,
  SandboxProcess,
  SandboxReadTextFileOptions,
  SandboxRunOptions,
  SandboxSession,
  SandboxSpawnOptions,
} from "eve/sandbox";
import { Bash } from "just-bash";
import { CURL_OS_ROOT, DEFAULT_CURL_OS_LIMITS } from "./curlos-session";

const WORKSPACE_ROOT = CURL_OS_ROOT;
/**
 * Must stay `"just-bash"`. Eve buckets optional engine packages by the backend
 * name recorded in the compiled manifest
 * (`OPTIONAL_ENGINE_PACKAGES_BY_BACKEND_NAME` in eve's nitro host). A name Eve
 * does not recognize marks `just-bash` as unconfigured, which pins it as a
 * plain external that is never inlined and never traced into the hosted
 * bundle — the deployed function then dies on cold start with
 * `ERR_MODULE_NOT_FOUND`. The same name also keeps Eve from pruning local
 * sandbox backends out of the Vercel build.
 */
const BACKEND_NAME = "just-bash";
const METADATA_VERSION = 1;
const MAX_COMMAND_OUTPUT_BYTES = 100_000;
/** Wall-clock ceiling for one guest command; a timeout exits with code 124. */
const MAX_COMMAND_DURATION_MS = 10_000;
/**
 * Ceiling on resident workspace bytes.
 *
 * The virtual filesystem lives in the Eve server's heap and repository content
 * is untrusted, so an oversized checkout is a memory-exhaustion vector against
 * the host process. Writes past this limit fail with `ENOSPC`.
 */
const MAX_WORKSPACE_BYTES = DEFAULT_CURL_OS_LIMITS.maxWorkspaceBytes;
const SAFE_ENV = {
  HOME: "/home/curl",
  LANG: "C",
  LC_ALL: "C",
  PATH: "/bin",
  TMPDIR: "/tmp",
};

export function createCurlSandboxBackend(): SandboxBackend {
  const handles = new Map<string, Promise<SandboxBackendHandle>>();

  return {
    name: BACKEND_NAME,

    async prewarm(input) {
      if (input.seedFiles.length > 0 || input.bootstrap !== undefined) {
        throw new Error("Curl sandbox does not support templates or bootstrap code");
      }
      return { reused: false };
    },

    async create(input) {
      if (input.templateKey !== null) {
        throw new Error("Curl sandbox does not support template sessions");
      }

      const existing = handles.get(input.sessionKey);
      if (existing) return existing;

      let pending: Promise<SandboxBackendHandle>;
      pending = createHandle(input, () => {
        if (handles.get(input.sessionKey) === pending) handles.delete(input.sessionKey);
      });
      handles.set(input.sessionKey, pending);
      try {
        return await pending;
      } catch (error) {
        if (handles.get(input.sessionKey) === pending) handles.delete(input.sessionKey);
        throw error;
      }
    },
  };
}

async function createHandle(
  input: SandboxBackendCreateInput,
  onShutdown: () => void,
): Promise<SandboxBackendHandle> {
  const bash = new Bash({
    commands: ["find", "grep", "head"],
    cwd: WORKSPACE_ROOT,
    /**
     * just-bash 3.2 enables its defense-in-depth layer by default. The layer
     * installs Node module hooks; Bun does not implement them, so every
     * `exec()` throws "critical patches failed" there. Verified on just-bash
     * 3.2.0: Node 24 accepts `true`, `"auto"`, and `false`, while Bun 1.3
     * accepts only `false` — `"auto"` does not detect the gap.
     *
     * Curl tests and develops on Bun, so leaving the default on would break
     * every local run to gain a layer just-bash itself documents as secondary.
     * Curl's primary boundary is the command allow-list, the absent guest
     * network, the in-memory filesystem, and never executing repository code.
     * Revisit if just-bash fixes `"auto"` or Curl moves off Bun.
     */
    defenseInDepth: false,
    env: SAFE_ENV,
    executionLimits: {
      maxCommandCount: 32,
      maxExecutionTimeMs: MAX_COMMAND_DURATION_MS,
      maxFileDescriptors: 16,
      maxFileSystemBytes: MAX_WORKSPACE_BYTES,
      maxGlobOperations: 2_000,
      maxOutputSize: MAX_COMMAND_OUTPUT_BYTES,
      maxStringLength: MAX_COMMAND_OUTPUT_BYTES,
    },
  });
  await bash.fs.mkdir(WORKSPACE_ROOT, { recursive: true });

  const sessionHandle = createSession(bash, input.sessionKey);
  let shutdownPromise: Promise<void> | undefined;

  return {
    session: sessionHandle.session,
    useSessionFn: async () => sessionHandle.session,
    async captureState() {
      return {
        backendName: BACKEND_NAME,
        metadata: { version: METADATA_VERSION },
        sessionKey: input.sessionKey,
      };
    },
    async shutdown() {
      shutdownPromise ??= (async () => {
        try {
          sessionHandle.close();
        } finally {
          onShutdown();
        }
      })();
      await shutdownPromise;
    },
  };
}

function createSession(
  bash: Bash,
  id: string,
): { readonly close: () => void; readonly session: SandboxSession } {
  let closed = false;

  function assertOpen(): void {
    if (closed) throw new Error("Curl sandbox session is shut down");
  }

  async function run(options: SandboxRunOptions): Promise<SandboxCommandResult> {
    assertOpen();
    options.abortSignal?.throwIfAborted();
    assertAllowedCommand(options.command);

    const result = await bash.exec(normalizeCommandForJustBash(options.command), {
      cwd: resolveVirtualPath(options.workingDirectory ?? WORKSPACE_ROOT),
      env: SAFE_ENV,
      replaceEnv: true,
      signal: options.abortSignal,
    });
    return {
      exitCode: result.exitCode,
      stderr: result.stderr,
      stdout: result.stdout,
    };
  }

  async function readBytes(path: string, abortSignal?: AbortSignal): Promise<Uint8Array | null> {
    assertOpen();
    abortSignal?.throwIfAborted();
    const resolved = resolveVirtualPath(path);
    if (!(await bash.fs.exists(resolved))) return null;
    return bash.fs.readFileBuffer(resolved);
  }

  const session: SandboxSession = {
    id,
    resolvePath: resolveVirtualPath,
    run,
    async spawn(_options: SandboxSpawnOptions): Promise<SandboxProcess> {
      throw new Error("Curl sandbox does not support long-lived processes");
    },
    async readFile({ path, abortSignal }) {
      const bytes = await readBytes(path, abortSignal);
      return bytes === null ? null : bytesToStream(bytes);
    },
    async readBinaryFile({ path, abortSignal }) {
      return readBytes(path, abortSignal);
    },
    async readTextFile(options: SandboxReadTextFileOptions) {
      const bytes = await readBytes(options.path, options.abortSignal);
      if (bytes === null) return null;
      return selectLines(decode(bytes, options.encoding), options);
    },
    async writeFile({ path, content, abortSignal }) {
      assertOpen();
      abortSignal?.throwIfAborted();
      await bash.fs.writeFile(resolveVirtualPath(path), await streamToBytes(content));
    },
    async writeBinaryFile({ path, content, abortSignal }) {
      assertOpen();
      abortSignal?.throwIfAborted();
      await bash.fs.writeFile(resolveVirtualPath(path), content);
    },
    async writeTextFile({ path, content, encoding = "utf-8", abortSignal }) {
      assertOpen();
      abortSignal?.throwIfAborted();
      await bash.fs.writeFile(
        resolveVirtualPath(path),
        Buffer.from(content, encoding as BufferEncoding),
      );
    },
    async removePath({ path, abortSignal, force = false, recursive = false }) {
      assertOpen();
      abortSignal?.throwIfAborted();
      const resolved = resolveVirtualPath(path);
      await bash.fs.rm(resolved, { force, recursive });
      // `run()` resolves every command against the workspace root. Restore it
      // so a checkout that yields no files still leaves a usable cwd.
      if (resolved === WORKSPACE_ROOT) await bash.fs.mkdir(WORKSPACE_ROOT, { recursive: true });
    },
    async setNetworkPolicy(policy: SandboxNetworkPolicy) {
      assertOpen();
      if (policy !== "deny-all") {
        throw new Error(
          "Curl sandbox has no guest network; GitHub checkout must use host-side API materialization",
        );
      }
    },
  };

  return {
    close() {
      closed = true;
    },
    session,
  };
}

function resolveVirtualPath(path: string): string {
  const candidate = path.startsWith("/") ? path : `${WORKSPACE_ROOT}/${path}`;
  const normalized = posixNormalize(candidate);
  if (normalized !== WORKSPACE_ROOT && !normalized.startsWith(`${WORKSPACE_ROOT}/`)) {
    throw new RangeError(`sandbox path escapes ${WORKSPACE_ROOT}: ${path}`);
  }
  return normalized;
}

function posixNormalize(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return `/${segments.join("/")}`;
}

function assertAllowedCommand(command: string): void {
  if (
    !/^(?:find|grep -R) .* \| head -n [1-9][0-9]*$/u.test(command) ||
    (command.startsWith("find ") &&
      (!command.includes(" -type f -path ") ||
        !command.includes(" -print | head -n ") ||
        /-(?:delete|exec|execdir|ok|okdir|fls|fprint|fprint0|fprintf)\b/u.test(command))) ||
    command.includes("&&") ||
    command.includes(";") ||
    command.includes("||") ||
    command.includes("$(") ||
    command.includes("`") ||
    command.includes("\n") ||
    command.includes("\r") ||
    command.includes(">") ||
    command.includes("<")
  ) {
    throw new Error("Curl sandbox only permits bounded find and grep commands");
  }
}

function normalizeCommandForJustBash(command: string): string {
  // just-bash's grep does not implement the POSIX `--` separator. Replacing
  // it with `-e` preserves patterns that begin with `-` without widening the
  // accepted command grammar.
  return command.startsWith("grep ") ? command.replace(" -- ", " -e ") : command;
}

function decode(bytes: Uint8Array, encoding = "utf-8"): string {
  if (encoding === "utf-8" || encoding === "utf8") return new TextDecoder().decode(bytes);
  return Buffer.from(bytes).toString(encoding as BufferEncoding);
}

function selectLines(content: string, options: SandboxReadTextFileOptions): string {
  const lines = content.split(/\r?\n/);
  const start = Math.max(1, options.startLine ?? 1);
  const end = options.endLine ?? lines.length;
  return lines.slice(start - 1, end).join("\n");
}

function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      chunks.push(result.value);
      length += result.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
