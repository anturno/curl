# Install

Three steps to run Curl on a repository. See the [configuration guide](./configuration.md)
for the complete variable, permission, privacy, and limit reference.

## 1. Deploy

```bash
bun install
bun run check
bun run typecheck
bun run build
eve deploy
```

Self-host: `bun run build && bun start` (serves the Nitro output under `.output/`).

## 2. Connect GitHub

Create a self-managed GitHub App and set these environment variables:

- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_APP_SLUG` (optional, default `anturno-curl`)

Webhook URL:

```text
https://<your-deployment>/eve/v1/github
```

Subscribe the App to these events:

- **Issue comments** — mention-driven review on pull request comments
- **Pull request review comments** — mention-driven inline review threads

Grant only these repository permissions:

- **Contents: Read-only**
- **Issues: Read and write**
- **Pull requests: Read and write**
- **Metadata: Read-only**

No Checks, Actions, or repository-secrets permission is required.

## 3. Review a PR

```text
@anturno-curl review
```

Curl is mention-driven only. It fetches only the changed files for the pull
request, runs the review, and posts one new summary comment. There are no
automatic reviews, no Check Runs, and no code fixes.
