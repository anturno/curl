const AUTO_REVIEW_ALLOWLIST_ENV = "CURL_AUTO_REVIEW_ALLOWLIST";
const AUTO_REVIEW_ENV = "CURL_AUTO_REVIEW";
const EVAL_MOCK_ENV = "CURL_EVAL_MOCK";
const CHECK_RUN_ENV = "CURL_CHECK_RUN";
const GITHUB_AUTH_ENV = "CURL_GITHUB_AUTH";
const MODEL_CONTEXT_WINDOW_ENV = "OPENCODE_MODEL_CONTEXT_WINDOW_TOKENS";
const MAX_INPUT_TOKENS_ENV = "CURL_MAX_INPUT_TOKENS_PER_SESSION";
const MAX_OUTPUT_TOKENS_ENV = "CURL_MAX_OUTPUT_TOKENS_PER_SESSION";
const SESSION_TIMEOUT_ENV = "CURL_SESSION_TIMEOUT_MS";

const DEFAULT_MODEL_ID = "gpt-5.6-luna";
const DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS = 200_000;
const DEFAULT_MAX_INPUT_TOKENS_PER_SESSION = 1_000_000;
const DEFAULT_MAX_OUTPUT_TOKENS_PER_SESSION = 20_000;
const DEFAULT_SESSION_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1_000;

const MAX_MODEL_CONTEXT_WINDOW_TOKENS = 10_000_000;
const MAX_INPUT_TOKENS_PER_SESSION = 100_000_000;
const MAX_OUTPUT_TOKENS_PER_SESSION = 10_000_000;
const MAX_SESSION_TIMEOUT_MS = 365 * 24 * 60 * 60 * 1_000;

/**
 * Parse an environment boolean without silently accepting typos or truthy
 * strings. The accepted values are deliberately small and documented in
 * `.env.example`.
 */
export function parseStrictBooleanEnv(
  name: string,
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  if (value === "1" || value === "true") {
    return true;
  }
  if (value === "0" || value === "false") {
    return false;
  }
  throw new Error(
    `${name} must be exactly 1, 0, true, or false; received ${JSON.stringify(value)}`,
  );
}

export type GitHubAuthMode = "app" | "connect";

function parseGitHubAuthMode(value: string | undefined): GitHubAuthMode {
  if (value === undefined) {
    return "connect";
  }
  if (value === "app" || value === "connect") {
    return value;
  }
  throw new Error(
    `${GITHUB_AUTH_ENV} must be exactly app or connect; received ${JSON.stringify(value)}`,
  );
}

/**
 * Parse a positive, safe decimal integer from an environment variable. Values
 * such as `1.5`, `1e6`, `-1`, and `NaN` are rejected instead of being coerced.
 */
export function parsePositiveIntegerEnv(
  name: string,
  value: string | undefined,
  defaultValue: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = Number(value);
  if (parsed < 0 || !Number.isSafeInteger(parsed) || String(parsed) !== value) {
    throw new Error(
      `${name} must be a positive decimal integer; received ${JSON.stringify(value)}`,
    );
  }

  if (parsed < 1 || parsed > maximum) {
    throw new Error(
      `${name} must be an integer from 1 through ${maximum}; received ${JSON.stringify(value)}`,
    );
  }
  return parsed;
}

function isRepositoryName(value: string): boolean {
  return /^[a-z\d][a-z\d_.-]*$/u.test(value);
}

function normalizeRepository(owner: string, repo: string): string | null {
  const normalizedOwner = owner.trim().toLowerCase();
  const normalizedRepo = repo.trim().toLowerCase();
  if (!isRepositoryName(normalizedOwner) || !isRepositoryName(normalizedRepo)) {
    return null;
  }
  return `${normalizedOwner}/${normalizedRepo}`;
}

function parseRepositoryAllowlist(value: string | undefined): readonly string[] | null {
  if (value === undefined) {
    return null;
  }

  const entries = value.split(",").map((entry) => entry.trim());
  if (entries.some((entry) => entry.length === 0)) {
    throw new Error(
      `${AUTO_REVIEW_ALLOWLIST_ENV} must be a comma-separated list of owner/repo names; empty entries are not allowed`,
    );
  }

  const normalized = entries.map((entry, index) => {
    const separator = entry.indexOf("/");
    const owner = separator >= 0 ? entry.slice(0, separator) : entry;
    const repo = separator >= 0 ? entry.slice(separator + 1) : "";
    const repository = normalizeRepository(owner, repo);
    if (repository === null || entry.indexOf("/", separator + 1) >= 0) {
      throw new Error(
        `${AUTO_REVIEW_ALLOWLIST_ENV} entry ${index + 1} must be an exact owner/repo name; received ${JSON.stringify(entry)}`,
      );
    }
    return repository;
  });

  return Object.freeze([...new Set(normalized)]);
}

export interface AutomaticReviewConfig {
  readonly enabled: boolean;
  /** Exact, case-insensitive owner/repo values; null means no allowlist. */
  readonly repositoryAllowlist: readonly string[] | null;
}

export interface InferenceConfig {
  readonly modelId: string;
  readonly modelContextWindowTokens: number;
  readonly limits: {
    readonly maxInputTokensPerSession: number;
    readonly maxOutputTokensPerSession: number;
    readonly sessionTimeoutMs: number;
  };
  /** Whether a non-mock provider credential is available to the app runtime. */
  readonly apiKeyConfigured: boolean;
}

export interface GitHubConfig {
  readonly authMode: GitHubAuthMode;
  /** Check Runs are enabled by default, but accept only strict boolean values. */
  readonly checkRunsEnabled: boolean;
}

export interface CurlConfig {
  readonly automaticReview: AutomaticReviewConfig;
  readonly evalMockEnabled: boolean;
  readonly github: GitHubConfig;
  readonly inference: InferenceConfig;
}

export function loadReviewConfig(environment: NodeJS.ProcessEnv = process.env): CurlConfig {
  const automaticReview = Object.freeze({
    enabled: parseStrictBooleanEnv(AUTO_REVIEW_ENV, environment[AUTO_REVIEW_ENV], false),
    repositoryAllowlist: parseRepositoryAllowlist(environment[AUTO_REVIEW_ALLOWLIST_ENV]),
  });

  const github = Object.freeze({
    authMode: parseGitHubAuthMode(environment[GITHUB_AUTH_ENV]),
    checkRunsEnabled: parseStrictBooleanEnv(CHECK_RUN_ENV, environment[CHECK_RUN_ENV], true),
  });

  const evalMockEnabled = parseStrictBooleanEnv(EVAL_MOCK_ENV, environment[EVAL_MOCK_ENV], false);

  const inference = Object.freeze({
    modelId: environment.OPENCODE_MODEL?.trim() || DEFAULT_MODEL_ID,
    modelContextWindowTokens: parsePositiveIntegerEnv(
      MODEL_CONTEXT_WINDOW_ENV,
      environment[MODEL_CONTEXT_WINDOW_ENV],
      DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
      MAX_MODEL_CONTEXT_WINDOW_TOKENS,
    ),
    limits: Object.freeze({
      maxInputTokensPerSession: parsePositiveIntegerEnv(
        MAX_INPUT_TOKENS_ENV,
        environment[MAX_INPUT_TOKENS_ENV],
        DEFAULT_MAX_INPUT_TOKENS_PER_SESSION,
        MAX_INPUT_TOKENS_PER_SESSION,
      ),
      maxOutputTokensPerSession: parsePositiveIntegerEnv(
        MAX_OUTPUT_TOKENS_ENV,
        environment[MAX_OUTPUT_TOKENS_ENV],
        DEFAULT_MAX_OUTPUT_TOKENS_PER_SESSION,
        MAX_OUTPUT_TOKENS_PER_SESSION,
      ),
      sessionTimeoutMs: parsePositiveIntegerEnv(
        SESSION_TIMEOUT_ENV,
        environment[SESSION_TIMEOUT_ENV],
        DEFAULT_SESSION_TIMEOUT_MS,
        MAX_SESSION_TIMEOUT_MS,
      ),
    }),
    apiKeyConfigured: Boolean(environment.OPENCODE_API_KEY?.trim()),
  });

  return Object.freeze({
    automaticReview,
    evalMockEnabled,
    github,
    inference,
  });
}

/** Validated, immutable configuration shared by the agent and GitHub channel. */
export const reviewConfig = loadReviewConfig();

/**
 * Return true only when automatic review is enabled and the repository is
 * either not restricted or explicitly present in the exact allowlist.
 */
export function isAutomaticReviewAllowed(
  owner: string,
  repo: string,
  config: AutomaticReviewConfig = reviewConfig.automaticReview,
): boolean {
  if (!config.enabled) {
    return false;
  }

  const repository = normalizeRepository(owner, repo);
  if (repository === null) {
    return false;
  }

  return config.repositoryAllowlist === null || config.repositoryAllowlist.includes(repository);
}
