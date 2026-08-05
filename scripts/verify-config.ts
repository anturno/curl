import { detectRuntime } from "../agent/lib/runtime-detection";

type ReviewConfig = typeof import("../agent/lib/config")["reviewConfig"];

const errors: string[] = [];
let config: ReviewConfig | null = null;

try {
  const module = await import("../agent/lib/config");
  config = module.reviewConfig;
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown configuration error";
  const variable = message.split(" ", 1)[0];
  const configVariable =
    variable.startsWith("CURL_") || variable.startsWith("OPENCODE_") ? variable : null;
  errors.push(
    configVariable
      ? `${configVariable} is malformed; see docs/configuration.md for accepted values.`
      : "Curl configuration could not be parsed; see docs/configuration.md.",
  );
}

function hasValue(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function validateOptionalPattern(name: string, pattern: RegExp, description: string): void {
  const value = process.env[name];
  if (value !== undefined && !pattern.test(value)) {
    errors.push(`${name} must be ${description}.`);
  }
}

const evalMock = config?.evalMockEnabled ?? false;
const runtime = detectRuntime();
const deploymentLike = runtime.isDeploymentLike;
const authMode = config?.github.authMode ?? process.env.CURL_GITHUB_AUTH ?? "connect";
const appSlug = process.env.GITHUB_APP_SLUG?.trim() || "anturno-curl";
const connector = process.env.CURL_GITHUB_CONNECTOR;

validateOptionalPattern(
  "GITHUB_APP_SLUG",
  /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u,
  "a non-empty GitHub App slug without whitespace or @",
);
if (authMode === "connect") {
  validateOptionalPattern(
    "CURL_GITHUB_CONNECTOR",
    /^github\/[A-Za-z0-9][A-Za-z0-9_.-]*$/u,
    "a GitHub Connect UID in the form github/<slug>",
  );
}

if (authMode === "app") {
  const appId = Number(process.env.GITHUB_APP_ID);
  if (
    !/^\d+$/u.test(process.env.GITHUB_APP_ID ?? "") ||
    !Number.isSafeInteger(appId) ||
    appId < 1
  ) {
    errors.push("GITHUB_APP_ID must be a positive decimal GitHub App id when app auth is used.");
  }
  if (!hasValue("GITHUB_APP_PRIVATE_KEY")) {
    errors.push("GITHUB_APP_PRIVATE_KEY must be configured when app auth is used.");
  } else if (
    !/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/u.test(process.env.GITHUB_APP_PRIVATE_KEY ?? "") ||
    !/-----END [A-Z0-9 ]*PRIVATE KEY-----/u.test(process.env.GITHUB_APP_PRIVATE_KEY ?? "")
  ) {
    errors.push("GITHUB_APP_PRIVATE_KEY must contain a PEM private key.");
  }
  if (!hasValue("GITHUB_WEBHOOK_SECRET")) {
    errors.push("GITHUB_WEBHOOK_SECRET must be configured when app auth is used.");
  }
}

if (deploymentLike && evalMock) {
  errors.push("CURL_EVAL_MOCK must be disabled on deployed or production runtimes.");
}
if (deploymentLike && !hasValue("OPENCODE_API_KEY")) {
  errors.push("OPENCODE_API_KEY must be configured on deployed or production runtimes.");
}

console.log("Curl configuration verification (offline)");
console.log("Service calls: none");
console.log(`Runtime: ${deploymentLike ? "deployed/production-like" : "local/non-production"}`);
console.log(`GitHub auth: ${authMode}`);
console.log(`GitHub App slug: ${appSlug === "anturno-curl" ? "default" : "configured"}`);
console.log(`Connect connector: ${connector ? "configured" : `default (github/${appSlug})`}`);
console.log(`Automatic review: ${config?.automaticReview.enabled ? "enabled" : "disabled"}`);
console.log(
  `Automatic review allowlist: ${
    config?.automaticReview.repositoryAllowlist === null
      ? "unset"
      : `${config?.automaticReview.repositoryAllowlist.length ?? 0} entries`
  }`,
);
console.log(`Check Runs: ${config?.github.checkRunsEnabled ? "enabled" : "disabled"}`);
console.log(`Model: ${config?.inference.modelId ?? "unavailable"}`);
console.log(
  `Model context window: ${config?.inference.modelContextWindowTokens ?? "unavailable"} tokens`,
);
console.log(
  `Session limits: ${
    config
      ? `${config.inference.limits.maxInputTokensPerSession} input / ${config.inference.limits.maxOutputTokensPerSession} output tokens, ${config.inference.limits.sessionTimeoutMs} ms timeout`
      : "unavailable"
  }`,
);
console.log(`OpenCode API key: ${hasValue("OPENCODE_API_KEY") ? "configured" : "missing"}`);
console.log(`Eval mock: ${evalMock ? "enabled" : "disabled"}`);
if (authMode === "app") {
  console.log(
    `Self-managed App credentials: ${
      hasValue("GITHUB_APP_ID") &&
      hasValue("GITHUB_APP_PRIVATE_KEY") &&
      hasValue("GITHUB_WEBHOOK_SECRET")
        ? "present"
        : "incomplete"
    }`,
  );
} else {
  console.log("Self-managed App credentials: not used");
}

if (errors.length > 0) {
  console.error(`Configuration invalid (${errors.length} error${errors.length === 1 ? "" : "s"}):`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log("Configuration is valid for this runtime.");
}
