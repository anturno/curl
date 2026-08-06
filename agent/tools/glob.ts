import { defineTool } from "eve/tools";
import { z } from "zod";
import { CURL_OS_LIMITS, type CurlOsGlobInput } from "../lib/curlos";
import { curlOsForSandbox } from "../lib/curlos-runtime";

export default defineTool({
  description:
    "Find files inside CurlOS by glob pattern. Only /workspace is searched and output is bounded.",
  inputSchema: z
    .object({
      limit: z.number().int().min(1).max(CURL_OS_LIMITS.maxGlobMatches).optional(),
      path: z.string().min(1).max(CURL_OS_LIMITS.maxInputLength).optional(),
      pattern: z.string().min(1).max(CURL_OS_LIMITS.maxSearchPatternLength),
    })
    .strict(),
  async execute(input: CurlOsGlobInput, ctx) {
    return curlOsForSandbox(await ctx.getSandbox()).glob(input, ctx.abortSignal);
  },
});
