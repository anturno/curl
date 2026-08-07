const DEFAULT_MODEL_ID = "gpt-5.6-luna";
const DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS = 200_000;
const DEFAULT_MAX_INPUT_TOKENS_PER_SESSION = 200_000;
const DEFAULT_MAX_OUTPUT_TOKENS_PER_SESSION = 8_192;
const DEFAULT_SESSION_TIMEOUT_MS = 600_000;

export interface CurlConfig {
  readonly botName: string;
  readonly githubApp: {
    readonly appId: string;
    readonly privateKey: string;
    readonly webhookSecret: string;
  };
  readonly inference: {
    readonly apiKey: string;
    readonly modelId: string;
    readonly modelContextWindowTokens: number;
    readonly maxInputTokensPerSession: number;
    readonly maxOutputTokensPerSession: number;
    readonly sessionTimeoutMs: number;
    readonly reasoning: "high" | "medium" | "low";
  };
}

function env(value: string | undefined, defaultValue: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : defaultValue;
}

function isBuild(argv: readonly string[]): boolean {
  return argv.some((argument) => argument === "build");
}

function isProduction(environment: NodeJS.ProcessEnv, argv: readonly string[]): boolean {
  return environment.NODE_ENV === "production" && !isBuild(argv);
}

function requireEnv(name: string, environment: NodeJS.ProcessEnv, argv: readonly string[]): string {
  const value = environment[name]?.trim();
  if (value) {
    return value;
  }
  if (!isProduction(environment, argv)) {
    return "";
  }
  throw new Error(`${name} is required`);
}

function parseReasoning(value: string | undefined): "high" | "medium" | "low" {
  const trimmed = value?.trim().toLowerCase();
  if (trimmed === "high" || trimmed === "medium" || trimmed === "low") {
    return trimmed;
  }
  return "medium";
}

function parsePositiveInteger(value: string | undefined, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = Number(value);
  if (parsed < 1 || !Number.isSafeInteger(parsed) || String(parsed) !== value) {
    throw new Error(`Expected a positive decimal integer; received ${JSON.stringify(value)}`);
  }
  return parsed;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
): CurlConfig {
  return {
    botName: env(environment.GITHUB_APP_SLUG, "anturno-curl"),
    githubApp: {
      appId: requireEnv("GITHUB_APP_ID", environment, argv),
      privateKey: requireEnv("GITHUB_APP_PRIVATE_KEY", environment, argv),
      webhookSecret: requireEnv("GITHUB_WEBHOOK_SECRET", environment, argv),
    },
    inference: {
      apiKey: requireEnv("OPENCODE_API_KEY", environment, argv),
      modelId: env(environment.OPENCODE_MODEL, DEFAULT_MODEL_ID),
      modelContextWindowTokens: parsePositiveInteger(
        environment.OPENCODE_MODEL_CONTEXT_WINDOW_TOKENS,
        DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
      ),
      maxInputTokensPerSession: parsePositiveInteger(
        environment.CURL_MAX_INPUT_TOKENS_PER_SESSION,
        DEFAULT_MAX_INPUT_TOKENS_PER_SESSION,
      ),
      maxOutputTokensPerSession: parsePositiveInteger(
        environment.CURL_MAX_OUTPUT_TOKENS_PER_SESSION,
        DEFAULT_MAX_OUTPUT_TOKENS_PER_SESSION,
      ),
      sessionTimeoutMs: parsePositiveInteger(
        environment.CURL_SESSION_TIMEOUT_MS,
        DEFAULT_SESSION_TIMEOUT_MS,
      ),
      reasoning: parseReasoning(environment.OPENCODE_REASONING),
    },
  };
}

export const config = loadConfig();
