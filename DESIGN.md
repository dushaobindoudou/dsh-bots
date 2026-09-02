# dsh-plugin-bots — 架构与 UI 重设计

> 版本 2026-08-28 · 基于对 dsh 内核（`@deepseek-ai/dsh-client-ui-*`，rc.2）与正式插件（dsh-freeroute 0.8.4）的源码实读。
> 本文是 DEVELOPMENT.md 的演进提案：在保留已验证链路（网关发现 / curl 桥 / freeroute auto）前提下，
> 把插件从「动态插件 + 抄哈希类名」收敛为「正式插件 + 原生运行时」，交互与视觉对齐 dsh 原生。

---

## 0. TL;DR

- **核心结论**：当前 M1 用「动态插件（`cordis_define` 沙箱）+ 手抄官方哈希类名」是**开发快迭代**的正确形态，但不是最佳最终形态。
  正式插件（装入 profile `node_modules` + `cordis.patch.yml` insert）能拿到**完整 React / DOM / ui-primitives / Connection RPC**，
  视觉可以直接用 **CSS 变量 + primitives** 对齐，不再受哈希类名脆弱与沙箱限制约束。
- **重设计三件事**：① 形态从动态收敛到正式插件；② Host 升级为「类型化 Remote 命名空间 + SSE 环形缓冲」；
  ③ UI 重画为**三栏工作台**（与原生 `sidebarCol|centerCol|detailsCol` 布局同构），交互词汇全用原生。
- **主工作台位置**：这是「多 Bot 工作区」，Bot 会话是 sdk-bots transcript 而非 dsh session，因此**不放** `conversation.view`
  （那是 per-dsh-session 的，第三标签只适合「轨迹」这类会话内视图）。正解 = `sidebar.footer.action` 入口 +
  `shell.overlay` 原生载入层渲染工作台，`settings.section` 放网关状态与引导。

---

## 1. 现状盘点（当前 M1 实现）

| 层 | 现状 | 评价 |
|---|---|---|
| 入口 | `shell.overlay` 浮层 + 右下角调试药丸（`pkg-11`） | 药丸是调试残留，正式版应去掉 |
| 工作台 | 左侧 262px 坞（工作区/会话/Bots 三分区，用官方哈希类名） | 定位 float 是 `position:fixed`，脱离原生载入层 |
| 聊天 | 仿原生气泡 + 输入卡（`gdEzaW_*`/`Sxvs8a_*`/`uV2eYG_*`）+ 3s 轮询 `transcriptTail` | 无实时 SSE；手抄类名脆弱 |
| 设置 | `settings.section` id `bots` + 连接状态卡 | 可保留，样式应去哈希化 |
| Host | `inject:['fs','shell']`，curl 桥 8 个 RPC + 自检 + diag | 结构可保留，但 RPC 未类型化、未做 SSE |

**主要问题**：
1. 手抄官方哈希类名（`qDHVXG_*` 等）在 dsh 升级重构建后会失效——已知风险，只能靠「一次一版提取」维护。
2. 动态插件 client 沙箱无 DOM/无 fetch/EventSource，SSE 全要从 Host curl 中转，交互重（§8 已证伪直连）。
3. `position:fixed` 坞脱离原生 `shell.overlay` 载入层（z-20 绝对象限），叠加/遮挡/折叠语义与原生不一致。
4. RPC 是一堆手写 `bots.xxx`，无类型、无错误域分级；3s 轮询浪费且不实时。
5. bot 会话数据（transcript）与 dsh session 模型割裂，没有把「会话状态机 / 运行态 / 工具事件」接进 UI。

---

## 2. dsh 原生 UI 与交互（源码实读锚点）

### 2.1 布局即三栏 frame
`dsh-client-ui-layout/lib/client.js`：`AppFrame` 是 CSS grid `pI_x6G_frame{grid-template-columns: sidebarCol | centerCol | detailsCol}`。
- centerCol 承载会话视图；detailsCol 可折叠（拖动 handle，`data-details-collapsed`）。
- `shell.overlay` 槽渲染在**原生载入层** `pI_x6G_overlayLayer{position:absolute;inset:0;z-index:20;pointer-events:none}`，
  子项 `pointer-events:auto`（`:237`）。
- **插件工作台应渲染进 `shell.overlay` 层**（而非 `position:fixed`），天然压在 frame 之上、且随折叠语义走。

### 2.2 侧栏入口
`dsh-client-ui-sidebar/lib/client.js`：
- 槽族 `sidebar.brand.mark/name`、`sidebar.workspaces`(single)、`sidebar.settings`(single)、**`sidebar.footer.action`(list)**（`:307`）。
- 底部 = `sidebar.settings` + `sidebar.footer.action`（`:233/:236`）。footer.action 是 **list**（id/order/label 按钮）——
  「Bots」入口的**原生正解**（当前动态插件应直接用，M1 已列但未实现为正式入口）。

### 2.3 会话视图 = conversation.view 槽（含第三视图机制）
`dsh-client-ui-conversation/lib/client.js`：
- 标签台：`tabs = slots.entries('conversation.view')` → `{id, label}`；`tabs.length>1` 才渲染标签条（`:9930`）；`actions.setView(id)` 切换（`:7394`）。
- 槽消费方：`renderSlot('conversation.view', { inspect, onInspectDone }, { only: active.id })`（`:7419`）。
- 注册形态（`dsh-client-ui-trajectory/lib/client.js:7341` 原样）：
  ```js
  slots.inject('conversation.view', () => slots.register({
    name: 'conversation.view', id: 'trajectory', order: 10, locale: NS,
    label: () => t('view.trajectory'),
    inject: (sessionId) => ({ hooks:{…}, loadOlder:…, setActualDuration:… })
  }, TrajectoryView))
  ```
- **但这是 per-dsh-session 的视图**（`inject:(sessionId)` 要 `sessions.binding(sessionId)`）。Bot 聊天是 sdk-bots transcript、
  不是 dsh session，**不应**注册成 `conversation.view` 第三标签（会在每个会话里出现、且无 bot 语义）。→ 工作台走 overlay。

### 2.4 设置页
- `settings.section` 是 list（id/label/order）。M1 已用；dsh-freeroute 甚至能「换血」内置 `models` entry 加页签（`client.js:1137` 用占位
  registration + bump 版本）——说明正式插件可与内置设置页深嵌。Bots 用独立 section 即可，不必 hack。

### 2.5 正式插件 vs 动态插件（核心差异，决定架构）
| 维度 | 动态插件（`cordis_define`，dev 快迭代） | 正式插件（profile node_modules） |
|---|---|---|
| 运行时 | `dsh-cordis-client-runner` 受限沙箱 | 浏览器宿主，Factory + `inject:['connection','slots']` |
| React | 仅 `React.createElement`/useState/useEffect | 完整 React + `React.useId` 等 |
| DOM/网络 | 无 `document`/`fetch`/`EventSource` | **有完整 DOM**（dsh-freeroute 直接 `document.head` 插 style、`document.querySelector`） |
| 样式 | `styles.insert` + 抄哈希类名 | CSS 文件 + CSS 变量 + `ui-primitives` |
| RPC | `host.call('bots.*')` | `connection.rpc.call('/api', 'bots/<method>', {args})` 类型化 |
| 优先级 | 抢不过 shipped | 与轨迹/聊天同 slot 体系，`order` 排序 |
| 开发 | 会话内重定义即热更 | 需装包，但一次性成型 |

**结论**：动态插件留作**原型/探索**；稳定后收敛为**正式插件包**（对照 dsh-freeroute 的 `cordis.patch.yml` + `exports ./client` 结构），
~~dsh-bots 的 peerDependencies 与正式 client 依赖应补上 `dsh-client-runtime / dsh-client-ui-slots / dsh-client-ui-primitives / dsh-client-ui-web`。~~

> **更正（2026-08-28，实测）**：**不要**加这些 peerDependencies，会导致安装失败。
> `@deepseek-ai/dsh-client-ui-slots` 与 `dsh-client-ui-primitives` 在 profile 的 `node_modules` 里是**悬空软链**
> （指向 dsh 包内不存在的路径）——它们只作为 `staticModules` 打包进了 web bundle，磁盘上没有实体包。
>
> 正确做法：继续走 `__ModuleLoader__` 的 `require`。shell 的静态模块表（web bundle `function Jd()`）实测暴露：
> `react` · `react/jsx-runtime` · `react-dom` · `react-dom/client` · `@deepseek-ai/cordis` ·
> `@deepseek-ai/dsh-client-ui-slots` · **`@deepseek-ai/dsh-client-ui-primitives`**。
> 也就是说**原生组件可以直接 require 拿到**：`Button / Input / Pill / StateDot / Tooltip / Menu / Modal /
> DisclosureRow / MarkdownText / MessageText / CodeBlock` 加全套 `Icon*`。
> 这是「UI 与原生一致」的正解——比抄哈希类名和自绘 SVG 都更稳，且随 dsh 主题自动跟随。

---

## 3. 最优架构设计

```
┌─ 浏览器 ──────────────────────────────────────────────────────────┐
│ dsh Web (:3080)                                                    │
│  原生 AppFrame: sidebarCol | centerCol | detailsCol                │
│  ├─ sidebar.footer.action  「Bots」入口按钮（原生 list）            │
│  └─ shell.overlay 原生载入层 ─► BotsWorkbench（工作台，三栏）        │
│       bots 列表 | 会话流 | 详情/群面板                              │
│  └─ settings.section 「Bots」设置页（网关状态/模型/启动引导）        │
│      Client 半边（正式插件运行时）                                  │
│      React hooks store · ui-primitives · CSS 变量                  │
│      RPC: connection.rpc.call('/api','bots/<method>',{args})        │
└───────────────┬───────────────────────────────────────────────────┘
│ Connection RPC（/api）                                                │
┌───────────────▼───────────────────────────────────────────────────┐
│ Host 半边（正式插件，inject:['fs','shell','connection','settings']）│
│  bots Remote 命名空间（类型化 typet NSC）：                          │
│   · discovery: gateway.json 发现 + /health pid 活性校验             │
│   · crud: list/create/update/delete/createGroup/setGroupMembers     │
│   · chat: send / transcript(Page/Tail) / outline                   │
│   · sse: 常驻 curl -sN --compressed /events 环形缓冲 + eventsSince  │
│   · meta: hostSettings / models / mcp / avatars                    │
│  ▷ 内部：gateway curl 桥（保留） + sdk-bots 进程守护（M4）            │
└───────────────┬───────────────────────────────────────────────────┘
│ POST /freeroute/v1/chat/completions (model=auto)                     │
┌───────────────▼───────────────────────────────────────────────────┐
│ sdk-bots host（gateway.json 发现）· box exec-daemon · freeroute      │
└───────────────────────────────────────────────────────────────────┘
```

### 3.1 源树（正式插件，tsc 编译 → lib）
```
src/
  index.ts          # Host 半边：插件入口，bots Remote 命名空间注册
  shared.ts         # 跨 Host/Client 的叶子类型 + 协议常量
  gateway/          # 网关桥（curl）、discovery、pid 活性校验、SSE 消费
    discover.ts  curl.ts  sse-ring.ts
  host/
    namespace.ts    # typet 命名空间编排
    crud.ts  chat.ts  meta.ts
  client/
    apply.ts        # Client 半边入口 inject:['connection','slots']
    workbench.tsx   # BotsWorkbench 三栏工作台
    chat/           # 会话流：气泡/工具卡片/@提及/运行态
    controls.tsx    # 列表/卡片/详情/创建表单
    useBotsStore.ts # React 订阅 store（SSE eventsSince 增量）
  types.ts
```
（当前 `src/client.ts/gateway.ts/index.ts/shared.ts/version.ts` 可逐步迁移，非推倒重写。）

### 3.2 Client 半边要点
- **入口**：`sidebar.footer.action` 注册唯一按钮 `{id:'bots', order:30, label:'Bots'}`；点击 toggle `setStore(workbenchOpen)`。
- **半透明形态**：工作台在 `shell.overlay` 层内设为「左侧固定宽 + 右侧自缩」的 overlay 卡片（不 `position:fixed`），
  与 vim 式折叠面板互斥（开工作台即合 detailsCol 语义可选）。
- **渲染**：全部用 CSS 变量族（`--dsw-alias-*`）+ `dsh-client-ui-primitives`（气泡/按钮/图标/输入），**停抄哈希类名**。
- **store**：`useBotsStore` 持有 agents/groups/sessions/activeAgentId/entries/toolEvents/selectedView，经
  Host `bots.eventsSince(seq)` 增量同步（Host 环形缓冲），客户端不轮询。
- **聊天状态机**：`running/streaming/tool-running/stopped/error` 映射到原生语义色与「发送↔停止」按钮切换（官方同款）。

### 3.3 Host 半边要点
- **类型化 Remote**：用 `dsh-typert-protocol` NSC 声明 `bots` 命名空间（返回 `{ok:true,value}|{ok:false,error}` 信封，与现契约兼容）。
- **SSE 环形缓冲**：`ctx.shell.start` 常驻 `curl -sN --compressed -H "authorization: Bearer $TOKEN" .../events`，
  增量解析入环形缓冲，`bots.eventsSince(seq)` 让 Client 拉增量（推荐路径 a，替代 3s 轮询）。
- **发现/活性**：保留 `readDiscovery` + `/health` pid 比对 + `callGateway` 每次重读（自愈，已实证 §12-23）。
- **常驻**（M4）：固定 `SAND_HOST_PORT` + 进程守护，`bots.gatewayInfo` 报告地址/PID/忙闲。
- **自检**：boot 时 discover + listAgents 写 diag，失败原因分级（no-gateway-json / health-http / stale-gateway-json）。

---

## 4. UI 重设计（交互对齐 dsh 原生）

### 4.1 工作台三栏（与原生布局同构，非浮层墨坞）
| 栏 | 内容 | 原生词汇 |
|---|---|---|
| 左（≈260px） | 分区可折叠树：**Bots**（bot/群，含运行态角标）/ **最近会话** / **模型**入口 | 原生 sectionHeader + projectRow/sessionRow 语义 |
| 中 | 选中 bot/群的**会话流**：气泡 + 工具卡片 + 进行中流式 | `gdEzaW_*`/`Sxvs8a_*` 视觉语义 |
| 右 | 选中项的**详情**：bot 资料编辑 / 群成员 / 会话大纲（outline） | 原生 detailsCol 卡片 |

### 4.2 交互词汇（全用原生）
- **入口**：侧栏底部原生「Bots」按钮（footer.action）；关闭 `Esc` / 点侧栏其他区域。
- **会话流**：用户右对齐气泡、助手左对齐无气泡 `16px/28px`；流式尾部 `▊`；工具事件渲染为**卡片**（client-side-tool-v2）可折叠。
- **消息时间**：每条用户/助手消息与工具卡片带 `HH:MM` 回复时间（tertiary 12px，hover 出完整日期）；跨天插入「今天/昨天/M 月 D 日」分隔条；流式中的尾条不打时间戳。
- **Composer**：原生输入卡；空态发送钮置灰，生成中变**停止方块**；`@名字` 触发**成员补全菜单**（群聊定向）；Enter 发送 / Shift+Enter 换行。
  输入框随内容**自增高**（上限 `--dsh-composer-text-max-height`，超出由卡片滚动），点卡片任意留白落光标，发送/切换会话后自动聚焦；
  **中文输入法候选窗开启期间不响应 Enter/方向键/Esc**（`isComposing` + `keyCode 229` 双信号），补全菜单的 Esc 不外泄给关闭聊天的全局键。
- **状态色**：运行中 `--dsw-alias-button-info-fill`（发送钮）、工具执行 `--dsw-specific-bubble` 卡片、错误 `--dsw-alias-state-error-primary`、
  完成 `--dsw-alias-state-success-primary`、冷却/告警 `--dsw-alias-state-warn-primary`。
- **头像**：`/avatars/<id>` 独立 GET（相对 baseUrl）；群头像叠成员首字符。
- **空态/加载**：沿原生 placeholder 文案语气（「选择或创建一个 Bot 开始」/「连接中…」）。
- **模型/网关状态**：坞底一行（在线 ·:port · token · 忙/闲）+ 设置页完整卡（复用现有 setrow/setcard，去哈希化）。设置页完整信息架构见 §4.4。

### 4.3 与原生对话流的关系（架构红线保持不变）
- 不混入 dsh 会话对话流；bot 聊天走 sdk-bots transcript，UI 独立于原生会话，经 `shell.overlay` 承载。
- **不注册 `conversation.view` 第三标签**（理由见 §2.3）——Bot 工作台自成一景。

### 4.4 设置页信息架构（v2 提案，2026-09-02）

> 现状：`settings.section` id `bots` 只有「摘要 + 网关状态卡 + dataDir/SSE/入口」约 6 行（`src/client.ts` `BotsSettings`）。
> 本节把它整理为七个分区，每一行都锚定真实数据源（网关 API / 插件配置 / SSE 频道），并标注性质与优先级。

**四条设计原则**：

1. **只放全局与低频**——bot 级配置（per-bot 模型钉定等）归工作台详情栏，高频操作不进设置页；设置页不是开关仓库，每个条目必须有真实消费方。
2. **每行标注性质**——`[只读状态]` / `[可写配置]` / `[跳转]` / `[动作]` 四类，渲染样式与交互随之不同。
3. **失败可解释、可行动**——离线/异常不给裸错误码，给「原因分级 + 建议动作」。
4. **分层披露**——高级项用 `DisclosureRow` 折叠收起，默认只露健康面。

**A. 网关与连接**（现有卡增强）

| 条目 | 性质 | 数据源 | 优先级 |
|---|---|---|---|
| 运行状态（在线/离线、地址、PID、忙闲、鉴权） | 只读 | `bots.gatewayInfo`（discover + `/health` pid 比对） | 已有 |
| 失败原因分级文案：`no-gateway-json` / `health-http` / `stale-gateway-json` / 401，各配一句处置建议 | 只读+文案 | `gatewayInfo.reason`（§3.3 自检分级） | **P0** |
| 生命周期：启动 / 重启 / launchd 守护状态（`com.sdk-bots.host` KeepAlive） | 动作 | M4 常驻进程守护 | P1 |
| 端口策略展示（动态 vs `SAND_HOST_PORT` 固定） | 只读 | `gatewayInfo` + 环境变量 | P1 |
| 「打开网关控制台」 | 跳转 | `GET /`（网关内置单页 console） | **P0** |
| 「复制诊断摘要」 | 动作 | 前端拼装当前状态快照 | **P0** |

**B. 模型与推理**（现状完全缺失，价值最高）

| 条目 | 性质 | 数据源 | 优先级 |
|---|---|---|---|
| 当前推理目标：`auto` / 钉定模型 | 只读→可写 | 网关 `getHostSettings` / `setHostSettings`（`inferenceProvider`，host 级） | **P0 读** / P1 写 |
| 模型选择下拉（`auto` + freeroute 模型池） | 可写 | `GET /freeroute/v1/models`（§4.2 已验证首项 `auto`） | P1 |
| 工具授权策略 `localToolPermission`（`always` / `ask`） | 可写 | `setHostSettings`；`ask` 需要 `resolveLocalToolPermission` 交互 UI（M5），先只读展示 | P0 读 |
| 模型目录 / 密钥 / 路由 / 冷却轮换 → 跳 dsh 设置页「模型」 | 跳转 | 职责边界（§3）：那些归 dsh freeroute，本页不重复造 | **P0** |
| 推理链路一行图：sdk-bots → dsh freeroute(:3080) → 上游池 | 只读 | 静态 + `gatewayInfo` | P1 |

**B⁺. MCP 服务器**（2026-09-02 追加；引擎侧已成品，方案与分期见 DEVELOPMENT.md §13）

| 条目 | 性质 | 数据源 |
|---|---|---|
| 服务器列表（StateDot: connected/needsAuth/error + toolCount + transport） | 只读 | 网关 `listMcpServers` |
| 添加服务器（stdio command / 远程 URL 两栏） | 可写 | `addMcpServer {name, configJson}` |
| 删除 / 重启 / 自定义指令查看 | 动作 | `removeMcpServer` / `refreshMcp` |
| 工具浏览与试运行 → 放工作台详情栏（不在设置页） | 动作 | `listRoutedMcpTools` / `executeRoutedMcpTool` |
| 聊天内自助安装 → 零开发，只补 connector card 渲染 | 只读 | transcript + `client-side-tool-v2` |

**B⁺⁺. Bot 工作区隔离**（2026-09-02 追加；引擎已有 Seatbelt jail，方案见 DEVELOPMENT.md §14）

| 条目 | 性质 | 数据源 |
|---|---|---|
| 每 bot 隔离状态行（StateDot + slug + allowPaths 数）+ 开启/解除 | 可写 | `bots.workspaceList/Get/Set`（写 agents/<id>/settings.json） |
| 工作区根目录展示 | 只读 | `gatewayInfo.workspaceRoot` |
| 生效语义说明（下 turn 生效、读不受限、同名共享目录） | 只读文案 | 静态 |

**C. 数据与沙盒**

| 条目 | 性质 | 数据源 | 优先级 |
|---|---|---|---|
| `dataDir`（cordis.yml 配置的生效值，非硬编码默认） | 只读 | `Config` + `gatewayInfo.dataDir` | 已有 |
| 打开数据目录 / 复制路径 | 动作 | 路径已具备 | P1 |
| 沙盒状态：box exec-daemon(:1337)、`box-disk-pressure` / `forever-box` 告警 | 只读 | SSE 频道（§8） | P1 |
| 磁盘占用（transcripts / attachments / box-workspace） | 只读 | 网关暂无现成 API，开放项 | P2 |

**D. 实时事件**（现有行增强）

| 条目 | 性质 | 数据源 | 优先级 |
|---|---|---|---|
| SSE：running / buffered / total / lastError / connectedAt | 只读 | `bots.sseState` | 已有 |
| 「重连」动作（stop + start） | 动作 | `GatewaySseClient` | **P0** |
| 订阅频道列表展示 | 只读 | 客户端已声明 channels | P1 |

**E. 工作台偏好**——**刻意留空**。没有真实需求不预先堆开关（默认展开组、时间戳显隐等均无消费方）；有需求时按原则 1 逐项补。

**F. 诊断与关于**

| 条目 | 性质 | 数据源 | 优先级 |
|---|---|---|---|
| 插件版本 + cordis range 兼容警告 | 只读 | `PLUGIN_VERSION` / `TESTED_CORDIS_RANGE` | **P0** |
| 一键自检（discover + `listAgents`，结果写 diag） | 动作 | `bots.diag` + `bots.list` | **P0** |
| diag 文件位置 + 打开 | 只读+跳转 | `<dataDir>/dsh-bots-diag.jsonl` | P1 |
| 网关协议规模（126 命令表） | 只读 | 静态 | P2 |

**G. 引导**（首用/排障双用途）

- 三步引导：① 确认网关在线（本页 A 卡）→ ② 从侧栏「工作区 ｜ Bots」打开工作台 → ③ 新建第一个 Bot。
- 高级环境变量参考（`DisclosureRow` 折叠）：`SAND_DATA_ROOT` / `SAND_HOST_PORT` / `SAND_GATEWAY_TOKEN` / `SAND_OPENROUTER_MODEL`（§9 表）。

**横切交互规则**：

- `setHostSettings` 是 host 级写操作（影响全部 bot）：二次确认 + 明示影响面 + 失败回显。
- 已有 `host-settings` SSE 频道监听（`client.ts:961` `refreshInfo`）——设置页读写后全 UI 自动刷新，别再另建轮询。
- i18n 全走 `settings.*` 键，zh/en 双份；组件只用 primitives（`StateDot`/`Button`/`DisclosureRow`/`Input`/`Pill`）+ `--dsw-*` 变量。
- P0 合计约 10 个新条目、1 个新 RPC 通道（host settings 读写），不依赖网关侧改动，可随下个小版本落地。

---

## 5. 里程碑重切（在现有 M1 基础上收敛）

| 里程碑 | 内容 | 关键改动 |
|---|---|---|
| **M1.5 收敛**（本次） | 动态 → 正式插件骨架；RPC 梳理为类型化 `bots` 命名空间；UI 去哈希化用 CSS 变量；`sidebar.footer.action` 入口 | `src/` 重组为 gateway/host/client；新增 `cordis.patch.yml` 正式 insert；补齐正式 client peer deps |
| **M2.5 实时** | Host SSE 环形缓冲 + `bots.eventsSince`；聊天流/工具卡片/@提及补全 | 去掉 3s 轮询 |
| **M3.5 管理** | bot/群 CRUD 免 reload、头像、outline 详情栏 | 复用网关 API（已证实战） |
| **M4 产品化** | sdk-bots 常驻（固定端口 + 守护）+ 一键启动；`cordis_define` 只是 dev 入口 | 正式插件发布 |
| **M5 增强** | per-bot 模型（SDK agent.model 通道）、附件/知识库、automations、MCP 工具 UI | 按需 |

---

## 6. 风险与待确认

| 项 | 说明 | 处置 |
|---|---|---|
| ~~正式 client 依赖版本~~ | **已证伪**：slots/primitives 在磁盘上是悬空软链，只存在于 web bundle 的 staticModules | 经 `__ModuleLoader__` 的 `require` 取用，**不加 peer dep**（见 §2.5 更正） |
| `shell.overlay` 布局 | 原生载入层是 `absolute;pointer-events` 层，工作台需自行安排左侧定位 | M1.5 小步验证（仅迁入口 + 卡片样式） |
| SSE 鉴权 gzip | `curl -sN --compressed` + Bearer header（§8 实测）；断线 `retry:1000` | Host 侧已具备条件 |
| 哈希类名退役 | 正式插件若仍想 100% 原样可局部借用，但默认走 primitives | 以 CSS 变量为准 |
| 是否保留调试药丸 | 正式版去掉，只留设置页「打开工作台」 | 默认移除 |

**待你确认的决策**：
1. 是否按本文档先做 **M1.5 收敛**（正式插件骨架 + 类型化 `bots` 命名空间 + 去哈希 UI）？
2. 工作台入口是否统一走 `sidebar.footer.action`（丢弃右下角药丸）？
3. `conversation.view` 第三标签是否确认不做（理由见 §2.3）？
