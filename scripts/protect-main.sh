#!/usr/bin/env bash
# Apply classic branch protection on main after the first push.
# Requires: gh auth with admin on anturno/curl; CI job named "check" must exist.
set -euo pipefail

REPO="${REPO:-anturno/curl}"
BRANCH="${BRANCH:-main}"

gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  "repos/${REPO}/branches/${BRANCH}/protection" \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["check"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "required_approving_review_count": 1,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": false
}
EOF

echo "Branch protection applied on ${REPO}@${BRANCH}"
echo "Admins can still push directly (enforce_admins=false) for solo dogfood."
