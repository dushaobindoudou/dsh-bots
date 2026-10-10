<div align="center">

# dsh-bots

**A multi-bot workbench for DeepSeek Harness (dsh)** —
bridges the sdk-bots orchestration gateway into the dsh web
shell: single bots, group chats, transcripts and live events, styled like the official UI.

[![npm](https://img.shields.io/npm/v/dsh-bots?logo=npm&color=cb3837)](https://www.npmjs.com/package/dsh-bots)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Cordis](https://img.shields.io/badge/cordis-%5E4.0.1-blue)](./package.json)

English · [简体中文](./README.zh-CN.md)

</div>

---

**dsh-bots** is a formal Cordis plugin (Host +
Client halves) for the `dsh` web profile. It mounts a workbench into the sidebar where every bot of
your sdk-bots swarm is one click away — chat with single bots, run group productions with
@-mentions, watch transcripts stream in over SSE, and manage each bot's workspace sandbox without
leaving the shell.

## ✨ Features

**Workbench sidebar**

- Two-group collapsible nav 「工作区 ｜ Bots」 with the native sidebar interaction model (hover
  actions, chevron fold, accordion expansion, gateway status dot)
- 群聊 / 单聊 sections with hover- or focus-revealed `+` (create) and `⋯` (more actions) menus; an empty section keeps its `+` visible; with the engine unreachable both sections yield to the reconnect card
- Unread badges with a plugin-owned read model (SSE + transcript rebase), composing indicators

**Conversations**

- Chat renders in dsh's native main panel; dialogs use the overlay
- Full chat surface: day dividers, stick-to-bottom with jump-to-latest, IME-safe composer,
  same-author run compaction
- History on demand: the first read is the newest page; reaching the top (or "Load earlier messages") pages back through the engine cursor
- Live updates merge straight from the event stream (~4 refreshes a second while generating) instead of re-reading the transcript per event
- Per-conversation drafts persist in this browser across chat switches and reloads
- Group chat turn-taking: @-mention directed replies, one-hop delegation, `@全员` broadcast —
  powered by the engine's responder election; the running row names the members replying now
- Markdown rendering, tool-call cards with status dots, thinking blocks
- **Stop generating**: composer send button morphs into a stop square wired to the gateway's
  `interruptAgent`
- Local files: inline image previews; file paths in messages render as native file chips that open in a **preview pane docked beside the conversation** (Markdown / code / PDF / image renderers from dsh, expandable to the full workbench, covering the chat in narrow windows) — the chat never leaves the screen. **A bot-written file is never executed**; workspace-relative, `/workspace/<name>` and CJK paths resolve
- State-aware avatars (a group shows its members' own avatars) and an engine-based execution timer that survives navigation and page reloads
- Composer **+** / `/` command menu: add images or call a skill, like the native composer's commands

**Shared skills**

- Share DSH, Agents, Codex and bundled skills across bots and groups; invoke them from the `@` menu
- **Sharing is confirmed**: a shared skill becomes instructions for every bot, so newly found skills wait as "New" until checked in settings; bundled skills ship shared; each row shows its source path and content hash, and edits after sharing are flagged
- Install complete local or GitHub skill bundles in settings, or let bots install them with `update_state`
- Bundled finance skill retrieves market data with explicit sources, timestamps and error handling
- See [shared skills and session continuity](./docs/session-continuity-and-shared-skills.md) for the companion engine update

**Goals are conversations**

- There is no separate goals module: say what you want done in the chat and the bots set up routines themselves
- Chats with routines show an icon-only clock in the chat bar; it opens a popover listing each member's routine with its next run and last-run failures (read-only — bots manage the routines in conversation)

**Management**

- **Session settings** (gear in the chat bar): rename, description, and the workspace jail editor
- **Manage members** for groups (checkbox roster editor, 8 default / 16 engine hard cap)
- Create bots and groups from the section headers; delete with confirm dialogs
- Settings page section: gateway health, data dir, SSE state, workspace list, MCP servers & tools

**Under the hood**

- Host half: a `TypertRemoteService` bridging gateway RPC endpoints + SSE proxy, plus allowlisted paged reads for the file preview
- Stale-host notice: the host build fingerprint is baked into both halves; when dsh web still runs the old host, a brand-blue status pill in the sidebar footer (the shell's own update-indicator shape) asks for a restart
- Client half: plain-JS React via Cordis Slots (no build step), zh/en i18n
- Workspace jail (macOS Seatbelt) editing per bot: root dir + extra writable paths

## 📦 Install

Requirements:

- `dsh` with a web profile (Cordis `^4.0.1` — what the plugin is tested against)
- An sdk-bots host running its gateway (default discovery:
  `~/.dsh-bots/gateway.json`, falling back to the legacy `~/.sdk-bots/gateway.json`)
- Engine `multibot-sdk` **≥ 0.6.0** — the wire this plugin speaks (`attachmentPaths`
  image channel, `user-attachment` transcript entries, `beforeSeq` transcript paging,
  per-bot `modelId`, skill bundle install, one-time `@at` routines) landed by
  then; declared as an optional peer (`^0.6.0`) since the engine runs as its own
  process and must not be bundled into the plugin

```bash
# from npm
dsh plugin --profile web add dsh-bots

# or from a packed tarball
pnpm pack
dsh plugin --profile web add ./dsh-bots-*.tgz
```

Then restart `dsh web` and refresh the page. The workbench appears as the second group in the
sidebar; the settings page gains a **Bots** section.

> ⚠️ **Half-loading trap**: the plugin's Client half is served fresh on every page load, but the
> Host half only loads at `dsh web` boot. After upgrading, refresh for UI changes — restart
> `dsh web` when host RPCs change (otherwise the new UI hits a stale host and new endpoints 404).
> Restart `dsh web` after upgrading dsh itself as well: an old process can load newer client
> packages and report `Failed to load plugins` with missing services such as `shortcuts`.

## ⚙️ Configuration

The plugin reads a single option (via `cordis.patch.yml`):

| Option | Default | Description |
|---|---|---|
| `dataDir` | `~/.dsh-bots` | Directory holding `gateway.json` and plugin-owned state. Discovery falls back to the legacy `~/.sdk-bots` root until the engine migrates; unread ledger, workspace ops and the media allowlist follow the gateway's actual location. |

```yaml
# cordis.patch.yml (shipped in the package; applied when the plugin is
# added to a profile — change dataDir here if your gateway lives elsewhere)
- insert:
    - id: bots
      name: dsh-bots
      config:
        dataDir: '~/.dsh-bots'
```

## 🚀 Usage

| Task | How |
|---|---|
| Open a conversation | Click a bot in 单聊 or a group in 群聊 |
| State a goal | Say what you want done in the chat (e.g. "post the daily report here every morning") |
| See what group members run | Chat bar → ⏱ clock popover (icon-only; only when routines exist) |
| Preview a bot-written document | Click the file chip in the message (opens beside the chat; × or Esc closes it) |
| Share a newly found skill | Settings → Bots → Skills → check the "New" skill → Save sharing |
| Direct a group reply | Type `@` and pick a member; `@全员` wakes everyone |
| Stop a generation | Click the ⏹ square (replaces ▲ send while composing) |
| Rename / jail a bot | Gear button (top-right of the chat bar) |
| Add/remove group members | 管理成员 button (top-right, group chats) |
| Create / refresh | Hover a section header → `+` / `⋯` |
| Fold a section | Click the section header row |
| Gateway health & MCP | Settings page → Bots section |

**Workspace jail** (singles only): set a workspace root to confine a bot's shell writes via macOS
Seatbelt (reads stay unrestricted, same-slug bots share a directory, takes effect next turn).
Empty root = jail disabled. Extra writable paths accept a comma-separated list.

**Group member cap**: the engine hard-caps groups at **6 members** and silently truncates larger
rosters — the member editor surfaces the cap instead of letting a save pretend to work.

## 🏗️ Architecture

```
┌────────────────────────── dsh web ──────────────────────────┐
│  shell ── Slots: sidebar.workspaces (shadow)                │
│               main (bot chat)                                │
│               shell.overlay (dialogs)                       │
│               settings.section (Bots card)                  │
│                      │ botsCall RPC (lossless JSON)         │
│  ┌─────────────────── Host half ───────────────────────┐    │
│  │  TypertRemoteService · RPC bridge + file preview     │    │
│  │  SSE proxy (3k-entry ring buffer) · unread model    │    │
│  └──────────────────────┬────────────────────────────┘    │
└─────────────────────────┼──────────────────────────────────┘
                          │ HTTP + SSE (loopback token auth)
              ┌───────────▼───────────┐
              │  sdk-bots gateway :7331 │  ← single bots · sand groups · MCP
              └────────────────────────┘
```

- **Host** (`src/index.ts`, `src/gateway.ts`, `src/sse.ts`, …): gateway discovery + calls
  (gateway.json first; a lost record falls back to a `/health` probe on the plist-pinned port and
  self-heals, and reconnect `kickstart -k`s a loaded-but-unreachable job), SSE
  ring with reconnect + transcript rebase (transcript events carry display-shaped rows), unread
  ledger, file preview `readImage`/`readText`/`readBytes`/`revealFile` behind a fail-closed realpath
  allowlist (never handed to the OS opener), diagnostics file. `src/skill-bridge.ts` owns skill
  sharing decisions and content hashes.
- **Client** (`src/client.ts`): the whole UI in one factory — sidebar nav, chat surface, six
  modals, settings cards — registered through Cordis Slots with zh/en dictionaries.

## 🧪 Development

```bash
pnpm install
pnpm build             # tsc host + client
pnpm test              # vitest
pnpm test:integration  # checks host RPC endpoints
pnpm test:browser      # isolated browser regression; requires local Chrome
pnpm test:dsh-smoke    # plugin loads inside a real dsh profile
```

Release loop: build → test → integration → bump → pack → `dsh plugin --profile web add` →
verify → commit → push → `npm publish --access public`.

Project docs: [DESIGN.md](./DESIGN.md) (architecture decisions) ·
[DEVELOPMENT.md](./DEVELOPMENT.md) (engineering log & pitfalls).

## 📄 License

[MIT](./LICENSE)
