# Changelog

All notable changes to this project are documented in this file. The format
is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.67] - 2026-10-08

### Added

- **bloub bot avatars**: the built-in fallback avatars (bots without a custom
  `avatarDataUrl`) are now stills of
  [bloub](https://github.com/jeremy-prt/bloub) — Jérémy Perret's MIT-licensed
  SVG recreation of the x.ai bot avatar: one filled shape, two white eyes,
  every number measured off the reference video. Eight variants cover eight of
  the fourteen measured states (idle, thinking, wink, play, notify, wide,
  orbit, egg) over the bloub colour palette, picked per bot id so a bot keeps
  its avatar across reloads. The stills are baked at build time by
  `scripts/generate-bot-avatars.mjs` from the vendored engine in `tools/bloub`
  (eyes punched through the body via mask, orbit halves layered behind/front,
  notification badge on `notify`); the shipped client carries only data URLs —
  the engine never ships.

## [0.2.66] - 2026-10-08

M0 reliability baseline for multi-bot goal collaboration, paired with the
sdk-bots 0.5.1 engine release (see
`docs/multi-bot-goal-collaboration-improvement.md`).

### Fixed

- **Diag version observability (F12)**: every `dsh-bots-diag.jsonl` line that
  day read `version: "unresolved"` — `require.resolve('dsh-bots')` cannot see
  the plugin's own name inside the installed layout. The version now comes
  from `ownModuleVersion()`, which climbs from the module file to the
  manifest that actually names the plugin; the peer probe keeps its own
  resolution path and honest sentinels.
- **Declared goal routines (F10)**: the workbench creates goal automations
  with `kind: "goal"` so the engine's fail-closed ledger guard keys off the
  structural declaration; the `DSH-GOAL-` name prefix stays as a
  migration-compat marker only. Older engines drop the unknown field
  harmlessly.
- **Docs sync (F12)**: README member-cap copy now states the real limits
  (8 default / 16 engine hard cap) instead of the stale "6-member cap".

## [0.2.65] - 2026-10-08

Native-parity pass against the running dsh 0.2.0-rc.2 web UI: every value
below was read out of the shipped CSS modules and bundles
(`dsh-client-ui-chat`, `-conversation`, `-tool`, `-workspace`,
`-settings-general`, `-settings-models`) and re-pinned in tests.

### Fixed

- **Dead radius tokens made corners square** — dsh 0.2.0-rc.2 deleted the
  `--dsw-radius-*` scale entirely (native CSS modules hardcode radii), so
  every `var(--dsw-radius-*)` in the plugin resolved to 0. Now the native
  literals: composer card and user bubble 22px, ioCard 12px, sidebar rows 8px,
  avatar 6px, settings cards 16px, settings selects 8px.
- **思考中 (turn status)**: the label is the native `chat.deepDiving` copy
  (「深度求索中...」/ "Deep diving...") at the native TurnStatus metrics
  (26px+delta row, content font, 22px+delta line); the elapsed clock only
  appears past the native 15s threshold and uses the native
  `formatRunDuration` form ("35秒" / "1分35秒"); the fish glyph and the
  typing-row stop pill (which the native row never had) are gone — stop lives
  only in the composer corner while the draft is empty, exactly the native
  `primaryStops` gate.
- **思考内容 (ReasoningRow)**: the one-line summary strips markdown bold like
  the native preview; summary and expanded body ride the 20px secondary line
  (`--dsh-content-font-delta-secondary`); the streaming tail stays visible via
  the native `data-follow-end` text rules; the chevron is always shown, as in
  the shipped DisclosureRow.
- **会话 (content column)**: `--dsh-chat-content-width` follows the native
  responsive clamp (680px..920px, 64% of the measured column) instead of the
  stale fixed 748px; the panel publishes its measured width as
  `--dsh-conversation-column-width` via a ResizeObserver, mirroring the
  conversation root. Sidebar session rows: time text at the native 12px/20px,
  hover actions gap 12px.
- **头像 (avatars)**: single-bot transcripts no longer render an author
  header (the native stream has none); avatar + name attribution remains only
  in group rooms where multiple authors make it load-bearing.
- **输入框 (composer)**: the character counter is gone (the native trailing
  group carries none); the queued-send tooltip is the native "排队发送" /
  "Queue message"; the stop glyph matches the native rx=3 square.
- **设置 (settings)**: sections open with the native 16px/500 title over a
  14px/22px tertiary intro; internal tabs follow the native conversation-tab
  anatomy (13px/500 tertiary labels, 36px gaps, 2px business underline, no
  rail border); cards match the native `rowCard` (.5px l4 border, 16px
  radius, 12px 14px padding, 12px gap, no fill) with 500-weight heads and
  14px/22px rows.
- **Delegation kit**: `useSessionRetainInfo` / `useSessionStatus` (new in the
  0.2.0-rc.2 workspace shadow kit) classified `synthesized` — the generic
  forward already carries them.

## [0.2.64] - 2026-09-30

The dsh 0.2.0 compatibility release. No code changes.

### Changed

- **Widen the dsh peer range for dsh 0.2.0** (install-gate adaptation, audited
  against the npm tarballs of 0.1.7-rc.1 → 0.2.0-rc.2): the plugin manager
  evaluates `@deepseek-ai/dsh-*` peers with
  `semver.satisfies(runtime, range, {includePrerelease: true})`, so
  `^0.1.5-rc.2` still admits 0.2.0-rc.x (prerelease ordering) but would
  **reject dsh 0.2.0 final**. Peer
  `@deepseek-ai/dsh-typert-protocol` is now
  `^0.1.5-rc.2 || ^0.2.0-rc.2`, which admits 0.1.5-rc.2+ and 0.2.x
  (rc and final).
- **0.2.0-rc.2 contract audit (zero breakage)**: every surface this plugin
  touches is additive between 0.1.7-rc.1 and 0.2.0-rc.2 — typert-protocol is
  code-identical; `sessionQuery` only gained a `@throws` doc line; the llm
  service gained `ToolUpdate`/`ToolHistory`/`ACCOUNT_QUOTA` without touching
  existing signatures; `agentDefaultModel.saveSelection` now serializes saves
  (same API); the web-app slot graph only adds telemetry/shortcuts rows.
- Also ships the previously unpublished 0.2.62 (engine applyModel
  bootout→bootstrap race fix) and 0.2.63 (host-error localization + theme
  token audit) to npm.

## [0.2.63] - 2026-09-18

The i18n/theme conformance release: locale and dark/light support audited
against the running shell, gaps closed.

### Changed

- **Host errors are localized (i18n)**: `callGateway`'s engine-internal
  messages ("gateway.json not found — sdk-bots host 是否在运行？", "gateway
  unauthorized") rendered raw in every panel, stranding half the UI in the
  wrong language. A shared `errText` maps the recurring, user-actionable ones
  to locale strings (`errors.gatewayDown` / `errors.gatewayAuth`); unknown
  errors still pass through verbatim so nothing is masked.
- **Theme audit vs the shell's real token source** (dsh-client-ui-theme's
  embedded CSS — light on `body{…}`, dark on `body[data-ds-dark-theme]{…}`):
  41 of 44 variables the plugin uses are shell-verified; three phantoms fell
  back to hardcoded colors and are fixed —
  - `--dsw-alias-fill-l1` (does not exist) → `--dsw-alias-interactive-bg-hover`
    for tool-row hover, killing a light smear on dark backgrounds;
  - `--dsw-font-family-mono` (does not exist) → the shell's mono stack
    `--ds-font-family-code`, matching the plugin's own duration/diff chips;
  - bare `--dsw-font-markdown-code-block-small` (the shell ships per-property
    composites) → `…-font-size` / `…-line-height`, so `pre` finally gets the
    native 11px/16px code-block typography instead of `inherit`.
- `tests/theme.spec.ts` pins the audit: phantom tokens stay out, the mono
  stack comes from the shell, and every bare `var()` is a shell-verified
  dual-mode or invariant token.

### Dependencies

- `@deepseek-ai/cordis` dev-installed at 4.0.2 (peer range unchanged).
- `@types/node` ^22 → ^24 (matches the node 24 runtime; 22 predated it).
- TS 7 / vitest 5 majors noted, intentionally not chased in a maintenance
  round.

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
