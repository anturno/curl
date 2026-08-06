import { describe, expect, test } from "bun:test";
import { createCurlSandboxBackend } from "../agent/lib/curl-sandbox";

describe("Curl custom sandbox", () => {
  test("isolates workspace files and permits only bounded search commands", async () => {
    const backend = createCurlSandboxBackend();
    const handle = await backend.create({
      runtimeContext: { appRoot: "/app" },
      sessionKey: "sandbox-test",
      templateKey: null,
    });

    await handle.session.writeTextFile({
      content: "needle\n",
      path: "src/example.txt",
    });
    expect(await handle.session.readTextFile({ path: "src/example.txt" })).toBe("needle\n");

    const result = await handle.session.run({
      command: "grep -R -F -m 1 -- 'needle' '/workspace/src' | head -n 2",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("needle");

    await expect(handle.session.run({ command: "node -e 'process.exit(1)'" })).rejects.toThrow(
      "only permits bounded",
    );
    await expect(
      handle.session.run({
        command: "find /workspace -type f -path '/workspace/*' -delete -print | head -n 2",
      }),
    ).rejects.toThrow("only permits bounded");
    await expect(handle.session.readTextFile({ path: "../outside.txt" })).rejects.toThrow(
      "escapes /workspace",
    );
    await expect(handle.session.setNetworkPolicy("allow-all")).rejects.toThrow("no guest network");

    await handle.shutdown();
    await expect(handle.session.readTextFile({ path: "src/example.txt" })).rejects.toThrow(
      "shut down",
    );
  });

  test("refuses writes past the workspace byte budget", async () => {
    const backend = createCurlSandboxBackend();
    const handle = await backend.create({
      runtimeContext: { appRoot: "/app" },
      sessionKey: "budget-test",
      templateKey: null,
    });

    await expect(
      handle.session.writeBinaryFile({
        content: new Uint8Array(64_000_001),
        path: "huge.bin",
      }),
    ).rejects.toThrow("ENOSPC");

    // The rejected write must not be charged, so the session stays usable.
    await handle.session.writeTextFile({ content: "ok\n", path: "small.txt" });
    expect(await handle.session.readTextFile({ path: "small.txt" })).toBe("ok\n");

    await handle.shutdown();
  });

  test("releases the budget and keeps a usable root when the workspace is cleared", async () => {
    const backend = createCurlSandboxBackend();
    const handle = await backend.create({
      runtimeContext: { appRoot: "/app" },
      sessionKey: "reset-test",
      templateKey: null,
    });

    await handle.session.writeBinaryFile({ content: new Uint8Array(40_000_000), path: "a.bin" });
    await handle.session.removePath({ force: true, path: "/workspace", recursive: true });

    // A second checkout of the same size must fit after the root is cleared.
    await handle.session.writeBinaryFile({ content: new Uint8Array(40_000_000), path: "b.bin" });
    await handle.session.writeTextFile({ content: "needle\n", path: "src/example.txt" });

    const result = await handle.session.run({
      command: "grep -R -F -m 1 -- 'needle' '/workspace' | head -n 2",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("needle");

    await handle.shutdown();
  });

  test("propagates caller cancellation through the composed deadline", async () => {
    const backend = createCurlSandboxBackend();
    const handle = await backend.create({
      runtimeContext: { appRoot: "/app" },
      sessionKey: "abort-test",
      templateKey: null,
    });

    const controller = new AbortController();
    controller.abort();
    await expect(
      handle.session.run({
        abortSignal: controller.signal,
        command: "grep -R -F -m 1 -- 'needle' '/workspace' | head -n 2",
      }),
    ).rejects.toThrow();

    await handle.shutdown();
  });
});
