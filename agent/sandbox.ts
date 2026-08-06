import { createCurlSandboxBackend } from "@anturno/curlos/sandbox";
import { defineSandbox } from "eve/sandbox";

/**
 * Curl owns the sandbox runtime via CurlOS. Each session gets a private
 * in-memory workspace, exposes only bounded read/search commands, and never
 * gives the guest network access or GitHub credentials.
 */
export default defineSandbox({
  backend: createCurlSandboxBackend(),
});
