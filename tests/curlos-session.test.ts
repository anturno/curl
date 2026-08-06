import { describe, expect, test } from "bun:test";
import {
  type CheckoutManifest,
  type CheckoutProvider,
  CURL_OS_ROOT,
  type CurlOsHost,
  closeRememberedCurlOsSession,
  DEFAULT_CURL_OS_LIMITS,
  getCurlOsSession,
  openCurlOs,
  rememberCurlOsSession,
  type WorkspaceWriter,
} from "../agent/lib/curlos-session";

function memoryWorkspace(): {
  readonly files: Map<string, Uint8Array>;
  readonly host: CurlOsHost;
  readonly writer: WorkspaceWriter;
} {
  const files = new Map<string, Uint8Array>();
  const writer: WorkspaceWriter = {
    async clearRoot() {
      files.clear();
    },
    async writeFile(path, content) {
      const relative = path.startsWith(`${CURL_OS_ROOT}/`)
        ? path.slice(CURL_OS_ROOT.length + 1)
        : path;
      files.set(relative, content);
    },
  };
  const host: CurlOsHost = {
    async readTextFile({ path, startLine, endLine }) {
      const relative = path.startsWith(`${CURL_OS_ROOT}/`)
        ? path.slice(CURL_OS_ROOT.length + 1)
        : path;
      const bytes = files.get(relative);
      if (bytes === undefined) return null;
      const text = new TextDecoder().decode(bytes);
      const lines = text.split(/\r?\n/);
      const start = Math.max(1, startLine ?? 1);
      const end = endLine ?? lines.length;
      return lines.slice(start - 1, end).join("\n");
    },
    async listFiles({ path, pattern, limit }) {
      const prefix = path === CURL_OS_ROOT ? "" : path.slice(CURL_OS_ROOT.length + 1);
      const matched = [...files.keys()]
        .filter((file) => (prefix.length === 0 ? true : file.startsWith(`${prefix}/`)))
        .filter((file) => file.includes(pattern.replaceAll("*", "")))
        .slice(0, limit + 1);
      const truncated = matched.length > limit;
      return {
        paths: matched.slice(0, limit).map((file) => `${CURL_OS_ROOT}/${file}`),
        truncated,
      };
    },
    async searchFiles({ path, pattern, limit }) {
      const prefix = path === CURL_OS_ROOT ? "" : path.slice(CURL_OS_ROOT.length + 1);
      const lines: string[] = [];
      for (const [file, bytes] of files) {
        if (prefix.length > 0 && !file.startsWith(`${prefix}/`) && file !== prefix) continue;
        const text = new TextDecoder().decode(bytes);
        for (const [index, line] of text.split(/\r?\n/).entries()) {
          if (!line.includes(pattern)) continue;
          lines.push(`${CURL_OS_ROOT}/${file}:${index + 1}:${line}`);
          if (lines.length > limit) break;
        }
        if (lines.length > limit) break;
      }
      const truncated = lines.length > limit;
      return {
        content: `${lines.slice(0, limit).join("\n")}${lines.length > 0 ? "\n" : ""}`,
        truncated,
      };
    },
  };
  return { files, host, writer };
}

describe("openCurlOs", () => {
  test("materializes through the provider then inspects and closes", async () => {
    const { files, host, writer } = memoryWorkspace();
    let materialized = false;
    const provider: CheckoutProvider = {
      async materialize(ref, workspaceWriter, limits) {
        expect(ref).toEqual({ owner: "acme", repo: "widget", sha: "a".repeat(40) });
        expect(limits.maxWorkspaceBytes).toBe(DEFAULT_CURL_OS_LIMITS.maxWorkspaceBytes);
        await workspaceWriter.clearRoot();
        await workspaceWriter.writeFile(
          `${CURL_OS_ROOT}/src/ok.ts`,
          new TextEncoder().encode("export const ok = 1;\n"),
        );
        materialized = true;
        const manifest: CheckoutManifest = {
          sha: ref.sha,
          root: CURL_OS_ROOT,
          files: [{ path: "src/ok.ts", sha: "b".repeat(40), bytes: 20 }],
          skipped: [],
          bytes: 20,
        };
        return manifest;
      },
    };

    const session = await openCurlOs({
      checkout: { owner: "acme", repo: "widget", sha: "a".repeat(40) },
      provider,
      host,
      writer,
    });

    expect(materialized).toBe(true);
    expect(session.profile).toBe("inspect");
    expect(session.manifest.files).toEqual([{ path: "src/ok.ts", sha: "b".repeat(40), bytes: 20 }]);
    expect(files.has("src/ok.ts")).toBe(true);

    const read = await session.readFile({ filePath: "src/ok.ts", limit: 10 });
    expect(read.content).toContain("export const ok = 1;");
    expect(read.path).toBe("/workspace/src/ok.ts");

    await session.close();
    expect(files.size).toBe(0);
    await expect(session.readFile({ filePath: "src/ok.ts" })).rejects.toThrow("shut down");
  });

  test("remembers a session until closeRememberedCurlOsSession", async () => {
    const { host, writer } = memoryWorkspace();
    const session = await openCurlOs({
      checkout: { owner: "acme", repo: "widget", sha: "a".repeat(40) },
      provider: {
        async materialize(ref, workspaceWriter) {
          await workspaceWriter.clearRoot();
          await workspaceWriter.writeFile(`${CURL_OS_ROOT}/a.ts`, new TextEncoder().encode("a\n"));
          return {
            sha: ref.sha,
            root: CURL_OS_ROOT,
            files: [{ path: "a.ts", sha: "b".repeat(40), bytes: 2 }],
            skipped: [],
            bytes: 2,
          };
        },
      },
      host,
      writer,
    });
    rememberCurlOsSession("sandbox-1", session);
    expect(getCurlOsSession("sandbox-1")).toBe(session);
    await closeRememberedCurlOsSession("sandbox-1");
    expect(getCurlOsSession("sandbox-1")).toBeUndefined();
    await expect(session.readFile({ filePath: "a.ts" })).rejects.toThrow("shut down");
  });

  test("rejects profiles other than inspect", async () => {
    const { host, writer } = memoryWorkspace();
    await expect(
      openCurlOs({
        // @ts-expect-error — only inspect exists today
        profile: "prove",
        checkout: { owner: "acme", repo: "widget", sha: "a".repeat(40) },
        provider: {
          async materialize() {
            return {
              sha: "a".repeat(40),
              root: CURL_OS_ROOT,
              files: [],
              skipped: [],
              bytes: 0,
            };
          },
        },
        host,
        writer,
      }),
    ).rejects.toThrow("inspect");
  });
});
