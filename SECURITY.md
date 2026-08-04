# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| `main` (pre-`v0.1.0`) | Yes — best effort |
| Latest GitHub Release (`v0.x`) | Yes |
| Older patch lines | Best effort; upgrade when possible |

Once `v0.1.0` ships, this table tracks release tags. Prefer consuming a **release
tag**, not an arbitrary `main` commit, when self-hosting.

## Reporting a vulnerability

Please report security issues privately via
[GitHub Security Advisories](https://github.com/anturno/curl/security/advisories/new)
for this repository. Do **not** open a public issue for vulnerabilities.

Include:

- A description of the issue and its impact
- Steps to reproduce, or a proof of concept if safe
- Affected version / commit / deployment shape if known

## Response targets (SLA examples)

| Stage | Target |
|-------|--------|
| Acknowledgement | within **48 hours** |
| Initial status update | within **7 days** |
| Fix or mitigation target | within **90 days** (faster for critical) |

Critical issues may be addressed out-of-band with a shorter timeline. We may ask
for clarification before confirming a vulnerability.

## Scope notes

Curl is a PR review agent. Reports that involve model output quality alone
(false positives / missed nits) are product feedback, not security
advisories—unless they demonstrate a concrete vulnerability in the host, channel
auth, secret handling, or sandbox boundary.
