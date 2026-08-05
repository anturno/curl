import { defaultBackend, defineSandbox } from "eve/sandbox";

/**
 * GitHub's built-in checkout temporarily replaces this with its documented
 * credential-brokered GitHub-only policy on firewall-capable backends. Starting
 * from deny-all prevents a review turn from inheriting broad egress before the
 * checkout begins. Docker supports the coarse deny-all policy; Vercel and
 * microsandbox also support Eve's GitHub checkout policy.
 */
const backend = defaultBackend({
  docker: { networkPolicy: "deny-all" },
  microsandbox: { networkPolicy: "deny-all" },
  vercel: { networkPolicy: "deny-all" },
  // just-bash has no real networked binaries and no network-policy API.
});

/**
 * Git may see the platform-created /workspace directory as owned by another
 * user. Mark it safe before the GitHub channel initializes the checkout.
 *
 * Local fallback backends can run without Git, so keep this setup conditional.
 * No environment variables or credentials are copied into the sandbox.
 */
export default defineSandbox({
  backend,
  async onSession({ use }) {
    const sandbox = await use();
    const result = await sandbox.run({
      command:
        "if command -v git >/dev/null 2>&1; then git config --global --add safe.directory /workspace; fi",
    });
    if (result.exitCode !== 0) {
      throw new Error(`Failed to configure Git safe.directory for /workspace: ${result.stderr}`);
    }
  },
});
