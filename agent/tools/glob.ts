import { CURL_OS_LIMITS, type CurlOsGlobInput } from "@anturno/curlos";
import { curlOsForSandbox } from "@anturno/curlos/eve";
import { defineTool } from "eve/tools";
import { z } from "zod";

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
