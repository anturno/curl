import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

export default defineSandbox({
  description: "Curl's repository workspace.",
  // One vCPU / 2 GB is sufficient for Curl's mostly I/O-bound review workflow.
  // Eve owns persistence and brokers GitHub credentials at the Vercel firewall.
  backend: vercel({ resources: { vcpus: 1 } }),
  async bootstrap({ use }) {
    const sandbox = await use();
    // Vercel creates /workspace as root while commands run as the sandbox user.
    // Normalize ownership in the shared template so Git accepts Eve's checkout.
    await sandbox.run({ command: 'sudo chown "$(id -u):$(id -g)" /workspace' });
  },
});
