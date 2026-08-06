import { describe, expect, test } from "bun:test";
import type { GitHubEventContext } from "eve/channels/github";
import { createCurlSandboxBackend } from "../agent/lib/curl-sandbox";
import { materializeGitHubCheckout } from "../agent/lib/github-checkout";

const COMMIT_SHA = "a".repeat(40);

describe("custom GitHub checkout", () => {
  test("materializes repository blobs through the host API", async () => {
    const requests: string[] = [];
    const backend = createCurlSandboxBackend();
    const handle = await backend.create({
      runtimeContext: { appRoot: "/app" },
      sessionKey: "checkout-test",
      templateKey: null,
    });
    const channel = {
      github: {
        async request<T>({ path }: { readonly method: "GET"; readonly path: string }) {
          requests.push(path);
          const body = path.includes("/git/trees/")
            ? {
                tree: [{ path: "src/index.ts", sha: "b".repeat(40), size: 14, type: "blob" }],
              }
            : {
                content: Buffer.from("export const ok = true;\n").toString("base64"),
                encoding: "base64",
              };
          return { body: body as T, ok: true, status: 200 };
        },
      },
      state: {
        defaultBranch: "main",
        headRef: "feature",
        headSha: COMMIT_SHA,
        owner: "acme",
        repo: "widget",
      },
    } as unknown as GitHubEventContext;

    await materializeGitHubCheckout(channel, handle.session);

    expect(await handle.session.readTextFile({ path: "src/index.ts" })).toBe(
      "export const ok = true;\n",
    );
    expect(channel.state.checkoutPath).toBe("/workspace");
    expect(channel.state.headSha).toBe(COMMIT_SHA);
    expect(requests).toEqual([
      `/repos/acme/widget/git/trees/${COMMIT_SHA}?recursive=1`,
      `/repos/acme/widget/git/blobs/${"b".repeat(40)}`,
    ]);

    await handle.shutdown();
  });

  test("leaves a usable workspace when the tree carries no blobs", async () => {
    const backend = createCurlSandboxBackend();
    const handle = await backend.create({
      runtimeContext: { appRoot: "/app" },
      sessionKey: "empty-checkout-test",
      templateKey: null,
    });
    const channel = {
      github: {
        async request<T>({ path }: { readonly method: "GET"; readonly path: string }) {
          const body = path.includes("/git/trees/")
            ? { tree: [{ path: "docs", sha: "c".repeat(40), type: "tree" }] }
            : {};
          return { body: body as T, ok: true, status: 200 };
        },
      },
      state: { headSha: COMMIT_SHA, owner: "acme", repo: "widget" },
    } as unknown as GitHubEventContext;

    await materializeGitHubCheckout(channel, handle.session);

    // The checkout clears /workspace; commands must still resolve against it
    // rather than failing on a missing working directory.
    const result = await handle.session.run({
      command: "find '/workspace' -type f -path '/workspace/*' -print | head -n 2",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("");

    await handle.shutdown();
  });

  test("skips blobs that omit tree size so the budget stays enforceable", async () => {
    const requests: string[] = [];
    const backend = createCurlSandboxBackend();
    const handle = await backend.create({
      runtimeContext: { appRoot: "/app" },
      sessionKey: "unsized-blob-checkout-test",
      templateKey: null,
    });
    const sizedSha = "b".repeat(40);
    const channel = {
      github: {
        async request<T>({ path }: { readonly method: "GET"; readonly path: string }) {
          requests.push(path);
          if (path.includes("/git/trees/")) {
            return {
              body: {
                tree: [
                  { path: "sized.ts", sha: sizedSha, size: 6, type: "blob" },
                  { path: "unsized.ts", sha: "c".repeat(40), type: "blob" },
                ],
              } as T,
              ok: true,
              status: 200,
            };
          }
          return {
            body: {
              content: Buffer.from("sized\n").toString("base64"),
              encoding: "base64",
            } as T,
            ok: true,
            status: 200,
          };
        },
      },
      state: { headSha: COMMIT_SHA, owner: "acme", repo: "widget" },
    } as unknown as GitHubEventContext;

    const manifest = await materializeGitHubCheckout(channel, handle.session);

    expect(await handle.session.readTextFile({ path: "sized.ts" })).toBe("sized\n");
    expect(await handle.session.readTextFile({ path: "unsized.ts" })).toBeNull();
    expect(manifest.files).toEqual([{ path: "sized.ts", sha: sizedSha, bytes: 6 }]);
    expect(manifest.skipped).toEqual([{ path: "unsized.ts", reason: "unsized" }]);
    expect(requests.filter((path) => path.includes("/git/blobs/"))).toEqual([
      `/repos/acme/widget/git/blobs/${sizedSha}`,
    ]);

    await handle.shutdown();
  });

  test("rejects trees whose known sizes exceed the workspace ceiling", async () => {
    const backend = createCurlSandboxBackend();
    const handle = await backend.create({
      runtimeContext: { appRoot: "/app" },
      sessionKey: "oversized-checkout-test",
      templateKey: null,
    });
    // 33 × 2 MB exceeds the 64 MB workspace ceiling while staying under the
    // per-file limit, so the checkout must fail before any blob fetch.
    const tree = Array.from({ length: 33 }, (_, index) => ({
      path: `chunk-${index}.bin`,
      sha: index.toString(16).padStart(40, "0"),
      size: 2_000_000,
      type: "blob" as const,
    }));
    const channel = {
      github: {
        async request<T>({ path }: { readonly method: "GET"; readonly path: string }) {
          if (!path.includes("/git/trees/")) {
            throw new Error(`unexpected blob fetch for ${path}`);
          }
          return { body: { tree } as T, ok: true, status: 200 };
        },
      },
      state: { headSha: COMMIT_SHA, owner: "acme", repo: "widget" },
    } as unknown as GitHubEventContext;

    await expect(materializeGitHubCheckout(channel, handle.session)).rejects.toThrow(
      "64000000-byte sandbox limit",
    );

    await handle.shutdown();
  });

  test("materializes many blobs", async () => {
    const backend = createCurlSandboxBackend();
    const handle = await backend.create({
      runtimeContext: { appRoot: "/app" },
      sessionKey: "many-blobs-checkout-test",
      templateKey: null,
    });
    const tree = Array.from({ length: 12 }, (_, index) => ({
      path: `src/f${index}.ts`,
      sha: index.toString(16).padStart(40, "0"),
      size: 4,
      type: "blob" as const,
    }));
    const channel = {
      github: {
        async request<T>({ path }: { readonly method: "GET"; readonly path: string }) {
          if (path.includes("/git/trees/")) {
            return { body: { tree } as T, ok: true, status: 200 };
          }
          const sha = path.split("/").at(-1) ?? "0".repeat(40);
          const index = Number.parseInt(sha, 16);
          return {
            body: {
              content: Buffer.from(`blob-${index}\n`).toString("base64"),
              encoding: "base64",
            } as T,
            ok: true,
            status: 200,
          };
        },
      },
      state: { headSha: COMMIT_SHA, owner: "acme", repo: "widget" },
    } as unknown as GitHubEventContext;

    await materializeGitHubCheckout(channel, handle.session);

    expect(await handle.session.readTextFile({ path: "src/f0.ts" })).toBe("blob-0\n");
    expect(await handle.session.readTextFile({ path: "src/f11.ts" })).toBe("blob-11\n");

    await handle.shutdown();
  });

  test("resolves branch refs to a commit SHA before recording headSha", async () => {
    const requests: string[] = [];
    const backend = createCurlSandboxBackend();
    const handle = await backend.create({
      runtimeContext: { appRoot: "/app" },
      sessionKey: "branch-ref-checkout-test",
      templateKey: null,
    });
    const channel = {
      github: {
        async request<T>({ path }: { readonly method: "GET"; readonly path: string }) {
          requests.push(path);
          if (path.includes("/commits/")) {
            return { body: { sha: COMMIT_SHA } as T, ok: true, status: 200 };
          }
          if (path.includes("/git/trees/")) {
            return {
              body: {
                tree: [{ path: "README.md", sha: "d".repeat(40), size: 5, type: "blob" }],
              } as T,
              ok: true,
              status: 200,
            };
          }
          return {
            body: {
              content: Buffer.from("hello").toString("base64"),
              encoding: "base64",
            } as T,
            ok: true,
            status: 200,
          };
        },
      },
      state: {
        defaultBranch: "main",
        headRef: "feature/branch",
        headSha: null,
        owner: "acme",
        repo: "widget",
      },
    } as unknown as GitHubEventContext;

    await materializeGitHubCheckout(channel, handle.session);

    expect(channel.state.headSha).toBe(COMMIT_SHA);
    expect(requests[0]).toBe("/repos/acme/widget/commits/feature%2Fbranch");
    expect(requests[1]).toBe(`/repos/acme/widget/git/trees/${COMMIT_SHA}?recursive=1`);

    await handle.shutdown();
  });
});
