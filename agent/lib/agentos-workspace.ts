import { tmpdir } from "node:os";
import { join } from "node:path";

/** Guest mount path for the repository tree. */
export const AGENTOS_WORKSPACE_MOUNT = "/workspace";

/**
 * Host directory projected into the agentOS VM at {@link AGENTOS_WORKSPACE_MOUNT}.
 * Shared by sandbox `create()` and the host-side GitHub materialize path so the
 * installation token never enters the guest.
 */
export function agentOsWorkspaceHostPath(sessionKey: string): string {
  return join(tmpdir(), "eve-agentos", encodeURIComponent(sessionKey), "workspace");
}

/** Host-only metadata (checkout markers); not mounted into the VM. */
export function agentOsCheckoutMetaPath(sessionKey: string): string {
  return join(tmpdir(), "eve-agentos", encodeURIComponent(sessionKey), "meta");
}
