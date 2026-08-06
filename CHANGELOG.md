# Changelog

## 0.2.1

### Patch Changes

- [#12](https://github.com/anturno/curl/pull/12) [`1966b32`](https://github.com/anturno/curl/commit/1966b32d63005b404677e719c3be309f00acaa2f) Thanks [@JLeonStack](https://github.com/JLeonStack)! - Harden sticky review summary delivery by binding updates to Curl's bot identity, following paginated comments, and preserving current-head summaries during stale or retrying reviews. Add labeled quality eval fixtures for defensive, refuted, real-defect, and combined reviews.

## 0.2.0

### Minor Changes

- [#10](https://github.com/anturno/curl/pull/10) [`d7256f6`](https://github.com/anturno/curl/commit/d7256f6d57b559cf6c4b101f57aeb6002b1ceeaa) Thanks [@JLeonStack](https://github.com/JLeonStack)! - Add GitHub Check Run progress and sticky review summaries, make automatic review explicitly opt-in and repository-scoped, harden the read-only sandbox and configuration validation, and add deterministic test/eval and release gates.

All notable changes to Anturno Curl are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Minor Changes

- Show review progress as a GitHub Check Run (`Curl review`) on the PR Checks
  tab — in progress while reviewing, then completed with the verdict/summary.
  Requires Checks: write on the App; disable with `CURL_CHECK_RUN=0`.
- Automatically review pull requests when they are opened; mention
  `@anturno-curl` for an on-demand review.

## 0.1.0

### Minor Changes

- First public release of Curl — an eve-based GitHub PR reviewer focused on
  correctness and security.
  - Deploy with `eve deploy`; trigger reviews via `@anturno-curl review`
  - OpenCode Go inference (`gpt-5.6-luna`, high reasoning, Responses API)
  - Automatic review on pull requests when opened
  - Mock-backed eval fixtures for CI; `CURL_EVAL_MOCK` blocked on Vercel
