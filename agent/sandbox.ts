import { defineSandbox } from "eve/sandbox";
import { createCurlSandboxBackend } from "./lib/curl-sandbox";

/**
 * Curl owns the sandbox runtime. Each session gets a private in-memory
 * workspace, exposes only bounded read/search commands, and never gives the
 * guest network access or GitHub credentials.
 */
export default defineSandbox({
  backend: createCurlSandboxBackend(),
});
