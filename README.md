<div align="center">

# dsh-bots

**A multi-bot workbench for DeepSeek Harness (dsh)** —
bridges the sdk-bots orchestration gateway into the dsh web
shell: single bots, group chats, transcripts and live events, styled like the official UI.

[![npm](https://img.shields.io/npm/v/dsh-bots?logo=npm&color=cb3837)](https://www.npmjs.com/package/dsh-bots)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Cordis](https://img.shields.io/badge/cordis-%5E4.0.1-blue)](./package.json)
[![Tests](https://img.shields.io/badge/tests-83%20passed-brightgreen)](./scripts)

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
- 群聊 / 单聊 sections with hover-revealed `+` (create) and `⋯` (more actions) menus
- Unread badges with a plugin-owned read model (SSE + transcript rebase), composing indicators

**Conversations**

- Full chat surface: day dividers, stick-to-bottom with jump-to-latest, IME-safe composer,
  same-author run compaction
- Group chat turn-taking: @-mention directed replies, one-hop delegation, `@全员` broadcast —
  powered by the engine's responder election
- Markdown rendering, tool-call cards with status dots, thinking blocks
- **Stop generating**: composer send button morphs into a stop square wired to the gateway's
  `interruptAgent`
- Local media: inline image previews and one-click file chips for paths mentioned by bots

**Management**

- **Session settings** (gear in the chat bar): rename, description, and the workspace jail editor
- **Manage members** for groups (checkbox roster editor, honest 6-member cap feedback)
- Create bots and groups from the section headers; delete with confirm dialogs
- Settings page section: gateway health, data dir, SSE state, workspace list, MCP servers & tools

**Under the hood**

- Host half: a `TypertRemoteService` bridging 27 gateway RPC endpoints + SSE proxy
- Client half: plain-JS React via Cordis Slots (no build step), zh/en i18n
- Workspace jail (macOS Seatbelt) editing per bot: root dir + extra writable paths

## 📦 Install

Requirements:

- `dsh` with a web profile (Cordis `^4.0.1` — what the plugin is tested against)
- An sdk-bots host running its gateway (default discovery:
  `~/.dsh-bots/gateway.json`, falling back to the legacy `~/.sdk-bots/gateway.json`)
- Engine `multibot-sdk` **≥ 0.5.0** — the wire this plugin speaks (`attachmentPaths`
  image channel, `user-attachment` transcript entries, the goal-guard ledger) landed
  there; declared as an optional peer (`^0.5.0`) since the engine runs as its own
  process and must not be bundled into the plugin

```bash
# from npm
dsh plugin --profile web add dsh-bots

# or from a packed tarball
pnpm pack
dsh plugin --profile web add ./dsh-bots-0.2.22.tgz
```

Then restart `dsh web` and refresh the page. The workbench appears as the second group in the
sidebar; the settings page gains a **Bots** section.

> ⚠️ **Half-loading trap**: the plugin's Client half is served fresh on every page load, but the
> Host half only loads at `dsh web` boot. After upgrading, refresh for UI changes — restart
> `dsh web` when host RPCs change (otherwise the new UI hits a stale host and new endpoints 404).

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
│               shell.overlay (chat + modals)                 │
│               settings.section (Bots card)                  │
│                      │ botsCall RPC (lossless JSON)         │
│  ┌─────────────────── Host half ───────────────────────┐    │
│  │  TypertRemoteService · 27 endpoints                 │    │
│  │  SSE proxy (3k-entry ring buffer) · unread model    │    │
│  └──────────────────────┬────────────────────────────┘    │
└─────────────────────────┼──────────────────────────────────┘
                          │ HTTP + SSE (loopback token auth)
              ┌───────────▼───────────┐
              │  sdk-bots gateway :7331 │  ← single bots · sand groups · MCP
              └────────────────────────┘
```

- **Host** (`src/index.ts`, `src/gateway.ts`, `src/sse.ts`, …): gateway discovery + calls, SSE
  ring with reconnect + transcript rebase, unread ledger, media `readImage`/`openFile` with a
  fail-closed realpath allowlist, diagnostics file.
- **Client** (`src/client.ts`): the whole UI in one factory — sidebar nav, chat surface, six
  modals, settings cards — registered through Cordis Slots with zh/en dictionaries.

## 🧪 Development

```bash
pnpm install
pnpm build             # tsc host + client
pnpm test              # vitest (83 tests)
pnpm test:integration  # boots a fixture host, checks all 27 endpoints
pnpm test:dsh-smoke    # plugin loads inside a real dsh profile
```

Release loop: build → test → integration → bump → pack → `dsh plugin --profile web add` →
verify → commit → push → `npm publish --access public`.

Project docs: [DESIGN.md](./DESIGN.md) (architecture decisions) ·
[DEVELOPMENT.md](./DEVELOPMENT.md) (engineering log & pitfalls).

## 📄 License

[MIT](./LICENSE)
