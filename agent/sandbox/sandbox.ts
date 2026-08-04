import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

export default defineSandbox({
  description: "Curl's repository workspace.",
  // One vCPU / 2 GB is sufficient for Curl's mostly I/O-bound review workflow.
  // Eve owns persistence and brokers GitHub credentials at the Vercel firewall.
  backend: vercel({ resources: { vcpus: 1 } }),
});
