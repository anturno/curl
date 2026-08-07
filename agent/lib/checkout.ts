import type { CurlOsSession } from "@anturno/curlos";
import { openGitHubDiffCurlOs } from "@anturno/curlos/github";
import type { GitHubEventContext } from "eve/channels/github";
import type { SandboxSession } from "eve/sandbox";

export async function openDiffCurlOs(
  channel: GitHubEventContext,
  sandbox: SandboxSession,
): Promise<CurlOsSession> {
  return openGitHubDiffCurlOs(channel, sandbox);
}
