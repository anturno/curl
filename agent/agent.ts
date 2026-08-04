import { createOpenAI } from "@ai-sdk/openai";
import { defineAgent } from "eve";
import { mockModel } from "eve/evals";
import { mockReviewReply } from "./lib/eval-mock-review";

/**
 * OpenCode Go — GPT 5.6 Luna uses the Responses API (`@ai-sdk/openai`).
 * Default: gpt-5.6-luna at high reasoning. Override with OPENCODE_MODEL.
 * @see https://opencode.ai/docs/go/
 *
 * CURL_EVAL_MOCK=1 enables deterministic CI evals (forbidden on Vercel/production).
 */
const useEvalMock = process.env.CURL_EVAL_MOCK === "1";
const isDeployed =
  process.env.VERCEL === "1" ||
  process.env.VERCEL_ENV === "production" ||
  process.env.NODE_ENV === "production";

if (useEvalMock && isDeployed) {
  throw new Error(
    "CURL_EVAL_MOCK=1 is not allowed in production or Vercel deploys (would ship fake reviews).",
  );
}

if (!useEvalMock && !process.env.OPENCODE_API_KEY) {
  throw new Error("OPENCODE_API_KEY is required unless CURL_EVAL_MOCK=1");
}

const modelId = process.env.OPENCODE_MODEL ?? "gpt-5.6-luna";

const opencode = createOpenAI({
  name: "opencode-go",
  apiKey: process.env.OPENCODE_API_KEY,
  baseURL: "https://opencode.ai/zen/go/v1",
});

export default defineAgent({
  model: useEvalMock
    ? mockModel(({ lastUserMessage }) => mockReviewReply(lastUserMessage ?? ""))
    : opencode.responses(modelId),
  reasoning: "high",
  // OpenCode models vary; set an explicit window so eve doesn't fail metadata lookup.
  modelContextWindowTokens: Number(process.env.OPENCODE_MODEL_CONTEXT_WINDOW_TOKENS ?? 200_000),
});
