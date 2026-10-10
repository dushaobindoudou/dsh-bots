# Changelog

All notable changes to this project are documented in this file. The format
is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- **finance-skill never turns "not found" into a fact** (2026-10-10 report: a
  room of bots declared MiniMax unlisted and kept saying so after the user
  corrected them; it trades in Hong Kong as 00100). `data_bus.py search
  --name` resolves a company name / English name / pinyin to the codes the
  data source returns (Tencent smartbox; warrants and CBBCs hidden unless
  `--all`), and a miss says "未找到" with a hint that 查不到≠未上市 — no more
  guessing codes by scanning ranges. A quote without data points to
  `search` the same way.
- **Market cap is a returned, cross-checked field**: `quote` adds
  `market_cap` / `total_shares` (and the H-share pair for HK) only when the
  provider's total-cap figure agrees with price × total shares within 1%,
  otherwise null — and every A/HK quote notes that `amount` is the day's
  turnover, not market cap (the bots had reported 智谱's 31.45 亿 turnover as
  its "市值"; its total market cap is ≈ 3,128 亿 HKD).
- SKILL.md red lines and the runbook gain the matching rules: 查不到≠不存在,
  use only returned fields (other bots' conclusions are claims, not
  evidence), and re-verify with tools when the user corrects a fact.

## [0.2.69] - 2026-10-10

Requires `multibot-sdk` ^0.6.0 (one-time routines, per-bot models, skill
bundle install).

### Removed

- **Goals module**: a goal is simply what the user asks for in the
  conversation, so the host `goals` / `createGoal` / `goalAction` RPCs and
  `src/goals.ts` are gone (the client page was already removed). What members
  run shows in the chat bar's routines clock instead: an icon-only seat
  (native ScheduleCatalogAction shape) opening a 336px anchored popover of
  each member's routines — frequency, next run, last-run-failed warn tone —
  and the conversation never hides behind it.

### Security

- **Bot-written files are never executed**: `openFile` (`open <file>`, which
  runs `.command` / `.app` / `.terminal` output on one click) is replaced by
  `revealFile` (`open -R` / the parent directory) plus allowlisted
  `readText` (UTF-8 pages on character boundaries, NUL-sniffed binaries) and
  `readBytes` (images / PDF) for the in-app preview. Paths resolve the way
  bots write them: workspace-relative (`risk/x.md`, newest match across the
  box workspaces), the `/workspace/<slug>` virtual root, `~`, and CJK
  directories; the allowlist also covers each jailed bot's granted
  `workspaceAllowPaths`.
- **Skill sharing needs confirmation**: a bridged skill becomes instructions
  for every bot and group, so newly discovered skills stay *pending* until
  the user shares them on the settings card; bundled skills ship shared. The
  card shows each skill's source path and content sha256 and flags a shared
  skill whose SKILL.md changed since it was shared. v1 exclusion lists
  migrate as-is (verified against a real 29-skill bridge: nothing unshared),
  and v2 keeps the v1 `excluded` field as an exact mirror of every unshared
  skill, so an older host still running (or a downgrade) keeps the same set
  — without it, an old host read a v2 file as "nothing excluded" and shared
  every skill on its next sync.
  Non-ASCII skill directories get a stable path-derived id instead of an
  order-dependent `dsh-skill-N`.

### Added

- **定时任务 from the composer**: the + / `/` command menu gains 定时任务,
  opening a compact form where the menu sat — what to do (the draft carries
  over; cancelling hands it back), a date and time, and 仅一次 / 每天 / 工作日 /
  每周. A one-off writes the engine's one-time `@at YYYY-MM-DD HH:MM` routine
  (run once, then retired); repeats write the matching cron. A past one-off
  can't be created. In a group the routine belongs to the room, so it wakes
  the group. New host RPCs `routineCreate` / `routineDelete`.
- **Routines can be cancelled**: each row in the chat header's routines
  popover has a two-click 取消; one-time routines read 仅一次, and a group's
  own routines list before its members'.
- **Files open in a preview pane beside the chat**: a file mention in a bot
  message opens in a pane docked to the right of the conversation (the
  native right-sidebar preview's 38px header, dsh's Markdown / code / PDF /
  image renderers, paged reads, reveal in Finder), expandable to the whole
  workbench and covering the chat below 820px. The reader never leaves the
  bot conversation — the earlier route borrowed a dsh Session to reach the
  shell's own right sidebar, which switched the screen to that Session and
  read as a jump into an ordinary chat (user report). Bare paths in
  messages are wrapped as code spans so the native renderer chips them (it
  only resolves code spans). The modal remains only for a preview with no
  conversation open; switching conversations closes the pane.
- **Composer + and / commands**: the paperclip becomes the native InputBar
  `+` ("添加图片或使用技能"), opening the same command menu as typing `/` at
  the start of a word — add images first, then the bot's skills (a pick
  inserts the `sand-workflow:` handle); `@` keeps members and skills.
- **Group avatars show their members**: a group's avatar is a cluster of
  its first three members' own avatars (same blobs, each in its member's
  live state) instead of an initial on a coloured disc; it redraws on
  roster edits.
- **Earlier history on demand**: `transcriptTail` takes the engine's
  `beforeSeq` cursor and returns `nextBeforeSeq`; the chat pages older rows
  in at the top ("Load earlier messages", or by scrolling up) and keeps the
  reader's place.
- **Persistent drafts**: per-conversation drafts survive page reloads
  (localStorage, best effort).
- **Stale-host notice**: a fingerprint of the compiled host half is baked
  into both halves; when dsh web still runs the old host, the sidebar asks
  for a restart instead of letting new RPCs 404 (see Native parity for its
  shape). The bake fails loudly on duplicate or missing sentinels.
- **Group turns name who is replying** in the running row.
- Empty sidebar sections keep their `+` visible; row actions are reachable
  by keyboard focus.

### Changed

- **Trigger menu rows follow the current native item**: 34px rows at 13/20
  with 6px 8px padding (the 40px 14/22 rows read too tall), a 400px cap, and
  more room for names (55%).
- **Wider model menu**: sized to its content between 320 and 480px (it cut
  model ids at 360) and opening leftward from the composer chip so it stays
  on screen.
- **Settings speak product, not plumbing**: the overview drops the gateway
  address, PID, token, data directory, event buffer and the "multi-bot
  workbench bridged to the sdk-bots orchestration gateway" intro for a
  service status line and a capability list; every user-facing string loses
  sdk-bots / freeroute / launchd / engine / gateway wording (errors, offline
  card, model, skills, MCP, workspace copy), and so do the plugin meta and
  package descriptions.
- **Settings model picker = the composer's**: one trigger opening the same
  grouped, searchable ModelMenu (providers as headers, auto routing as the
  lead row) replaces the provider select feeding a model select. DeepSeek
  ids are listed once (no longer also under their aggregator).
- **Sidebar avatars 32 → 24px** with an 8px gap to the name: full-height
  avatars filled the 32px rows edge to edge.

### Fixed

- **重新连接 heals a lost discovery record instead of waiting out the clock**
  (root cause of the 2026-10-10 "Bots 服务未连接" outage): the engine was
  alive and healthy on its plist-pinned port, but a second host instance on
  the same data root (the engine's smoke test, whose `startHost()` forces
  `~/.sdk-bots`) ran `clearGatewayDiscovery` on shutdown — an unconditional
  `rm`, no pid guard — and wiped `~/.sdk-bots/gateway.json`, so file-only discovery
  reported 未连接 forever while the reconnect ladder had no rung for "job
  loaded but not answering". Discovery now falls back to a `/health` probe
  on the pinned port (`SAND_HOST_PORT` read from the engine plist),
  synthesizes the record and writes it back so every consumer heals
  (roster RPCs retry through the same fallback once, and the SSE stream's
  base resolver uses it); reconnect bounces a loaded-but-unreachable job
  with `kickstart -k` instead of leaving it to the 20 s health budget; and
  the offline card now shows the failure reason. Upstream, the engine's
  `clearGatewayDiscovery` should be pid-guarded — the plugin-side fallback
  contains the symptom either way.
- **群聊/单聊 hide while the engine is down**: the sidebar gated its two
  sections on `agentsLoaded`, which the `list` RPC sets even when it fails —
  an engine that never answered still showed both headers with their stale
  roster (rows that led into a dead chat). The sections now render only when
  `gatewayInfo` reports the engine online, so an unreachable engine collapses
  the body to the reconnect card; pinned in the browser test's offline case.
- **Opaque menus**: the model, command/mention, row and routines menus
  painted the translucent `--dsw-specific-menu` (f0 alpha) without the
  native MenuSurface's backdrop blur, so the transcript read through them;
  they now lay that tint over the opaque base.
- **Escape closes the model menu wherever focus sits**: with a short list
  (no search field) the keypress never reached it and its scrim swallowed
  every click until something else was clicked.
- The model search field no longer disappears once filtering leaves six or
  fewer rows; long settings hints wrap instead of being cut off.

### Native parity

Every surface this release adds or reshapes copies a shipped dsh component
(values read from the installed 0.2.0-rc.2 bundles, pinned in
tests/native-parity.spec.ts, and checked in an isolated real dsh web):

- **Routines entry** = dsh-client-ui-schedule `ScheduleCatalogAction`: an
  icon-only 28px clock in the chat header, rendered only when routines exist
  and named with their count, opening a portal popover (336px, 16px radius,
  anchored 5px below, 16px viewport margin, Escape returns focus, outside
  pointer closes) of 48px rows — 13/18 title, 10/15 tertiary frequency and
  "下次运行 {stamp} ({relative})" in the native wording. It replaces the
  "任务规划" text toggle and strip; single bots show their own routines too.
- **Header seats** are icon-only like the native session header (members
  now uses the people glyph).
- **Load earlier** = ChatView `.older` (centered row, small filled button,
  "加载更早").
- **Pending-restart status** = settings-general `DesktopUpdateIndicator`: a
  28px brand pill in `sidebar.footer.action` with the detail in a top
  Tooltip, hidden while the sidebar is a rail; replaces the in-list card.
- **Skill-sharing rows** = settings-models row identity + `rowTag`.

### Performance

- **Live transcript merge**: transcript events now carry display-shaped rows
  (`view`), merged in place; the tail is re-read only to reconcile (24 rows,
  single-flight, full window on a detected gap or engine snapshot) instead of
  80 rows per event.
- **Adaptive event drain**: the ring drain self-schedules (no overlapping
  drains) at 250 ms while events flow and 1 s when idle, so streaming text
  updates ~4x a second.
- **Avatar frame budget**: offscreen avatars skip frames
  (IntersectionObserver), resting ones animate at ~10 fps (~15 fps when
  large), busy ones keep ~30 fps, glyph-sized ones draw stills, and identical
  frames skip DOM writes. 30-bot sidebar, 5 s idle: main-thread task time
  817 ms → ~210 ms; with 3 bots running 566 ms → ~250 ms.

## [0.2.68] - 2026-10-08

### Changed

- **Live bloub avatars**: the fallback bot avatars no longer sit still. The
  merged bloub engine now runs inside the client (one shared ~30 fps rAF
  clock, self-stopping when the last avatar unregisters, parked by the
  browser when the tab hides): bots morph through their state's poses,
  blink and drift on their own, and gaze at the pointer via the engine's own
  look-mixing (yaw ±16°, pitch 10−13·ny°; pointer gone → pose gaze + drift
  restored). Honours `prefers-reduced-motion` with a settled still frame.
  Per-bot phase and ink/state are seeded from the bot id, so a full sidebar
  never blinks in unison.
- **Volume**: the measured flat pose gains two soft-light layers — a radial
  gloss on the body (highlight top-left → ink core → darker rim) plus a
  specular sheen and a top-lit tile background — clipped by the same eye-hole
  mask, so the silhouette and the punched eyes stay exactly the measured
  ones.
- **Architecture**: the 0.2.67 baked stills are gone; the engine itself is
  merged verbatim into `src/client.ts` by
  `scripts/merge-bloub-engine.mjs` (value-initialisation ordered, two
  private-name collisions renamed), because the client entry must stay one
  self-contained file. `tools/bloub` remains the vendored source of truth.

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
