# Changelog

All notable changes to this project are documented in this file. The format
is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.61] - 2026-09-18

dsh 0.1.5-rc.2 compatibility release.

### Fixed

- **Session titles on the panel (P1)**: `bots/sessions` looked up
  `readTitleSnapshots` on the `sessionTitle` service, but the batch title
  reader lives on `sessionQuery` — the guard silently skipped the call and
  every session fell back to its cwd-derived name. The method is now called
  on the `sessionQuery` handle the code already holds (allSettled-style
  results, verified against dsh 0.1.5-rc.2's dsh-session-query types).

### Changed

- `@deepseek-ai/dsh-typert-protocol` peer moved to `^0.1.5-rc.2` (the dsh
  core convention; `^0.1.0-rc.6` could never resolve to 0.1.5-rc.x under npm
  prerelease semantics). Keep it single-instance with the host via the
  profile's `pnpm.overrides`.

## [0.2.60]

- See git history; this changelog was introduced with 0.2.61.
