import { defineTool } from "eve/tools";
import { z } from "zod";
import { CURL_OS_LIMITS, type CurlOsGrepInput } from "../lib/curlos";
import { curlOsForSandbox } from "../lib/curlos-runtime";

export default defineTool({
  description:
    "Search file contents inside CurlOS. Only /workspace is searched and output is bounded.",
  inputSchema: z
    .object({
      context: z.number().int().min(0).max(CURL_OS_LIMITS.maxContextLines).optional(),
      glob: z.string().min(1).max(CURL_OS_LIMITS.maxSearchPatternLength).optional(),
      ignoreCase: z.boolean().optional(),
      limit: z.number().int().min(1).max(CURL_OS_LIMITS.maxSearchMatches).optional(),
      literal: z.boolean().optional(),
      path: z.string().min(1).max(CURL_OS_LIMITS.maxInputLength).optional(),
      pattern: z.string().min(1).max(CURL_OS_LIMITS.maxSearchPatternLength),
    })
    .strict(),
  async execute(input: CurlOsGrepInput, ctx) {
    return curlOsForSandbox(await ctx.getSandbox()).grep(input, ctx.abortSignal);
  },
});
