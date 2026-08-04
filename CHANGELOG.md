# Changelog

All notable changes to Anturno Curl are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.0

### Minor Changes

- First public release of Curl — an eve-based GitHub PR reviewer focused on
  correctness and security.
  - Deploy with `eve deploy`; trigger reviews via `@anturno-curl review`
  - OpenCode Go inference (`gpt-5.6-luna`, high reasoning, Responses API)
  - Dogfood auto-review on `anturno/curl` (opened / reopened / ready_for_review)
  - Mock-backed eval fixtures for CI; `CURL_EVAL_MOCK` blocked on Vercel
