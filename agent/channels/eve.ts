import { localDev, vercelOidc } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

/**
 * HTTP channel for local `eve dev` / TUI and Vercel OIDC callers.
 * Curl's product surface is the GitHub channel — no public browser UI.
 */
export default eveChannel({
  auth: [
    vercelOidc(),
    // Open on localhost for `eve dev` and the REPL; ignored in production.
    localDev(),
  ],
});
