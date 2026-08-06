import { defineTool } from "eve/tools";
import { z } from "zod";
import { CURL_OS_LIMITS, type CurlOsReadFileInput } from "../lib/curlos";
import { curlOsForSandbox } from "../lib/curlos-runtime";

export default defineTool({
  description:
    "Read a file from CurlOS. Only paths inside /workspace are allowed, and output is bounded.",
  inputSchema: z
    .object({
      filePath: z.string().min(1).max(CURL_OS_LIMITS.maxInputLength),
      limit: z.number().int().min(1).max(CURL_OS_LIMITS.maxReadLines).optional(),
      offset: z.number().int().min(0).max(CURL_OS_LIMITS.maxReadOffset).optional(),
    })
    .strict(),
  async execute(input: CurlOsReadFileInput, ctx) {
    return curlOsForSandbox(await ctx.getSandbox()).readFile(input, ctx.abortSignal);
  },
});
