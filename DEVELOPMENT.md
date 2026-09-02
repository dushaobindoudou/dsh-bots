# sdk-bots × dsh 融合开发文档

> 目标：基于 `multibot-sdk` 打造 Web 端 Grok Bots 级多 Bot 产品。
> 推理封装与 Web 壳复用 dsh，编排与沙盒由 sdk-bots 承担。
> 文中所有「已验证」结论均有代码锚点或实测日志支撑（2026-08-27）。
>
> **仓库与路径约定**：
> - `~/workspaces/sdk-bots` — agent 编排引擎（npm 包 `multibot-sdk`）。文中 `src/...`、`examples/...`、`scripts/...` 均相对此仓库。
> - `~/workspaces/dsh-bots` — 本文档所在仓库，dsh Bots 插件（Web UI）将在此开发。
> - `~/.dsh` — dsh 运行时数据（`freeroute.json`、`credentials` 等）。

---

## 目录

1. [项目定位](#1-项目定位)
2. [总体架构](#2-总体架构)
3. [职责划分](#3-职责划分)
4. [已验证事实与代码锚点](#4-已验证事实与代码锚点)
5. [推理链路：sdk-bots → dsh freeroute](#5-推理链路sdk-bots--dsh-freeroute)
6. [Web UI：dsh Bots 插件开发规范](#6-web-ui-dsh-bots-插件开发规范)
7. [网关 API 参考](#7-网关-api-参考)
8. [SSE 事件流参考](#8-sse-事件流参考)
9. [环境变量与端口](#9-环境变量与端口)
10. [开发路线图](#10-开发路线图)
11. [调试与验证手册](#11-调试与验证手册)
12. [已知坑与注意事项](#12-已知坑与注意事项)
13. [MCP 接入与实现方案（快速路径）](#13-mcp-接入与实现方案快速路径)
14. [Per-agent 工作区隔离（workspace jail）](#14-per-agent-工作区隔离workspace-jail)

---

## 1. 项目定位

对标 Grok Bots（xAI）的 Web 端多 Bot 产品能力：

| 需求 | 落地方式 | 状态 |
|---|---|---|
| 本地沙盒 | sdk-bots `box exec-daemon`（目录隔离沙盒进程） | ✅ 已有 |
| 第三方 agent / 工具 | OpenRouter/Claude Code/Codex 适配器 + MCP 路由工具 | ✅ 已有 |
| 自有大模型 | 推理统一走 dsh freeroute（`auto` 智能路由 + 免费池轮换） | ✅ 已验证 |
| Grok Bots 级体验 | dsh Web GUI 里的 Bots 折叠侧栏插件 | 🔨 开发中 |

**核心决策**（已经过架构讨论钉死，勿反复）：

- **sdk-bots 是 agent 编排引擎**：turn loop、群聊 `@提及`、Bot 注册表、沙盒、工具、HTTP 网关 + SSE。
- **dsh 是模型网关 + Web 壳**：`llm` 服务 + freeroute（`auto`）承担全部模型封装；dsh Web GUI 承担 UI 宿主。
- **sdk-bots 对模型世界无感知**：只认一个 OpenAI-compatible endpoint（dsh freeroute），默认即此，零配置。
- **UI 不混入 dsh 原生对话流**：独立可折叠 Bots 区域，与工作区平级，经 `shell.overlay` 浮层实现。

---

## 2. 总体架构

```
┌─ 浏览器 ──────────────────────────────────────────────────┐
│  dsh Web GUI (:3080)                                      │
│   ├─ 原生会话 UI（不动）                                    │
│   └─ Bots 折叠侧栏插件（开发中）                            │
│        sidebar.footer.action「Bots」按钮 ⇄ shell.overlay   │
└──────────────┬────────────────────────────────────────────┘
               │ cordis RPC (host.call)  + EventSource 直连网关 SSE
┌──────────────▼────────────────────────────────────────────┐
│ sdk-bots 进程（multibot-host / startHost()）               │
│  ── agent 编排引擎 ──                                      │
│   · turn loop（Vercel AI SDK streamText + tools）          │
│   · 群聊 @提及路由（@name 单人 / @所有人 全员）              │
│   · Bot/Group 注册表 · box exec-daemon 沙盒 (:1337)        │
│   · 工具面：SendMessage / SendToAgent / Shell / Read /     │
│     Write / Grep / MCP 路由工具                            │
│   · HTTP 网关（动态端口，gateway.json 发现）+ SSE /events   │
└──────────────┬────────────────────────────────────────────┘
               │ POST /freeroute/v1/chat/completions
               │ model=auto（默认，零配置）
┌──────────────▼────────────────────────────────────────────┐
│ dsh 进程 ── 模型网关 ──                                    │
│   freeroute plugin → llm 服务（adapter 注册表）             │
│   auto 智能路由 · 免费池轮换 · 失败冷却接管 · 密钥管理       │
│   ↓ 10 上游：orcarouter/b-ai/sensenova/nvidia/openrouter/  │
│     zenmux/opencode/gmi/aihubmix/askdiandian              │
└───────────────────────────────────────────────────────────┘
```

一句话：**对 sdk-bots 而言，dsh 是自家私有 OpenRouter（但带 auto 与免费池）；对用户而言，dsh 是 Web 壳 + 模型配置中心。**

---

## 3. 职责划分

| 关注点 | 归属 | 说明 |
|---|---|---|
| 模型目录 / 密钥 / 路由 / 冷却轮换 | **dsh** | `~/.dsh/freeroute.json` + dsh 设置页「模型」 |
| turn loop / 工具循环 | **sdk-bots** | `src/host/extensions/inference/` |
| 群聊 @提及 / Bot·Group 管理 | **sdk-bots** | `src/host/groups/` |
| 沙盒 | **sdk-bots** | `box exec-daemon`，目录隔离到 `<dataDir>/box-workspace` |
| 会话历史（transcript） | **sdk-bots** | 网关 API：`getAgentTranscript*` |
| Web UI | **dsh 插件** | 本仓库不写前端；插件规范见 §6 |
| 进程生命周期 | 各自 | 两个独立进程，互不依赖启动顺序（网关发现见 §7.1） |

**Codex / Claude 的角色**：freeroute 提供的是**模型级**接入（任何 dsh 认识的模型）；sdk-bots 内的 `codex`（Codex Responses API）/ `claude-code`（Claude Agent SDK）provider 是 **agent 运行时级**直连模式，保留为可选，默认不走。

---

## 4. 已验证事实与代码锚点

### 4.1 推理默认指向 dsh freeroute（零配置）

`src/host/extensions/inference/provider-session.ts`：

```ts
export const OPENROUTER_DEFAULT_BASE_URL = "http://127.0.0.1:3080/freeroute/v1";  // :47
const baseURL = env.SAND_OPENROUTER_BASE_URL?.trim() || OPENROUTER_DEFAULT_BASE_URL; // :54
const modelId = env.SAND_OPENROUTER_MODEL?.trim()
  || (isOfficial ? "deepseek/deepseek-chat" : "auto");                                // :56 本地默认 auto
const apiKey = envKey
  || (isOfficial ? secrets.OPENROUTER_API_KEY : undefined)
  || (isOfficial ? undefined : "local");                                              // :60 占位 key
```

`src/bootstrap/index.ts:31`：`process.env.SAND_OPENROUTER_BASE_URL ??= "http://127.0.0.1:3080/freeroute/v1";`

### 4.2 freeroute 活体探测

```
GET http://127.0.0.1:3080/freeroute/v1/models → 200
首项 {"id":"auto"}，其后为 10 上游模型池
~/.dsh/freeroute.json：order + upstreams + autoTakeover:true
```

### 4.3 端到端实测（2026-08-27，`examples/verify-freeroute-auto.mjs`）

隔离数据目录起 host → 创建 bot → 发「Shell echo + SendMessage 汇报」prompt：

```
baseURL: http://127.0.0.1:3080/freeroute/v1   modelId: auto   apiKey: loca…
[sdk-bots] local chat finish=tool_calls tools=Shell        ← 工具调用过 freeroute ✅
[sdk-bots] local chat finish=tool_calls tools=SendMessage
回复: freeroute-e2e-ok                                        ← 回环闭合 ✅
SSE: {"transcript":3,"client-side-tool-v2":3,"agent-upserted":5,...}
freeroute.log: 上游 orcarouter 模型 orcarouter/free 失败(RATE_LIMIT)，切换到 openrouter
               ↑ auto 接管真实触发 ✅
```

结论：**工具调用、流式、auto 轮换、SSE 全链路无缺口。**

---

## 5. 推理链路：sdk-bots → dsh freeroute

### 5.1 数据流

```
turn loop（每步）
  → streamText({ model: openai(baseURL, apiKey), tools: [SendMessage, Shell, ...] })
  → POST http://127.0.0.1:3080/freeroute/v1/chat/completions  (model: "auto")
  → freeroute auto 选择上游（失败冷却/轮换）
  → 上游返回（含 tool_calls）
  → sdk-bots 执行工具（沙盒内）→ 结果回填 → 下一步
```

### 5.2 模型选择

| 场景 | 做法 |
|---|---|
| 默认（推荐） | 不设 `SAND_OPENROUTER_MODEL` → `auto`，由 freeroute 智能路由 |
| 钉定某模型 | `SAND_OPENROUTER_MODEL=<freeroute 模型 id>`，如 `deepseek-v4-flash`（查 `/freeroute/v1/models`） |
| 官方 OpenRouter 云 | `SAND_OPENROUTER_BASE_URL=https://openrouter.ai/api/v1` + `OPENROUTER_API_KEY` |

**开放项（per-bot 模型钉定）**：`inferenceProvider` 目前是 host 级（`setHostSettings`）。若要 bot A 用 `auto`、bot B 钉 `kimi-k3`，需要在 SDK 侧给 agent 加 model 字段（改 `host-gateway-api.ts` 的 `updateAgent` 通道 + turn 组装处读取）。M5 再做。

### 5.3 免费上游池现状

见 `~/.dsh/freeroute.json` 各上游 `note` 字段（实测记录：哪些模型在线、限流特性、配额行为）。上游增删只在 dsh 侧配置，sdk-bots 无需改动。

---

## 6. Web UI：dsh Bots 插件开发规范

### 6.1 形态

dsh 侧的 Cordis 插件，Host + Client 两半。**开发期用动态插件快速迭代（dsh 会话里 `cordis_define` / `cordis_run`），稳定后落成正式插件包**（参照 dsh-freeroute 的先例与 dsh-plugin monorepo 结构）。

### 6.2 Client 半边（UI）

| Slot | kind | 用途 |
|---|---|---|
| `sidebar.footer.action` | list（`id`/`order`/`label`） | 「Bots」入口按钮，侧栏底部 |
| `shell.overlay` | list（`id`/`order`/`label`） | 可折叠 Bots 面板浮层（左侧贴边、可拖拽/开关） |

约束（实测契约）：

- Client 只有 `ctx` / `React`（必须 `React.createElement`，无 JSX；hook 仅 `createElement/useState/useEffect`）/ `host`（RPC）/ `styles` / `console` 五个内置，另可 `ctx.get('timer')`（需 `inject:['timer']`）。
- **Client 没有任何网络能力**（2026-08-27 实测沙箱源码）：`fetch` 是教学陷阱（"network belongs to the HOST half"），`EventSource` 不在内置面。所有 HTTP/SSE 一律经 `host.call` → Host 半边。
- 注册走 `ctx.get('slots')` + `slots.inject(slotName, () => slots.register(...))`，返回 disposer 交给 `ctx.effect()`。
- 样式用 `styles.insert(css)`，颜色优先主题 CSS 变量（实测可用 token 族：`--dsw-alias-bg-base/-bg-overlay/-border-l/-label-primary/-label-secondary/-label-tertiary/-brand-primary/-button-primary-fill` 等，均带 fallback）。
- 不碰 `window`/`document`/原生 timer；需要 timer 用 `ctx.get('timer')`。
- ~~SSE 不走 Host 中转：Client 直接 new EventSource~~ **已证伪**：见 §8 修正。

### 6.3 Host 半边（网关桥）

职责：

1. **网关发现**：读 `<SAND_DATA_ROOT>/gateway.json`，**pid 活性校验用 `/health` 回传的 pid 与文件 pid 比对**（`src/sdk/entry.ts` 的 `waitForDiscovery` 要求 `pid === process.pid`，只适用于同进程 boot，插件是外部进程不能复用）。解析 `{port, pid, host?, scheme?, token?}`。
   - **鉴权兼容（实测 `gateway-config.ts:49`）**：loopback 绑定下默认 `requireAuth=false`，本地无 token 也能通；显式设 `SAND_GATEWAY_TOKEN` 或非 loopback 绑定时才需要 Bearer。**gateway.json 通常不含 token**（schema 允许 `.token` 字段但默认不写）。插件策略：token 有则带（header + SSE `?token=`），收到 401 给 UI 明确提示。
2. **HTTP 通道（实测沙箱约束）**：动态插件 Host 半边 `fetch` 是陷阱全局、`require` 不可用——**不能 import `SdkBotsClient`**（那是 M4 正式插件包的事）。M1 用 `ctx.shell`（`inject:['shell']`）跑 curl：`curl -sS -m N -w '\n__HTTP__%{http_code}' -X POST -H 'content-type: application/json' [--data-binary @-] url`，JSON body 经 ShellExecRequest 的 `stdin` 字段传入（无引号转义问题），状态码从 `-w` 尾行提取。`gateway.json` 读取用 `ctx.fs`（`inject:['fs']`，`resolve()` → `readText()`）。

3. **RPC 面**（`harness.handle(method, handler)`，Client `host.call`）：

| method | 入参 | 出参 | 对应网关 API |
|---|---|---|---|
| `gateway.info` | – | `{baseUrl, token}` | gateway.json |
| `bots.list` | – | `{agents: [...]}` | `POST /api/listAgents` |
| `bots.create` | `{name, description?}` | `{agent}` | `POST /api/createAgent`（带 `clientNonce` 幂等） |
| `bots.createGroup` | `{name, memberIds[]}` | `{agent}` | `POST /api/createGroup`（wire 字段 `memberAgentIds`） |
| `bots.update` | `{id, ...}` | `{agent}` | `POST /api/updateAgent` |
| `bots.delete` | `{id}` | – | `POST /api/deleteAgent` |
| `bots.send` | `{agentId, prompt}` | `{accepted}` | `POST /api/sendPrompt` |
| `bots.transcriptTail` | `{id}` | `{entries[]}` | `POST /api/getAgentTranscriptTail` |

   注意：`updateAgent` 的 wire 形状是 `{id, profile: {...}}`（见 `src/sdk/index.ts` 的封装），不是平铺 patch。HTTP 细节：`POST /api/<method>`，`authorization: Bearer <token>`（可选），body JSON；返回 `{result}` 或 `{error}`。

### 6.4 Client 渲染要点

- **消息流**：订阅 SSE `transcript` 频道，`payload.entry.kind === "send-message"` 为 bot 回复气泡；`kind === "message"` 且 `role === "user"` 为用户消息。
- **工具卡片**：用 `client-side-tool-v2` 事件（实测 transcript tail 里不含工具条目，工具可视化数据源在此频道）。
- **@提及**：群聊输入框 `@` 触发成员菜单；语义见 §7.3。候选 = 当前群成员 + 「所有人」。
- **工具授权等待**：host 已设 `localToolPermission: "always"` 则无 UI 阻塞；否则要处理 `resolveLocalToolPermission` 交互（M1 先设 always 规避）。
- **延迟预期**：免费模型单条 10–30s，auto 接管时更久；UI 必须有进行中状态，勿做同步等待。

### 6.5 开发循环（dsh 会话内）

```
cordis_inspect_list / cordis_inspect_query   ← 查 Slot/服务契约（勿凭记忆写）
cordis_define (code.host + code.client)      ← 定义/迭代 Package
cordis_run                                   ← 激活（Client 包需用户在 UI 批准）
cordis_inspect_self(pluginId, packageId)     ← 失败诊断（源码+stack）
```

Client 包首次运行会弹批准；单勾授权当前包，双勾授权后续版本。失败后同 Plugin 追加新 Package 重试，勿重建 Plugin。

---

## 7. 网关 API 参考

协议：`POST /api/<method>`，JSON body，Bearer token。全量命令表在 `src/host/gateway-protocol.ts`（126 个）。核心子集：

### 7.1 发现与健康

- `GET /health` → 健康信息
- 发现文件：`<dataDir>/gateway.json`（含 port/token/pid；pid 失效视为陈旧忽略）
- 控制台：`GET /`（内置单页 console，可作 API 行为参考实现）

### 7.2 核心 CRUD / 消息

| 方法 | 参数 | 备注 |
|---|---|---|
| `listAgents` | – | 返回数组或 `{agents}`（SDK 端 `normalizeAgentList` 兼容两种） |
| `createAgent` | `{name, description?, title?, clientNonce?}` | `clientNonce` 做幂等去重（重试安全） |
| `createGroup` | `{name, description?, memberAgentIds[]}` | wire 字段名是 `memberAgentIds`（SDK 侧叫 `memberIds`） |
| `setGroupMembers` | `{id, memberAgentIds[]}` | |
| `updateAgent` | `{id, ...patch}` | Bot 资料编辑 |
| `deleteAgent` / `deleteAgents` | `{id}` / `{ids[]}` | |
| `sendPrompt` | `{agentId, prompt}` | 返回含 `accepted`（sendAcceptanceV1）；群聊地址 = 群的 agentId |
| `getAgentTranscript` / `...Page` / `...Window` / `...Tail` | `{id, ...分页}` | `Tail` 适合 UI 增量拉取 |
| `getConversationOutline` | `{id}` | 会话大纲（工具调用摘要视图） |
| `getHostSettings` / `setHostSettings` | – / `{...}` | 含 `inferenceProvider`、`localToolPermission` |
| `searchAgents` | `{...}` | |
| `uploadAttachment` / `readAttachment*` | | 附件上传/读取（M5 知识库用） |
| `listMcpServers` / `addMcpServer` / `removeMcpServer` / `refreshMcp` | MCP 服务器管理（`addMcpServer {name, configJson}` 支持本地 stdio 与远程 URL） |
| `listRoutedMcpTools` / `executeRoutedMcpTool {agentId,…}` / `listBoxMcpServers` | MCP 工具清单 / 定向执行 / 沙盒侧状态——全表与快速接入方案见 §13 |
| `createAgentAutomation` / `createAgentWorkflow` 系列 | | 定时/工作流（M5） |

### 7.3 群聊语义（实测自 `gateway-console.html`）

- `@<成员名>` 定向；`@所有人` / `@全员` / `@大家` / `@everyone` / `@all` 全员。
- 名称匹配：忽略大小写与名称内空白；`＠`（全角）等同 `@`。
- 未点名时默认全员。

### 7.4 限制

- 单请求体上限 256 MB（base64 放大后）。
- 网关默认绑定 `127.0.0.1`（`SAND_GATEWAY_BIND_HOST` 可改，但保持 loopback 是安全前提）。

---

## 8. SSE 事件流参考

> **2026-08-27 修正**：原方案「Client 直接 `new EventSource` 直连网关」**不可行**——dsh 动态插件 Client 闭包遮蔽 `fetch`，`EventSource` 不在内置面，浏览器端零网络能力。
> **M2 实时方案改为**：Host 半边消费事件 + Client 经 RPC 拉取。两条实现路径：
> a) Host 用 `ctx.shell.start` 常驻 `curl -sN --compressed .../events` 后台进程，增量 `readOutput()` 解析入环形缓冲，Client 轮询 `bots.eventsSince(seq)`（准实时，推荐）；
> b) Host 定时器轮询 `getAgentTranscriptTail` + `listAgents` 缓存，Client 拉 Host 缓存（实现最简，M1 已用 3s 轮询打底）。
> 下表频道语义不变，只是消费方从浏览器换成 Host。

- 端点：`GET /events`；Host 侧 curl 消费可带 `authorization` header（`?token=` 查询参数是给无法带 header 的浏览器端用的，现仅作兼容保留）。
- 心跳：15s `:ping`；断线重连提示 `retry: 1000`。
- 压缩：默认 gzip（`Accept-Encoding` 协商）；curl 消费记得 `--compressed`；禁用 `SAND_DISABLE_GATEWAY_SSE_GZIP=1`。
- 可传订阅子集参数裁剪频道（`parseSubscribedChannels`）。

实测频道与用途：

| channel | 用途 | UI 消费建议 |
|---|---|---|
| `transcript` | `{type:"appended", entry, agentId}` | 消息流主数据源 |
| `client-side-tool-v2` | 工具调用投影事件 | 工具卡片渲染（transcript tail 无工具条目） |
| `agents` / `agent-upserted` | 列表快照 / 单个 upsert | 侧栏 bot 列表 |
| `host-settings` | 设置变更 | 模型/provider 状态展示 |
| `outline` | 会话大纲 | 可折叠步骤视图 |
| `automations` / `workflows` / `subagents` / `async-tasks` / `memory` | 各扩展订阅转发 | M5 |
| `box-disk-pressure` / `forever-box` | 沙盒状态 | 状态角标 |

`agents` / `agent-upserted` 的 payload 已做内联 avatar 剥离（`stripInlineAvatarsFromEvent`），头像走 `/avatars/<id>` 独立 GET（img 标签同样支持 `?token=`）。

---

## 9. 环境变量与端口

| 变量 | 默认 | 说明 |
|---|---|---|
| `SAND_DATA_ROOT` | `~/.sdk-bots` | host 数据根（gateway.json 在此） |
| `SAND_HOST_PORT` | 动态 | 固定网关端口（生产建议固定，插件发现更稳） |
| `SAND_GATEWAY_TOKEN` | 随机 | 网关 token |
| `SAND_GATEWAY_BIND_HOST` | `127.0.0.1` | 保持 loopback |
| `SAND_OPENROUTER_BASE_URL` | `http://127.0.0.1:3080/freeroute/v1` | **不要改**，这就是 dsh |
| `SAND_OPENROUTER_MODEL` | `auto` | 留空即 auto |
| `OPENROUTER_API_KEY` | – | 仅官方云需要；本地 freeroute 用占位 `local` |
| `SAND_AGENT_MOCK_RESPONSE` | – | 零凭证 mock（脚本化回复/工具调用） |
| `SAND_BOX_EXEC_DAEMON_ENTRY` | dist 内置 | 沙盒进程 bundle 路径 |
| `SAND_USE_EXISTING_BOX_EXEC_DAEMON` | – | `1` = 复用已运行的 daemon |

端口占用：dsh `3080`（GUI + freeroute）、box exec-daemon `1337`、sdk-bots 网关动态（或 `SAND_HOST_PORT`）。

---

## 10. 开发路线图

| 里程碑 | 内容 | 验收 |
|---|---|---|
| **M0 链路验证** | sdk-bots → freeroute(auto) → 工具回环 | ✅ 完成（`examples/verify-freeroute-auto.mjs`） |
| **M1 Bots 插件 PoC** | dsh 动态插件：`sidebar.footer.action` 按钮 + `shell.overlay` 折叠面板；bot 列表 / 新建 / 选会话 / 发消息（单向收发） | ✅ `bots-1/pkg-11`：左侧坞三分区（工作区/会话/Bots-群聊单聊）可折叠 + 全屏会话 + 设置页 Bots 分区 + 右下角调试药丸；**UI 直接复用官方哈希类名与 DOM 结构（用户反馈 pkg-10 仿制样式「与官方差距过大」后的重写，见 §12-27/28）**。Host 链路实证（自检 ok + 8 bots + 87 sessions）。源码落盘 `plugin/bots-{host,client}.js` |
| **M1.5 wfx 移除** | 用户要求去掉「工作流」tab（第三方 `dsh-plugin-wfx`，非内置） | 🔶 `~/.dsh/profiles/web/cordis.patch.yml` 已注释该 insert 行；**重启 dsh web 生效**（动态插件会同时失效，重启后用 `plugin/*.js` 重定义） |
| **M1.5 架构收敛**（2026-08-28） | 收敛为 `src/lib` 正式插件并**落进 profile 常驻**（`dsh.profile.bundles` link 依赖，重启不丢）：Host 用标准 `@Remote` 装饰器暴露类型化 `bots` 命名空间 + SSE 环形缓冲（`bots.eventsSince(seq)`）；Client 去哈希类名（自有类名 + `--dsw-*`）、`sidebar.workspaces` shadow（priority -100）作「工作区｜Bots」两折叠组导航（工作区委托原生浏览器）、聊天改 overlay、移除调试药丸与 `[data-workflow-run]` hack | `pnpm build`/`typecheck`/`test` 全绿（21 用例）；架构依据见 `DESIGN.md` |
| **M4a 正式插件包**（2026-08-28，按 zoahdev/dsh-plugin-template 重构） | 标准 TS 双半边包：`package.json`（`dsh.bundle.patch` + `dsh.client.platform=web` + `exports["./client"]`）、`cordis.patch.yml`（insert 行 `bots`）、`src/{index,gateway,sse,shared,version,client}.ts`、`tests/`（44 用例）、`scripts/{dsh-smoke.sh,integration-test.mjs}`。Host：`BotsRemote extends TypertRemoteService`（14 端点，`markRemoteMethod` 补标记）、SSE 环形缓冲、typert 模块同一性候选加载；`inject:[]` 全惰性 `ctx.get`。Client：`__ModuleLoader__.load` 工厂 + shell locale 运行时（`bots` 命名空间 zh/en） | ✅ `pnpm build`/`typecheck`/`test`（44）/`test:integration`（14 端点 marker）全绿；fresh-profile 冒烟 PASS（临时 `DSH_HOME` 装 tarball → 配置行 → web 启动 200）；**0.1.5 已 `dsh plugin --profile web add` 装进真实 profile，重启 dsh web 生效**（届时动态插件 bots-1 停用） |
| **M2 聊天视图** | SSE 实时渲染：消息气泡、`client-side-tool-v2` 工具卡片、进行中状态、@提及菜单 | 群聊中 @指定成员 可定向回复 |
| **M3 Bot 管理** | `updateAgent` 编辑（名称/简介/系统提示词字段确认）、头像、删除、群成员管理 | 免 reload 完成全套管理 |
| **M4 产品化（剩余）** | 正式包已落地（见 M4a）；余：迁入 dsh-plugin monorepo（catalog.mjs 管理）、sdk-bots 常驻（`SAND_HOST_PORT` 固定 + 进程守护）、一键启动 | 重启后自动恢复。💡 真正「工作区内」打开 bot 会话的路径：正式插件注册 `conversation.view` 列表槽第三视图（与 聊天/轨迹 并排）——动态插件优先级抢不过 shipped 且视图需 per-session 注入，只能用全屏仿原生层（pkg-8~10 现状） |
| **M6 7x24 自驱蜂群**（2026-09-02） | 目标三件套全链路验证 + 落地：① launchd `com.sdk-bots.host` `KeepAlive=true`（kill -9 实测 ~5s 自动拉起，PPID=1，重启自启）；② `examples/verify-autonomy-loop.mjs` 六项断言全绿（A1 CreateAgent 自主建 bot / A2 UpdateAgent 自主优化 bot / A3 update_state 自主排程 / A4 runAgentAutomationNow 无人唤醒 / A5 本地 cron 天然自驱心跳 / A6 SendToAgent 跨 bot 派活）；③ 蜂群引导器 `scripts/swarm/swarm-bootstrap.mjs`（共享黑板 GOAL/PROGRESS + 指挥官 bot + SWARM-CYCLE cron 例行任务，幂等可反复执行），引擎侧修复网关 `@every` 校验 bug（§12-37） | 7x24 保障链四层：launchd 进程守护 + 本地 cron 调度（headless 自驱）+ 网关发现自愈 + 全量落盘。运行手册见 `scripts/swarm/README.md` |
| **M5 增强** | per-bot 模型钉定、附件/知识库（`uploadAttachment`）、automations；**MCP 接入按 §13 快速路径执行**（P0 桥接 + 设置页 → P1 工具面板/聊天卡片） | 引擎侧零改动，插件暴露层按天计 |

M1 实现顺序（实际执行）：Host 半边（gateway.json 发现 + `ctx.shell` curl 桥 + 8 个 RPC，pkg-1 已验证）→ Client 半边（按钮 + 面板骨架 + 列表，pkg-3）→ 收发闭环（3s 轮询 transcriptTail）→ M2 换 SSE 中转。

---

## 11. 调试与验证手册

```bash
# 构建（daemon + workers bundles）
node scripts/build-host-workers.mjs && node scripts/build-box-exec-daemon.mjs

# mock 冒烟（无网络，验证 host 启动/CRUD/SSE/群聊循环）
NODE_OPTIONS="--use-system-ca" npm run test:e2e

# 端到端链路验证（真实 freeroute auto + 工具回环；隔离临时数据目录）
NODE_OPTIONS="--use-system-ca" npx tsx examples/verify-freeroute-auto.mjs

# freeroute 侧证据（auto 轮换、上游失败记录）
tail -f ~/.dsh/freeroute/freeroute.log

# freeroute 模型目录
curl -s http://127.0.0.1:3080/freeroute/v1/models | jq '.data[].id'

# 手工调网关（token 从 gateway.json 取）
TOKEN=$(jq -r .token ~/.sdk-bots/gateway.json); PORT=$(jq -r .port ~/.sdk-bots/gateway.json)
curl -s -H "authorization: Bearer $TOKEN" http://127.0.0.1:$PORT/api/listAgents -X POST

# dsh-plugin-bots 插件链路（~/workspaces/dsh-bots）
pnpm build && pnpm test && pnpm test:integration && pnpm pack
bash scripts/dsh-smoke.sh          # 临时 DSH_HOME 全链路冒烟
dsh plugin --profile web add ./dsh-plugin-bots-<ver>.tgz   # 装进真实 profile（重启 web 生效）

# 7x24 自驱蜂群（复杂目标 → 多 bot 无人值守协作）
node scripts/swarm/swarm-bootstrap.mjs --goal "目标描述" --schedule "@every 30m"
node scripts/swarm/swarm-bootstrap.mjs --status | --pause | --resume

# 自主能力端到端验证（~/workspaces/sdk-bots；六项断言：建bot/优化bot/排程/无人唤醒/自驱心跳/派活）
NODE_OPTIONS="--use-system-ca" SAND_BOX_EXEC_DAEMON_PORT=1347 npx tsx examples/verify-autonomy-loop.mjs

# 网关 7x24 守护（launchd；崩溃 ~5s 自动拉起 + 开机自启）
launchctl list | grep sdk-bots      # 确认已加载
kill -9 $(jq -r .pid ~/.sdk-bots/gateway.json)   # 演练自愈；~5s 后 /health 应换新 pid

# SSE 手工观察（gzip，断线自动重连）
curl -sN --compressed "http://127.0.0.1:$PORT/events?token=$TOKEN"
```

**任何「链路是不是坏了」的疑问，第一步跑 verify-freeroute-auto.mjs，第二步看 freeroute.log。**

---

## 12. 已知坑与注意事项

1. **`NODE_OPTIONS` 污染**：父 shell 注入 preload 时必须显式 `NODE_OPTIONS="--use-system-ca"`，否则递归 `fs.rm` 被拦截。
2. **EventSource 鉴权**：网关侧支持 `?token=`，但 dsh 动态插件 Client 无网络能力（§8 修正），SSE 由 Host 消费。
3. **transcript tail 无工具条目**：工具可视化只能走 `client-side-tool-v2` SSE 事件（M0 实测结论）。
4. **免费模型延迟**：10–30s/条，auto 接管（RATE_LIMIT 轮换）时更久；UI 与集成测试都要按 180s 级超时设计。
5. **`localToolPermission`**：默认会等 UI 授权弹窗；headless/插件场景先 `setHostSettings({localToolPermission:"always"})`。
6. **幂等创建**：`createAgent` 传 `clientNonce`，网络重试不会造出重复 bot。
7. **gateway.json 是 pid-stamped**：host 崩溃残留文件会被忽略，但插件发现逻辑要处理「文件在、进程不在」。
8. **安全边界**：网关保持 loopback；box 沙盒是目录隔离不是 VM，宿主仍视为可信进程。
9. **隐私噪音**：`privacy-mode lookup failed (api2.cursor.sh)` 为无害日志，可忽略。
10. **dsh 插件 Client 批准**：`cordis_run` 后 awaiting-approval 需用户在 UI 点允许；被拒后不得重复请求，改代码出新 Package 再试。
11. **两进程启动顺序无关**：sdk-bots 起时 dsh/freeroute 不在也不影响 host 启动，只在首个推理请求时才需要 freeroute 可达。
12. **动态插件沙箱网络约束（2026-08-27 实测 dsh 源码）**：Host 半边 `fetch`/`require` 是陷阱全局——HTTP 走 `ctx.shell` + curl（body 经 `stdin` 字段免转义），文件走 `ctx.fs`；`process`/`Buffer` 不可用（`process.env` 读不到，token 只能从 gateway.json 或 RPC 入参来）。Client 半边 `fetch` 被遮蔽，网络一律 `host.call`。
13. **网关鉴权默认关闭**：loopback 绑定 `requireAuth=false`；需要鉴权时显式设 `SAND_GATEWAY_TOKEN`。插件已按「token 有则带、401 显式报错」兼容两种模式。
14. **slots 必须硬依赖注入（pkg-3→4 实证）**：`ctx.get('slots')` + undefined 静默跳过会**丢注册**（apply 时服务可能未挂载）——必须 `inject: ['slots']` 让 Cordis 等待（官方插件同款模式）。
15. **`sidebar.footer.action` 条目会收到 `{wide}` props**（侧栏展开 true / 窄条 false）：窄条只渲染图标，否则文字被裁。`renderSlot(key, {wide})` 的 owner props 会透传给条目渲染器。
16. **keyed 单元抢不过 shipped 插件（pkg-5 实证）**：`conversation.chat.node` key `workflow-run` 从动态包注册会被官方注册者的优先级影子化（cells 按「priority order 首个存活条目」取胜）。要隐藏 shipped UI，用稳定 DOM 属性做 CSS：`[data-workflow-run] { display:none !important }`。
17. **Client 侧 React 是完整 API**（diag 实证 `Object.keys(React)` 含 useRef/useMemo/createContext 等全家桶）——Inspect 的 signatures 列表只是摘要；但保守起见仍优先 createElement/useState/useEffect。
18. **浏览器侧调试通道**：Client `host.call('bots.diag', …)` → Host `ctx.shell` 追加写 `~/.sdk-bots/dsh-bots-diag.jsonl`——agent 侧直接读文件即可看到 apply/render/错误事件序列与 Host 自检结果（pkg-6 起常驻）。
19. **本仓库许可**：UNLICENSED（源自对商业产品的非官方重建），商用前先过 provenance 审查（见 `NOTICE.md`）。
20. **「工作流」tab 的真身是第三方插件** `dsh-plugin-wfx`（Workflow Studio），经 `~/.dsh/profiles/web/cordis.patch.yml` 的 insert 行挂载——不是内置 ui-workflow-run。增删 web 组合改 profile 的 cordis.yml / cordis.patch.yml 即可，重启生效。
21. **原生聊天样式令牌**（pkg-8 会话视图照抄）：用户消息右对齐 `background: var(--dsw-specific-bubble); border-radius:22px; padding:10px 16px; font-size:16px/24px; max-width:min(525px,82%)`；助手消息无气泡 `color:label-primary; 16px/28px`。
22. **Client 服务面**（pkg-8 用到）：`sessions.search(query, signal)` 返回 `{items:[{sessionId,title,…}]}`（AbortController 在闭包里可用）；`sessions.open(id)` 原生跳会话；`workspaces.connectWorkspace(id)` 建/开工作区会话。Host 侧 `workspaceRegistry.list()` 经 `bots.workspaces` RPC 供坞的工作区分区。pkg-9 起会话分区主用 Host RPC `bots.sessions`（`sessionQuery.listSessions()` → SessionRecord{header}，标题经 `sessionTitle.readTitleSnapshots(ids)` → `value.title.title`；实测 87 个会话），客户端 search 仅兜底。Workspace 字段：`{id, path, title, sessionIds}`（dts 实证）。
23. **网关自检时序竞态**：host 启动瞬间 gateway.json 可能尚未落盘（2026-08-28 实例重启时自检报 no-gateway-json，实际几秒后就绪）。`callGateway` 每次重读 discovery，无需缓存自愈。
24. **deleteAgent 引擎 bug（2026-08-28 已修）**：`host-gateway-api.ts` 的 `deleteAgent`/`deleteAgents` 对 `automations.deleteAgentSchedules` 的返回值直接 `.catch`，而 `forgetAgent(): void` 同步无返回 → `Cannot read properties of undefined (reading 'catch')`，删除必炸。修复：两处调用点包 `Promise.resolve(...)`。网关重启后实测删除成功。另：`listAgents` 返回裸数组（非 `{result}` 包裹），桥接层 normalizeAgents 已兼容两种。
25. **M1 收发回路端到端实证（2026-08-28，网关新实例）**：createAgent → sendPrompt（`{accepted:true}` 异步受理）→ ~11s 后 `getAgentTranscriptTail` 出现 `send-message` 回复 → deleteAgent 清理成功。免费模型延迟 ~10-15s。
26. **网关启动需 `SAND_HOST_PORT=7331`**：不带则随机端口（如 57103）。已固化脚本 `scripts/start-gateway.sh`（幂等：已在跑则直接报健康；`-d` 后台启动并等待就绪）。
27. **「与官方 UI 完全一致」的正解 = 直接复用官方哈希类名（pkg-11 实证）**：用户驳回 pkg-10 的手抄仿制样式（「差距过大」）。官方构建产物把 CSS Modules 类名（构建内稳定的哈希串，如 `YDXeBa_sessionRow`）连同规则插进页面 —— 动态插件的 React 元素**直接写这些官方 className + 官方 DOM 结构**，样式即与官方同一份，天然像素级一致（hover/选中/折叠箭头旋转等纯 CSS 交互全部继承）。再把提取到的规则原文注入 `styles.insert` 作兜底（同规则重复注入无害，防目标组件未渲染时类缺失）。风险：dsh 升级重构建会换哈希，届时需重新提取（可接受，本机部署）。图标位（folder/chevron 是官方 Icon 组件）用 emoji 文字占位，仅此一处肉眼可辨。
28. **官方类名提取地图（pkg-11 实测生效）**：侧栏壳 `hHd-Xa_root`（dsh-client-ui-sidebar：padding 6px/12px、sidebar-fill 背景、14px 字号）；浏览根 `qDHVXG_root` + 分区头 `qDHVXG_sectionHeader/_sectionLabel`（36px 高、tertiary 色）；行族 `YDXeBa_projectRow`(34px 折叠组)/`_sessionRow`(32px)/`_slot`/`_title`/`_time`/`_meta`/`_arrow(_Open)`/`_selected`（dsh-client-ui-workspace）；用户消息 `gdEzaW_userRow>_userStack>_bubble`（dsh-client-ui-conversation）；助手 `Sxvs8a_root>_body`；输入卡 `uV2eYG_root/_card`(22px 圆角输入卡)/`_row`/`_trailing`/`_primary`(34px 圆钮)。DOM 组装结构照 `lib/client.js` 里 jsx-runtime 调用原文（如 sessionRow = slot+title+time+rowActions）。官方输入框本体是透明 textarea 叠 backdrop 的设计，粘合层用等形可见 textarea 替代（字号/行高/padding 取自官方 input 规则）。
29. **官方图标可复刻（pkg-12）**：图标 SVG 路径写死在 `dsh-web-frontend/dist/assets/index-*.js`（导出映射 `IconFolderOpen16:P7` 等压缩名 → 定义体是纯 `svg > path{d,fill:currentColor}`），无外部依赖，逐字节抄进 `React.createElement('svg',...)` 即与官方渲染完全一致。已复刻：folder open/close 16、triangle-right-fill 14（chevron）、发送上箭头 16、停止方块 16（rect rx3）。官方发送钮行为：空输入置灰、运行中图标变停止方块。
30. **⚠️ define 只提交半边 = 丢掉另一半边（pkg-12 事故）**：`cordis_define` 的 code.host/code.client 是**每包各自完整定义**，不从旧包继承缺省的一半。pkg-12 只给了 client → 更新后 host 半边整个消失（`hasHostHalf:false`），所有 `host.call('bots.*')` 失败、坞全灰。run 仍报「成功」（client 加载成功即算），**唯一暴露信号是 diag 静默**（新版 apply/自检事件不再出现）。修复 = 定义新包时**永远双半边一起提交**，哪怕 host 没改。


31. **正式插件常驻 = profile `bundles` + link 依赖**（2026-08-28 实证）：动态插件（`cordis_define`）仅存于会话内，重启即失。
    要常驻，把插件加进 `~/.dsh/profiles/web/package.json` 的 `dependencies`（`link:/…/dsh-bots`）与 `dsh.profile.bundles`，再在该目录 `pnpm install`。
    启动时 dsh 依 bundles 逐个取各包的 `dsh.bundle.patch`（`cordis.patch.yml`）组装插件树（对照 dsh-freeroute 0.8.4）。
32. **侧边栏「工作区｜Bots」两折叠导航 = shadow `sidebar.workspaces`**（2026-08-28，沿 dsh-plugin-wfx 先例）：`sidebar.workspaces` 是 single 槽，
    以 `priority:-100` 抢占后自绘 accordion；「工作区」用 `slots.hostFace()` + `entry.inject()` 合成 props 委托渲染**原生** workspace browser（不改原组件），
    「Bots」渲染我们的 bot 树。rail（收窄）态给两个图标按钮。聊天经 `shell.overlay` 全屏承载。
33. **Typert 源码模式描述符按「编译后形参」生成，零参方法拒绝统一信封**（2026-08-28 实证，0.1.5→0.1.6）：
    gateway `assertExactArguments` 以形参名为白名单做精确校验（多余字段必拒，`src-json` 编解码容忍缺省）。
    Client 按 wfx 惯例每调用都发 `{args:{request}}`，故 Host 全部 14 个远端方法必须声明单个名为 `request` 的纯形参
    （无默认值/解构/rest，TS 类型会被擦除不影响 wire 名），否则报 `args fields do not match the descriptor: unexpected "request"`。
    零参方法（list/workspaces/sessions/sseState）已补参修复。新增方法时照此约定。
34. **中文输入法 + Enter 发送 = 半截消息（2026-09-01 修）**：`onKeyDown` 里裸判 `ev.key === 'Enter'` 会把 IME 候选窗的**确认键**当成发送，
    中文用户每选一次候选就误发一条半截消息（英文输入完全无感，故极易漏测）。修复 = keydown 首行守卫
    `imeRef.current || ev.nativeEvent?.isComposing === true || ev.keyCode === 229` 直接 return（三重信号：Chromium 给 `isComposing`，
    部分引擎只给 229，`imeRef` 由 `onCompositionStart/End` 维护兜底）；且 `compositionend` 在 Firefox/Safari **晚于** 提交键的 keydown 触发，
    所以提交后的文本必须在 `onCompositionEnd` 里重读一次，不能只靠 `onChange`。
35. **原生输入卡的三个隐形交互（同批补齐）**：① textarea **自增高**（`height='auto'` 再取 `scrollHeight`），固定高会让草稿被困在单行取景框里；
    ② 点卡片留白要落光标（`onMouseDown` 上 `preventDefault` + `focus`，但对 `button/textarea/.dbs-mention` 放行）；
    ③ 补全菜单的 Esc 必须 `stopPropagation()` —— `BotsLayer` 的 Escape 监听挂在 `window` 上，不拦就「关菜单」连带「关聊天」。
    React 合成事件的 `stopPropagation` 会调底层原生同名方法，能拦住挂在 root 容器之上的 window 监听。
36. **transcript 时间戳字段不统一**：新条目给 `timestampMs`，老条目可能是 `timestamp`/`createdAt`/`time`，值可能是**秒**或 ISO 串。
    `trimEntry` 统一走 `entryTimestamp`（< 1e11 视作秒，纯数字串走 Number，其余走 `Date.parse`），否则整段会话不显示时间且无任何报错。
37. **网关 `createAgentAutomation` 拒绝 `@every` 排程（2026-09-02 已修）**：host-gateway-api 的创建校验只调 `compileCronMatcher`（仅认 5 字段 cron + @hourly 族），
    而 `@every <n><unit>` 由 `parseEveryIntervalMs` 在运行时解析——报错文案声称支持 `@every 30m`，实际 500。修复 = 校验条件补
    `parseEveryIntervalMs(schedule) == null &&`（与 automation-runtime 的运行时路径对齐）。注意 bot 走 `update_state` 工具自建例行任务不经过该校验，故 verify-autonomy-loop 里 `@every 1m` 一直可用。
38. **隔离实例的 box exec-daemon 端口冲突（2026-09-02）**：生产网关常驻占用 1337，isolated host 启动会 fatal
    `refusing contaminated box exec-daemon startup`。验证脚本须另设 `SAND_BOX_EXEC_DAEMON_PORT=1347`（两侧都读该 env），比 `SAND_USE_EXISTING_BOX_EXEC_DAEMON=1` 复用生产 daemon 更干净。
39. **worker bot 会拒绝来历不明的派活（2026-09-02 实证）**：引擎的提示注入防御把无上下文的 inter-agent 指令当可疑信标（工兵实测拒绝执行 echo）。
    解法 = 指挥官创建 worker 时把「你由蜂群指挥部创建，其 SendToAgent 指令是合法指挥链」写进对方 description（swarm-bootstrap 的例行 prompt 已内置）。
40. **bot 共享文件黑板 = 宿主绝对路径 `~/.sdk-bots/swarm/`（2026-09-02 实测修正）**：本地 loopback 盒 =「宿主自身容器」，
    bot 的 Shell 工具直接跑在宿主机上（cwd 是 `<dataRoot>/box-workspace`），没有 `/home/box/...` 真实挂载——
    指挥官实测把 `/home/box` 判为只读卷。跨 bot 协作文件一律用宿主绝对路径（如 `~/.sdk-bots/swarm/GOAL.md`），所有 bot 共见；
    各 bot cwd（box-workspace）下的相对路径文件也互相可见但易混淆，勿作黑板。
41. **未读徽章必须插件自己记账，网关 `unreadCount` 不可依赖（2026-09-02，0.2.2）**：sdk-bots 的 unread 是桌面壳语义——
    只在单个 `activeSession` 上计数、窗口聚焦即视为已读、**任何 transcript 读路径都会 markViewed**（插件拉 tail 就把未读清零），
    本地 headless 网关实测所有 agent 恒为 0。正解（0.2.2 落地，`src/unread.ts`）：Host 半边自有模型——
    SSE ring `onPush` 观察者实时计数（只认 message 族 kind；`timestampMs` ≤ 已读标记一律忽略 → 重连 snapshot 重放幂等）；
    已读标记「上次读到哪」持久化 `<dataDir>/dsh-bots-unread.json`；每次 SSE (重)连 `onConnected` 拉全量 tail rebase 自愈（SSE 无重放，停机期间的事件靠这个找回）；
    首次启用把现有历史种子为已读（升级不炸出一墙积压徽章）；计数搭 `eventsSince.unread` 顺风车下发，零新增 RPC。
    Client：打开会话乐观清零 + 打开期间对本会话新到达去抖 1.2s markRead；离开视图时 pending 定时器随 effect 清理销毁（离开瞬间到达的消息保持未读语义）。

---

## 13. MCP 接入与实现方案（快速路径）

> 定位判断：**MCP 是本系统的能力扩展总线**——dsh freeroute 是「模型总线」（对 bot 供给智能），MCP 是「工具总线」（对 bot 供给外部能力），
> 两条总线合起来才是 bot 的完整供给侧。接入后每个 bot 即刻获得整个 MCP 生态（Linear/Notion/GitHub/文件/浏览器…），无需逐个写集成；
> 且 M6 蜂群已经能自建 bot/排程/派活（§10），MCP 的聊天内自助安装流让蜂群可以**自己给自己接工具**。

### 13.1 核心结论：引擎已是成品，缺的只是「暴露层」

源码实读（2026-09-02，sdk-bots `src/host/`）证实 MCP 协议栈、路由、鉴权、市场**全部现成**：
快速接入 ≠ 实现 MCP，而是 **把网关已有的 MCP 面桥进插件 `bots` 命名空间 + 补三块 UI**，按天计。

### 13.2 引擎侧存量盘点（锚点）

| 层 | 已有能力 | 锚点 |
|---|---|---|
| 网关 API | `listMcpServers` / `addMcpServer {name, configJson}`（stdio 或 URL）/ `removeMcpServer {serverId}` / `listRoutedMcpTools` / `executeRoutedMcpTool {agentId, name, toolName, providerIdentifier, args, toolCallId}` / `refreshMcp {routedAction, routedArgs, completion}` / `listBoxMcpServers` / `appendConnectorCard` | `host-gateway-api.ts:142-165,666-728`、`gateway-protocol.ts:121-129` |
| turn loop 工具 | `GetMcpTools` + `CallMcpTool` + meta descriptors（按 server 分组的工具目录进系统面）；dynamic tool registry 解析真实工具名，per-tool 超时 | `runner/tools/turn-toolset.ts:26-44,543-572`、`mcp-meta-tools.ts:121-151` |
| 聊天内管理 | 12 个管理工具：SearchPlugins / GetPlugin / InstallPlugin / AddMcpServer / UninstallMcpServer / UninstallPlugin / GetMcpServerStatus / SetMcpInstructions / RestartMcpServers / AuthenticateMcpServer / RemoveMcpAccount / RenameMcpAccount——**bot 对话即可装服务器、走 OAuth、授权后自动 resume** | `runner/tools/sand-mcp-management-tools.ts:315-429` |
| 鉴权 | OAuth 等待注册表 + 完成回执 + `resumeAfterMcpAuth`；connect card（variant `connect`/`connected`）自动入 transcript | `mcp-auth/host-mcp-auth-completion.ts`、`gateway-protocol.ts:21` |
| 市场 | 插件目录（listPlugins/getPlugin/install/uninstall）：connectors+skills 打包，setup fields 带 required/secret 标记 | `sand-mcp-management-tools.ts:32-52` |
| 配置 | `<dataDir>/mcp-servers.json`（stdio 服务器；实测已有 `mini` :900000001）+ settings.json 的 `mcpCustomInstructions(ByServerId)` / `mcpDisabledToolsByServerId` / `mcpBoxServers` | `~/.sdk-bots/` 实读 |
| 沙盒 | box 侧 `loadMcpServers` 控制通道（老镜像抛 `SandBoxMcpUnsupportedError`） | `box/box-mcp.ts` |

### 13.3 IA 决策：三处分工（避免把管理面堆进一个页面）

| 场景 | 归属 | 理由 |
|---|---|---|
| 服务器生命周期（装/删/重启/鉴权状态） | **设置页**「MCP 服务器」分区（DESIGN.md §4.4） | 全局低频、影响所有 bot |
| 工具浏览与试运行 | **工作台详情栏**「工具」页 | 调试高频、跟 bot 上下文走 |
| 聊天内自助管理 | **已有**——bot 用 12 个管理工具，UI 只需渲染 connector card 与工具卡片 | 零开发，只补渲染 |

### 13.4 分期落地

| 期 | 内容 | 工程量 |
|---|---|---|
| **P0 桥接**（✅ 0.2.3 已落地） | Host 半边 6 个透传 RPC（全部 `callGateway` 现成命令）：`bots.mcpServers` / `bots.mcpTools` / `bots.mcpAdd {name, configJson}` / `bots.mcpRemove {serverId}` / `bots.mcpRefresh` / `bots.mcpExecute`。注意 §12-33 单 `request` 形参约定 | 23 端点集成断言全绿；网关只读冒烟通过（`{servers:[...]}` 包裹 + 裸数组工具行） |
| **P0 设置页**（✅ 0.2.3 已落地） | 「MCP 服务器」分区：列表行（StateDot: connected/needsAuth/error + toolCount + transport）+ 添加（stdio / URL 示例一键填入的 configJson）+ 删除（两击确认）+ 重启 | ✅ |
| **P1 工具面板** | 详情栏按 server 分组列 `mcpTools`（name/toolName/description/inputSchema）+ 单工具「试运行」（JSON args → `mcpExecute`，agentId 传当前 bot） | ~1 天 |
| **P1 聊天卡片** | connector card（connect/connected 两态）渲染；MCP 工具调用经 `client-side-tool-v2` 卡片化；auth 完成 → `refreshMcp {completion}` 回执链 | ~1 天 |
| **P2** | 插件市场 UI（listPlugins/install 已有 API）；box MCP 状态角标；per-bot 工具开关（引擎现为全局 `mcpDisabledToolsByServerId`，per-agent 需引擎小改） | 按需 |

### 13.5 已知坑与待实测

1. **`executeRoutedMcpTool` 字段翻转（待实测）**：`host-gateway-api.ts:158-165` 把请求体 `{name, toolName}` **交换后**传给 executor
   （`{name: args.toolName, toolName: args.name}`）。按 `listRoutedMcpTools` 行形（`name`=动态注册名、`toolName`=底层工具名）推导：
   调用时应传 `{name: 行.toolName, toolName: 行.name}`。P0 试运行面板首验，不通则交换并在此记录。
2. **stdio 支持面**：聊天管理工具 AddMcpServer 的描述文案写着「仅支持 remote http/sse」——那是官方云端限制；**本地网关 `addMcpServer` 明确支持 stdio**
   （`mcp-servers.json` 实证）。UI 文案按本地现实写，勿抄官方文案。
3. **`configJson` 必须是 JSON 对象字符串**：网关侧 `JSON.parse` 校验，数组/null 拒绝（`host-gateway-api.ts:703-718`）。
4. **MCP 无专属 SSE 频道**：连接状态变化靠设置页打开时拉取 + 手动刷新（与 §4.4 横切规则一致）；`mcpDisabledToolsByServerId` 改动经 `refreshMcp` 生效。
5. **鉴权流依赖卡片回执**：`completeMcpOAuth` 在网关 API 是 stub（`:696`），真实完成回执走 `refreshMcp {completion}` → `handleDesktopMcpAuthCompletion`——插件侧授权完成必须回这条，否则 bot 不会自动 resume。

### 13.6 验收

沿用实测在案的 `mini` stdio 服务器模式：设置页添加一个 echo MCP（stdio）→ 列表出现且 StateDot connected → 工具面板见其工具 → 试运行回显 → 聊天里让 bot 用该工具 → 删除。全程免 reload。

---

## 14. Per-agent 工作区隔离（workspace jail）

> 需求：每个 agent 一个自己的工作目录，不能越界。**调查结论：引擎已有完整实现且生产在跑**——
> 本插件零引擎改动，只做配置桥接 + 设置页 UI（0.2.3 落地）。

### 14.1 引擎机制（源码锚点：`src/host/runner/agent-workspace-jail.ts`）

| 环节 | 行为 |
|---|---|
| 配置面 | 每 agent 一份：`~/.sdk-bots/agents/<agentId>/settings.json` 的 `workspaceRoot`（`/workspace/<slug>`）+ 可选 `workspaceAllowPaths`（额外可写宿主路径） |
| 隔离手段 | **macOS Seatbelt（`sandbox-exec`）内核级写隔离**：该 agent 的每条 Shell 命令被包成 `sandbox-exec -f <profile> /bin/sh -c '<原命令>'`，profile `(deny default)`，写白名单 = 自己的宿主目录（`<box-workspace>/<slug>`）+ allowPaths + OS 临时目录；**读取不受限**（共享黑板仍可读）；cwd 强制为该 agent 的虚拟根 |
| 生效时机 | 每 turn 懒解析——改 settings.json 下一 turn 生效，**无需重启** |
| profile 生成 | `~/.sdk-bots/workspace-jails/<agentId>.sb`，原子写、变更即更新 |
| 失败语义 | **fail-closed**：配置存在但畸形（坏 slug / 越界绝对路径）直接抛错拒绝 turn，绝不静默裸奔 |
| 限制条件 | darwin + `/usr/bin/sandbox-exec` 存在才启用；kill switch `SAND_AGENT_WORKSPACE_JAIL=0`；slug 允许 Unicode 字母（`录音师`/`编剧` 实证） |

### 14.2 生产实证（2026-09-02）

- `~/.sdk-bots/workspace-jails/` 已有 **5 份已武装 profile**（profile 只在 Shell 真正被 wrap 时写入）。
- 实配样本：`录音师` → `/workspace/录音师` + allowPath `box-workspace/剧组共享`（剧组共享目录模式）；`编剧` profile 头实读
  `(deny default)` + 仅自身目录写白名单。
- 结论：隔离链路（配置 → 解析 → wrap → 内核强制）全链路真实运行，非纸面设计。

### 14.3 插件桥接（0.2.3）

| RPC | 语义 |
|---|---|
| `bots.workspaceList` | 扫 `<dataDir>/agents/*/settings.json`，返回每 bot 的 `{agentId, workspaceRoot, allowPaths}` |
| `bots.workspaceGet {agentId}` | 单个读取 |
| `bots.workspaceSet {agentId, workspaceRoot?, allowPaths?}` | 读-改-写 settings.json（保留其余字段）；`workspaceRoot: null` 解除隔离；slug 校验**镜像引擎规则**（引擎 fail-closed，坏配置会打断 bot turn，插件侧必须先行拦截） |

设置页新增「Bot 工作区隔离」卡：根目录行 + 每 bot 一行（StateDot + slug + allowPaths 数）+ 开启（slug 默认取 bot 名）/两击确认解除。
开启即写配置、下 turn 生效。**注意：同名的 bot 会共享同一工作目录**（slug 冲突），卡片文案已提示。

### 14.4 边界声明（诚实约束）

1. **读不受限**是设计而非缺陷：蜂群黑板（§12-40）、共享道具目录都依赖跨 bot 读。
2. **Shell 命令内容**在 loopback 盒 = 宿主可信进程（§12-8）——Seatbelt 从内核面拦**写**，但 bot 若刻意请求宿主信任何级别的操作，仍属既有信任模型，不在本机制承诺内。
3. 非 darwin 平台自动退化为「不隔离」（daemon 根级守卫仍在）。

---

*文档版本：2026-09-02 · 基于 multibot-sdk 0.4.0 · 正式插件包 dsh-plugin-bots 0.2.3 已装入真实 profile（MCP 桥接 §13 P0 + 工作区隔离桥接 §14）；M6 7x24 自驱蜂群落地（launchd 守护 + 自主能力六断言全绿 + swarm 引导器，见 scripts/swarm/README.md）。架构详见 DESIGN.md*
