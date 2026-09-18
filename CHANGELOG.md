# Changelog

All notable changes to this project are documented in this file. The format
is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.62] - 2026-09-18

The engine-restart reliability release: an `applyModel` pick could leave the
engine UNLOADED, silently, for hours.

### Fixed

- **applyModel bootout→bootstrap race (root cause of the 2026-09-18
  "gateway.json not found" outage, ~3.5 h)**: launchd's `bootout` returns
  before the outgoing process exits, and a bootstrap landing inside that
  window fails with "Bootstrap failed: 5: Input/output error" (reproduced 5/5
  with a scratch job). The old code bootstrapped immediately and discarded
  stderr, so the engine ended up unloaded — no RunAtLoad, no KeepAlive — and
  every plugin call threw "gateway.json not found". The reload orchestration
  now lives in `src/launchd.ts`: wait until the label is actually released
  (bounded `launchctl print` polling), retry the bootstrap, kickstart, and
  return every stderr instead of dropping it.

### Changed

- **applyModel failures are rendered, not swallowed**: the RPC now returns
  `errors[]`, the client shouts "apply failed" with launchctl's own stderr,
  and failures are appended to `dsh-bots-diag.jsonl` for post-mortem.
- **Activation engine self-check**: ~4 s after the plugin activates it probes
  discovery + `/health` (with retries); if the gateway is unreachable AND the
  launchd job is unloaded, it bootstraps the job back — "comes alive with dsh
  web" for the unloaded case nothing else could repair. A
  loaded-but-unhealthy job stays launchd's business (KeepAlive + watchdog).
- The `~/.sdk-bots/watchdog.sh` companion (outside this repo) gained the
  missing branch: job not loaded → `launchctl bootstrap`, loaded but down →
  `kickstart`. Its StartInterval timer had also proven unreliable that day.

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
