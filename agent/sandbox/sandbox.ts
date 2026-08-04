import { mkdir } from "node:fs/promises";
import { AgentOs } from "@rivet-dev/agentos-core";
import { agentOSCoreBackend } from "@rivet-dev/agentos-eve";
import { defineSandbox } from "eve/sandbox";
import { AGENTOS_WORKSPACE_MOUNT, agentOsWorkspaceHostPath } from "../lib/agentos-workspace";

export default defineSandbox({
  description: "Curl's repository workspace.",
  backend: agentOSCoreBackend({
    async create({ sessionKey }) {
      // Core VMs are ephemeral across process restarts; /workspace is a host_dir
      // mount. GitHub checkout materializes the tree on the host (token stays out
      // of the guest) into this same path.
      const hostPath = agentOsWorkspaceHostPath(sessionKey);
      await mkdir(hostPath, { recursive: true });

      return AgentOs.create({
        // Deny guest egress — repo content is seeded on the host; secrets never
        // need to enter the VM for GitHub auth.
        permissions: { network: "deny" },
        mounts: [
          {
            path: AGENTOS_WORKSPACE_MOUNT,
            plugin: {
              id: "host_dir",
              config: { hostPath },
            },
            readOnly: false,
          },
        ],
      });
    },
  }),
});
