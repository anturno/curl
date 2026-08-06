export const CURL_OS_ROOT = "/workspace";

export const CURL_OS_LIMITS = {
  maxContextLines: 24,
  maxGlobMatches: 200,
  maxInputLength: 4_096,
  maxReadOffset: 1_000_000,
  maxOutputBytes: 100_000,
  maxReadLines: 2_000,
  maxSearchMatches: 200,
  maxSearchPatternLength: 2_000,
} as const;

export interface CurlOsReadFileInput {
  readonly filePath: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface CurlOsGlobInput {
  readonly limit?: number;
  readonly path?: string;
  readonly pattern: string;
}

export interface CurlOsGrepInput {
  readonly context?: number;
  readonly glob?: string;
  readonly ignoreCase?: boolean;
  readonly limit?: number;
  readonly literal?: boolean;
  readonly path?: string;
  readonly pattern: string;
}

export interface CurlOsReadFileOutput {
  readonly content: string;
  readonly nextOffset?: number;
  readonly path: string;
  readonly truncated: boolean;
}

export interface CurlOsTextOutput {
  readonly content: string;
  readonly path: string;
  readonly truncated: boolean;
}

export interface CurlOs {
  readFile(input: CurlOsReadFileInput, abortSignal?: AbortSignal): Promise<CurlOsReadFileOutput>;
  glob(input: CurlOsGlobInput, abortSignal?: AbortSignal): Promise<CurlOsTextOutput>;
  grep(input: CurlOsGrepInput, abortSignal?: AbortSignal): Promise<CurlOsTextOutput>;
}

export interface CurlOsBackend extends CurlOs {
  readonly name: "curlos";
}

/**
 * Mechanism seam. Policy talks only to this — never to Eve or just-bash types.
 */
export interface CurlOsHost {
  readTextFile(input: {
    readonly abortSignal?: AbortSignal;
    readonly endLine?: number;
    readonly path: string;
    readonly startLine?: number;
  }): PromiseLike<string | null>;

  listFiles(input: {
    readonly abortSignal?: AbortSignal;
    readonly limit: number;
    readonly path: string;
    readonly pattern: string;
  }): PromiseLike<{ readonly paths: readonly string[]; readonly truncated: boolean }>;

  searchFiles(input: {
    readonly abortSignal?: AbortSignal;
    readonly context?: number;
    readonly glob?: string;
    readonly ignoreCase?: boolean;
    readonly limit: number;
    readonly literal?: boolean;
    readonly path: string;
    readonly pattern: string;
  }): PromiseLike<{ readonly content: string; readonly truncated: boolean }>;
}

function fail(message: string): never {
  throw new Error(`CurlOS denied operation: ${message}`);
}

/**
 * Resolve a model-provided path inside the review workspace.
 *
 * CurlOS intentionally accepts relative paths only as workspace-relative paths
 * and rejects `$HOME` plus absolute paths outside `/workspace`. This keeps the
 * review contract independent from whichever host implements CurlOS.
 */
export function resolveCurlOsPath(input: string): string {
  if (input.length === 0 || input.length > CURL_OS_LIMITS.maxInputLength) {
    return fail("path length is outside the allowed range");
  }

  if (input.startsWith("$HOME")) {
    return fail("home-directory paths are not part of the review workspace");
  }

  const absolute = input.startsWith("/") ? input : `${CURL_OS_ROOT}/${input}`;
  const normalized = normalizePosixPath(absolute);

  if (normalized !== CURL_OS_ROOT && !normalized.startsWith(`${CURL_OS_ROOT}/`)) {
    return fail("path escapes /workspace");
  }

  return normalized;
}

function normalizePosixPath(input: string): string {
  const segments: string[] = [];
  for (const segment of input.split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

function positiveLimit(value: number | undefined, fallback: number, maximum: number): number {
  const limit = value ?? fallback;
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
    return fail(`limit must be an integer between 1 and ${maximum}`);
  }
  return limit;
}

function nonNegativeOffset(value: number | undefined): number {
  const offset = value ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > CURL_OS_LIMITS.maxReadOffset) {
    return fail(`offset must be an integer between 0 and ${CURL_OS_LIMITS.maxReadOffset}`);
  }
  return offset;
}

export function boundCurlOsText(content: string): {
  readonly content: string;
  readonly truncated: boolean;
} {
  const bytes = Buffer.from(content, "utf8");
  if (bytes.byteLength <= CURL_OS_LIMITS.maxOutputBytes) {
    return { content, truncated: false };
  }
  let bounded = bytes.subarray(0, CURL_OS_LIMITS.maxOutputBytes).toString("utf8");
  while (Buffer.byteLength(bounded, "utf8") > CURL_OS_LIMITS.maxOutputBytes) {
    bounded = bounded.slice(0, -1);
  }
  return {
    content: bounded,
    truncated: true,
  };
}

function lineNumbered(content: string, offset: number): string {
  if (content.length === 0) return "";
  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines.map((line, index) => `${offset + index + 1}: ${line}`).join("\n");
}

function boundListedPaths(
  paths: readonly string[],
  limit: number,
  hostTruncated: boolean,
): { readonly content: string; readonly truncated: boolean } {
  const truncated = hostTruncated || paths.length > limit;
  const selected = paths.slice(0, limit).join("\n");
  const bounded = boundCurlOsText(selected.length > 0 ? `${selected}\n` : selected);
  return { content: bounded.content, truncated: truncated || bounded.truncated };
}

function boundSearchContent(
  content: string,
  limit: number,
  hostTruncated: boolean,
): { readonly content: string; readonly truncated: boolean } {
  const hasTrailingNewline = content.endsWith("\n");
  const lines = content.split(/\r?\n/);
  if (hasTrailingNewline) lines.pop();
  const truncated = hostTruncated || lines.length > limit;
  const selected = lines.slice(0, limit).join("\n");
  const bounded = boundCurlOsText(
    hasTrailingNewline && selected.length > 0 ? `${selected}\n` : selected,
  );
  return { content: bounded.content, truncated: truncated || bounded.truncated };
}

function withAbortSignal<T extends Record<string, unknown>>(
  input: T,
  abortSignal: AbortSignal | undefined,
): T & { readonly abortSignal?: AbortSignal } {
  return abortSignal === undefined
    ? { ...input, abortSignal: undefined }
    : { ...input, abortSignal };
}

export function createCurlOsBackend(sandbox: CurlOsHost): CurlOsBackend {
  const runtime: CurlOs = {
    async readFile(input, abortSignal) {
      const path = resolveCurlOsPath(input.filePath);
      const limit = positiveLimit(input.limit, 2_000, CURL_OS_LIMITS.maxReadLines);
      const offset = nonNegativeOffset(input.offset);
      const raw =
        (await sandbox.readTextFile(
          withAbortSignal(
            {
              path,
              startLine: offset + 1,
              endLine: offset + limit,
            },
            abortSignal,
          ),
        )) ?? "";
      const bounded = boundCurlOsText(lineNumbered(raw, offset));
      const lines = raw.length === 0 ? [] : raw.split(/\r?\n/);
      if (lines.at(-1) === "") lines.pop();
      const truncated = bounded.truncated || lines.length === limit;

      return {
        content: bounded.content,
        nextOffset: truncated ? offset + lines.length : undefined,
        path,
        truncated,
      };
    },

    async glob(input, abortSignal) {
      const path = resolveCurlOsPath(input.path ?? CURL_OS_ROOT);
      const limit = positiveLimit(
        input.limit,
        CURL_OS_LIMITS.maxGlobMatches,
        CURL_OS_LIMITS.maxGlobMatches,
      );
      if (
        input.pattern.length === 0 ||
        input.pattern.length > CURL_OS_LIMITS.maxSearchPatternLength
      ) {
        return fail("glob pattern length is outside the allowed range");
      }
      const result = await sandbox.listFiles(
        withAbortSignal(
          {
            path,
            pattern: input.pattern,
            limit,
          },
          abortSignal,
        ),
      );
      const bounded = boundListedPaths(result.paths, limit, result.truncated);
      return {
        content: bounded.content,
        path,
        truncated: bounded.truncated,
      };
    },

    async grep(input, abortSignal) {
      const path = resolveCurlOsPath(input.path ?? CURL_OS_ROOT);
      const limit = positiveLimit(
        input.limit,
        CURL_OS_LIMITS.maxSearchMatches,
        CURL_OS_LIMITS.maxSearchMatches,
      );
      const context = input.context ?? 0;
      if (!Number.isInteger(context) || context < 0 || context > CURL_OS_LIMITS.maxContextLines) {
        return fail(`context must be an integer between 0 and ${CURL_OS_LIMITS.maxContextLines}`);
      }
      if (
        input.pattern.length === 0 ||
        input.pattern.length > CURL_OS_LIMITS.maxSearchPatternLength
      ) {
        return fail("search pattern length is outside the allowed range");
      }
      const result = await sandbox.searchFiles(
        withAbortSignal(
          {
            path,
            pattern: input.pattern,
            glob: input.glob,
            ignoreCase: input.ignoreCase,
            literal: input.literal,
            context,
            limit,
          },
          abortSignal,
        ),
      );
      const bounded = boundSearchContent(result.content, limit, result.truncated);
      return { content: bounded.content, path, truncated: bounded.truncated };
    },
  };
  return { name: "curlos", ...runtime };
}
