import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Build an on-demand review prompt from a golden PR fixture (app-root relative). */
export async function reviewPromptFromFixture(fixtureFile: string): Promise<string> {
  const body = await readFile(join(process.cwd(), "evals", "fixtures", fixtureFile), "utf8");
  return [
    "@anturno-curl review",
    "",
    "Run the default correctness + security review pack on this pull request.",
    "Reply with one prioritized summary comment in the Curl review format.",
    "",
    body,
  ].join("\n");
}
