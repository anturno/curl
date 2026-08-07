# Changelog

## 0.2.3

### Patch Changes

- [#19](https://github.com/anturno/curl/pull/19) [`0f883a2`](https://github.com/anturno/curl/commit/0f883a21ce8a1e93ae4b6493d315ab76af6865f5) Thanks [@JLeonStack](https://github.com/JLeonStack)! - Adopt the released CurlOS Eve-first review runtime for diff-only workspaces,
  canonical inspect tools, and review-session reuse across turns.

## 0.2.2

### Patch Changes

- [#14](https://github.com/anturno/curl/pull/14) [`7f0f184`](https://github.com/anturno/curl/commit/7f0f18443352d65a933694992a379ef2788aedd3) Thanks [@JLeonStack](https://github.com/JLeonStack)! - Bound Curl's custom just-bash sandbox with resident-workspace and per-command
  execution limits, and restore the workspace root after a checkout clears it so
  a tree with no blobs still leaves a usable working directory. Upgrade just-bash
  to 3.2.0 and pin its defense-in-depth layer off, because that layer installs
  Node module hooks Bun does not implement and its `"auto"` mode does not detect
  the gap.

  Rename the sandbox backend to `just-bash`. Eve decides which optional engine
  packages to trace into a hosted build from the backend name in the compiled
  manifest, so an unrecognized name left `just-bash` untraced and the deployed
  function failed on cold start with `ERR_MODULE_NOT_FOUND`.

  Host-side GitHub checkout now shares the 64 MB workspace ceiling (failing before
  blob materialization), fetches blobs with bounded concurrency, and resolves
  branch refs to a real commit SHA before recording `state.headSha`.

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

### Changes

- Reuse the pinned CurlOS diff workspace across Eve turns and refresh it only
  when the pull-request head changes.
- Use CurlOS-owned diff checkout and canonical read-only review tools instead of
  duplicating checkout and schema logic inside Curl.

## 0.1.0

### Minor Changes

- First public release of Curl — an eve-based GitHub PR reviewer focused on
  correctness and security.
  - Deploy with `eve deploy`; trigger reviews via `@anturno-curl review`
  - OpenCode Go inference (`gpt-5.6-luna`, high reasoning, Responses API)
  - Automatic review on pull requests when opened
  - Mock-backed eval fixtures for CI; `CURL_EVAL_MOCK` blocked on Vercel
