# Repository review policy

Curl optionally reads `.curl/review-policy.json` from the pull request's base
commit. A policy change in the pull request therefore does not affect the
review that evaluates that change.

The policy is configuration data, not additional model instructions. It can
add bounded context and suppress low-signal publication, but it cannot disable
correctness or security review, bypass evidence validation, or mark an
unverified check as passed.

```json
{
  "version": 1,
  "languages": ["TypeScript"],
  "frameworks": ["Eve"],
  "securitySensitivePaths": ["agent/auth/**", "migrations/**"],
  "extraScrutinyPaths": ["agent/channels/**"],
  "generatedPaths": ["generated/**"],
  "requiredChecks": ["typecheck", "test"],
  "minimumPublicationSeverity": "low",
  "minimumPublicationConfidence": "medium"
}
```

Fields may be omitted and use safe defaults. Paths are repository-relative
globs and cannot contain traversal, absolute paths, or shell-style pattern
syntax beyond `*`, `?`, and `**`. A missing policy uses safe defaults. A
malformed policy also uses safe defaults and is mentioned in the review
summary.

Required checks are evidence-based. Curl only accepts check runs whose
`head_sha` matches the reviewed head. A `success` conclusion is `passed`, known
failure conclusions are `failed`, and stale, skipped, neutral, missing, or
ambiguous evidence is `unknown`. If authoritative check-run data is not
available, Curl reports the check as `unknown`; it never infers a pass.
