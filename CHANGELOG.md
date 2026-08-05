# Changelog

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
