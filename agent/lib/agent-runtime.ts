import { createOpenAI } from "@ai-sdk/openai";
import type { AgentDefinition } from "eve";
import { mockModel } from "eve/evals";
import { loadReviewConfig } from "./config";
import { mockReviewReply } from "./eval-mock-review";
import { detectRuntime } from "./runtime-detection";

export interface AgentRuntimeOptions {
  readonly argv?: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
}

/**
 * OpenCode Go — GPT 5.6 Luna uses the Responses API (`@ai-sdk/openai`).
 * Default: gpt-5.6-luna at high reasoning. Override with OPENCODE_MODEL.
 * @see https://opencode.ai/docs/go/
 *
 * CURL_EVAL_MOCK=1 enables deterministic CI evals. It is rejected by deployed
 * and production runtimes so a fake model cannot publish a production review.
 *
 * Compose Eve's agent definition from validated application configuration.
 * Keeping provider construction here leaves `agent.ts` as a composition root and
 * makes runtime safety guards testable without importing the agent definition.
 */
export function createAgentDefinition(options: AgentRuntimeOptions = {}): AgentDefinition {
  const environment = options.environment ?? process.env;
  const argv = options.argv ?? process.argv;
  const config = loadReviewConfig(environment);
  const useEvalMock = config.evalMockEnabled;
  const runtime = detectRuntime({ argv, environment });

  if (useEvalMock && runtime.isDeploymentLike) {
    throw new Error("CURL_EVAL_MOCK=1 is not allowed in a deployed or production runtime.");
  }

  // `eve build` evaluates this module without provider credentials. Deployed and
  // production runtimes fail early instead of starting an agent that cannot infer.
  if (
    !useEvalMock &&
    !config.inference.apiKeyConfigured &&
    (runtime.isDeployedRuntime || runtime.isProductionRuntime)
  ) {
    throw new Error(
      "Inference is not configured for this runtime. Set OPENCODE_API_KEY before serving production reviews.",
    );
  }

  const opencode = createOpenAI({
    name: "opencode-go",
    apiKey: environment.OPENCODE_API_KEY,
    baseURL: "https://opencode.ai/zen/go/v1",
  });

  return {
    model: useEvalMock
      ? mockModel(({ lastUserMessage }) => mockReviewReply(lastUserMessage ?? ""))
      : opencode.responses(config.inference.modelId),
    reasoning: "high",
    // OpenCode models vary; set an explicit window so eve doesn't fail metadata lookup.
    modelContextWindowTokens: config.inference.modelContextWindowTokens,
    limits: config.inference.limits,
  };
}
