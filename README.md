# dsh-plugin-bots

Multi-bot workbench for DeepSeek Harness (dsh): bridges the sdk-bots orchestration
gateway (single bots, group chats, transcripts, live SSE) into the dsh web shell.

Mounts:
- `sidebar.workspaces` shadow — two-group collapsible nav 「工作区｜Bots」.
- `shell.overlay` — chat surface.
- `settings.section` — gateway status / guide.

Requires an sdk-bots host (see `scripts/start-gateway.sh`). Architecture notes in
`DESIGN.md`.
