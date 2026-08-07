import { createOpenAI } from "@ai-sdk/openai";
import type { AgentDefinition } from "eve";
import { loadConfig } from "./config";

export interface AgentRuntimeOptions {
  readonly argv?: readonly string[];
  readonly environment?: NodeJS.ProcessEnv;
}

export function createAgentDefinition(options: AgentRuntimeOptions = {}): AgentDefinition {
  const environment = options.environment ?? process.env;
  const argv = options.argv ?? process.argv;
  const config = loadConfig(environment, argv);

  const opencode = createOpenAI({
    name: "opencode-go",
    apiKey: config.inference.apiKey,
    baseURL: "https://opencode.ai/zen/go/v1",
  });

  return {
    model: opencode.responses(config.inference.modelId),
    reasoning: config.inference.reasoning,
    modelContextWindowTokens: config.inference.modelContextWindowTokens,
    limits: {
      maxInputTokensPerSession: config.inference.maxInputTokensPerSession,
      maxOutputTokensPerSession: config.inference.maxOutputTokensPerSession,
      sessionTimeoutMs: config.inference.sessionTimeoutMs,
    },
  };
}
