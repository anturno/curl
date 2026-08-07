# Configuration

Curl reads environment variables when the agent starts. Copy [`.env.example`](../.env.example) for a local reference and keep real values in the deployment secret store.

## Required environment variables

| Variable | Value |
| --- | --- |
| `OPENCODE_API_KEY` | OpenCode Go API key |
| `GITHUB_APP_ID` | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App private key (PEM) |
| `GITHUB_WEBHOOK_SECRET` | Webhook secret for the GitHub App |

## Optional environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `OPENCODE_MODEL` | `gpt-5.6-luna` | Responses API model id |
| `OPENCODE_REASONING` | `medium` | `high`, `medium`, or `low` |
| `OPENCODE_MODEL_CONTEXT_WINDOW_TOKENS` | `200000` | Model context window |
| `CURL_MAX_INPUT_TOKENS_PER_SESSION` | `200000` | Session input-token budget |
| `CURL_MAX_OUTPUT_TOKENS_PER_SESSION` | `8192` | Session output-token budget |
| `CURL_SESSION_TIMEOUT_MS` | `600000` (10 minutes) | Maximum session lifetime |
| `GITHUB_APP_SLUG` | `anturno-curl` | `@mention` and webhook bot name |

## GitHub App setup

Subscribe to these events:

- **Issue comments** — mention-driven review on pull request comments
- **Pull request review comments** — mention-driven inline review threads

Permissions:

- **Contents: Read-only**
- **Issues: Read and write**
- **Pull requests: Read and write**
- **Metadata: Read-only**

No Check, Actions, or repository secrets permissions are required.

Set the webhook URL to `https://<deployment>/eve/v1/github`.

## Runtime boundaries

- Curl materializes only the changed files for the pull request.
- The model has only `read_file`, `glob`, and `grep`.
- Credentials stay on the host; only decoded file bytes enter the sandbox.
