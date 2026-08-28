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
- **Composer**：原生输入卡；空态发送钮置灰，生成中变**停止方块**；`@名字` 触发**成员补全菜单**（群聊定向）；Enter 发送 / Shift+Enter 换行。
- **状态色**：运行中 `--dsw-alias-button-info-fill`（发送钮）、工具执行 `--dsw-specific-bubble` 卡片、错误 `--dsw-alias-state-error-primary`、
  完成 `--dsw-alias-state-success-primary`、冷却/告警 `--dsw-alias-state-warn-primary`。
- **头像**：`/avatars/<id>` 独立 GET（相对 baseUrl）；群头像叠成员首字符。
- **空态/加载**：沿原生 placeholder 文案语气（「选择或创建一个 Bot 开始」/「连接中…」）。
- **模型/网关状态**：坞底一行（在线 ·:port · token · 忙/闲）+ 设置页完整卡（复用现有 setrow/setcard，去哈希化）。

### 4.3 与原生对话流的关系（架构红线保持不变）
- 不混入 dsh 会话对话流；bot 聊天走 sdk-bots transcript，UI 独立于原生会话，经 `shell.overlay` 承载。
- **不注册 `conversation.view` 第三标签**（理由见 §2.3）——Bot 工作台自成一景。

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
