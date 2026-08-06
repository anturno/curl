import type { SandboxSession } from "eve/sandbox";
import { type CurlOs, createCurlOsBackend } from "./curlos";
import { createSandboxCurlOsHost } from "./curlos-sandbox-host";
import { getCurlOsSession } from "./curlos-session";

/** Prefer the live CurlOS session from turn.started; otherwise adapt the sandbox. */
export function curlOsForSandbox(sandbox: SandboxSession): CurlOs {
  return getCurlOsSession(sandbox.id) ?? createCurlOsBackend(createSandboxCurlOsHost(sandbox));
}
