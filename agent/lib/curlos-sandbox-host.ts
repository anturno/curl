import type { SandboxSession } from "eve/sandbox";
import type { CurlOsHost } from "./curlos";
import { CURL_OS_ROOT } from "./curlos";
import type { WorkspaceWriter } from "./curlos-session";

/**
 * Adapt an Eve sandbox session into the CurlOS host + writer seams.
 *
 * list/search still use the sandbox's bounded find/grep allow-list. Quoting and
 * command shape live here (mechanism), not in CurlOS policy.
 */
export function createSandboxCurlOsHost(sandbox: SandboxSession): CurlOsHost {
  return {
    readTextFile(input) {
      return sandbox.readTextFile(input);
    },

    async listFiles(input) {
      const result = await sandbox.run({
        abortSignal: input.abortSignal,
        command: `find ${quote(input.path)} -type f -path ${quote(`${input.path}/${input.pattern}`)} -print | head -n ${input.limit + 1}`,
      });
      const paths = splitCommandLines(result.stdout);
      const truncated = paths.length > input.limit;
      return { paths: paths.slice(0, input.limit), truncated };
    },

    async searchFiles(input) {
      const context = input.context ?? 0;
      const grepFlags = [
        input.ignoreCase ? "-i" : "",
        input.literal ? "-F" : "",
        context > 0 ? `-C ${context}` : "",
        `-m ${input.limit}`,
      ]
        .filter(Boolean)
        .join(" ");
      const glob = input.glob === undefined ? "" : `--include=${quote(input.glob)}`;
      const result = await sandbox.run({
        abortSignal: input.abortSignal,
        command: `grep -R ${grepFlags} ${glob} -- ${quote(input.pattern)} ${quote(input.path)} | head -n ${input.limit + 1}`,
      });
      const lines = splitCommandLines(result.stdout);
      const truncated = lines.length > input.limit;
      const selected = lines.slice(0, input.limit).join("\n");
      return {
        content: selected.length > 0 ? `${selected}\n` : selected,
        truncated,
      };
    },
  };
}

export function createSandboxWorkspaceWriter(sandbox: SandboxSession): WorkspaceWriter {
  return {
    async clearRoot() {
      await sandbox.removePath({ force: true, path: CURL_OS_ROOT, recursive: true });
    },
    async writeFile(path, content) {
      await sandbox.writeBinaryFile({ content, path });
    },
  };
}

function quote(input: string): string {
  return `'${input.replaceAll("'", "'\\''")}'`;
}

function splitCommandLines(content: string): string[] {
  if (content.length === 0) return [];
  const hasTrailingNewline = content.endsWith("\n");
  const lines = content.split(/\r?\n/);
  if (hasTrailingNewline) lines.pop();
  return lines;
}
