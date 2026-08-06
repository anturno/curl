import { describe, expect, test } from "bun:test";
import {
  boundCurlOsText,
  CURL_OS_LIMITS,
  type CurlOsHost,
  createCurlOsBackend,
  resolveCurlOsPath,
} from "../agent/lib/curlos";

describe("CurlOS path policy", () => {
  test("normalizes workspace-relative paths", () => {
    expect(resolveCurlOsPath("src/../README.md")).toBe("/workspace/README.md");
    expect(resolveCurlOsPath("/workspace/src/./agent.ts")).toBe("/workspace/src/agent.ts");
  });

  test("rejects paths outside the workspace", () => {
    expect(() => resolveCurlOsPath("/etc/passwd")).toThrow("path escapes /workspace");
    expect(() => resolveCurlOsPath("../secrets.txt")).toThrow("path escapes /workspace");
    expect(() => resolveCurlOsPath("$HOME/.ssh/id_rsa")).toThrow("home-directory paths");
  });
});

describe("CurlOS output policy", () => {
  test("bounds output by UTF-8 bytes", () => {
    const bounded = boundCurlOsText(`${"a".repeat(CURL_OS_LIMITS.maxOutputBytes - 1)}é`);

    expect(bounded.truncated).toBe(true);
    expect(Buffer.byteLength(bounded.content, "utf8")).toBeLessThanOrEqual(
      CURL_OS_LIMITS.maxOutputBytes,
    );
  });

  test("does not alter output within the limit", () => {
    expect(boundCurlOsText("small result")).toEqual({
      content: "small result",
      truncated: false,
    });
  });
});

describe("CurlOS host seam", () => {
  test("passes bounded list/search requests to the host", async () => {
    const listCalls: unknown[] = [];
    const searchCalls: unknown[] = [];
    const host: CurlOsHost = {
      readTextFile: async () => "",
      listFiles: async (input) => {
        listCalls.push(input);
        return { paths: ["/workspace/src/a.ts", "/workspace/src/b.ts"], truncated: true };
      },
      searchFiles: async (input) => {
        searchCalls.push(input);
        return { content: "match\nsecond\n", truncated: true };
      },
    };
    const runtime = createCurlOsBackend(host);

    const glob = await runtime.glob({ pattern: "**/*.ts", path: "src", limit: 1 });
    const grep = await runtime.grep({
      literal: true,
      limit: 1,
      path: "src",
      pattern: "a'b",
    });

    expect(runtime.name).toBe("curlos");
    expect(glob.content).toBe("/workspace/src/a.ts\n");
    expect(glob.truncated).toBe(true);
    expect(listCalls).toEqual([
      {
        path: "/workspace/src",
        pattern: "**/*.ts",
        limit: 1,
        abortSignal: undefined,
      },
    ]);
    expect(grep.content).toBe("match\n");
    expect(grep.truncated).toBe(true);
    expect(searchCalls).toEqual([
      {
        path: "/workspace/src",
        pattern: "a'b",
        glob: undefined,
        ignoreCase: undefined,
        literal: true,
        context: 0,
        limit: 1,
        abortSignal: undefined,
      },
    ]);
  });
});
