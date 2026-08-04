# Changelog

All notable changes to Anturno Curl are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Day-0 public skeleton: eve agent (deployed directly), GitHub channel, OpenCode
  Go inference, correctness + security review instructions, and OSS scaffold.

### Changed

- Dropped the Next.js web chat host; Curl deploys as a pure eve agent.

### Added

- Biome (`bun run check`) and CI formatting/lint gate.
- Package manager switched to Bun (`bun.lock`, `packageManager` field).
- Split docs: public `docs/` vs maintainer-only `internal/` (gitignored).
- Golden PR eval fixtures under `evals/` (security, correctness, clean docs).
