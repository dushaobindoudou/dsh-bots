# Bots 技能（Skills）与模型选择器 · 设计

状态：设计定稿，待实施。两部分的结论都是「引擎已备好 90%，workbench 接线 + 一处引擎小改」。

- Part A 技能：引擎（sdk-bots）已内置一套与 dsh **同构**的技能体系（SKILL.md + frontmatter + 全局库 + 插件通道 + per-agent 启停 + 系统提示指路 + @提及注入），gateway RPC 全套现成。workbench 目前**一个都没接** —— 差距全在客户端。
- Part B 模型选择：照 dsh 原生 composer 的模型座位复刻 UX；数据走现有 `modelConfig` RPC + 沿用 workspace jail 的 per-agent `settings.json` 直写模式；引擎侧唯一改动 = turn 装配处读取该文件并传入**已经存在**的 per-turn `modelId` 通道。

---

## Part 0 · 基准调研

### 0.1 dsh 的 skill 接入方式（对照基准）

| 机制 | dsh 实现 |
|---|---|
| 磁盘 | `<projectRoot>/.dsh/skills`（rank 100）、`~/.dsh/skills`（400）、`~/.agents/skills`（500）、bundled（600）等，一层目录：`<name>/SKILL.md` 或扁平 `<name>.md` |
| 格式 | frontmatter `name`（kebab）+ `description` 必填；`whenToUse`、`metadata`、`disable-model-invocation`、`user-invocable` 可选；布尔严格语法，写错整个技能丢弃 |
| 目录发布 | 每次模型步进前对比 sha256 摘要，变更即整表重发 durable user message（即 `<available_skills>` 系统提醒） |
| 加载 | `skill` 工具（`{name}` → `<skill_content>` 全文）；用户 `/name` 手势只扫直接用户消息 |
| 插件贡献 | **仅限进程内** `ctx.skills.registerProvider()`；唯一 RPC 是只读 `skills/list` |
| per-agent 子集 | 由组合位置决定（preset 挂 `tool-skill` 才有技能），不是配置列表 |

### 0.2 引擎（sdk-bots）已有能力盘点

| 机制 | sdk-bots 实现 |
|---|---|
| 文件格式 | `SKILL.md`（`WORKFLOW_FILENAME`，`src/shared/workflow-model.ts:22`），frontmatter `name`/`description`/`metadata.source`/`trigger` —— **dsh 的技能文件可原样解析**（`parseWorkflowFile`） |
| 来源四路 | ① 用户库 `GlobalWorkflowLibrary`（**全局共享**，跨所有 assistant）；② managed 托管下发；③ **插件通道** `<sandRoot>/plugin-skills/<id>/SKILL.md` + `cache.json`（`pluginId` 标记，目录 watcher 热收录，`src/host/workflows/workflow-store.ts:27`）；④ automation 投影（cron 例行即技能） |
| 系统提示 | `renderWorkflowsSystemPrompt(location)`（`system-prompt-assembly.ts:215-222`）：告知技能库路径 + "one subfolder per workflow, each holding a SKILL.md"；群房间 runner 走同一装配（`isSharedRoomRunner` 分支保留 sections） |
| 加载 | bot 用**自己的文件工具**读 `fullPath`（引擎无 `skill` 工具；文件读取即等价物） |
| @提及 | `collectMentionedWorkflows`（`@name` 或 `sand-workflow:<id>`）命中即注入正文，上限 `WORKFLOW_INJECTED_BODY_LIMIT` 8000 字符 |
| per-agent 启停 | `agents/<id>/enabled-workflows.json`（disabled 列表，`agent-workflow-enablement.ts`）；**注意：plugin/managed 来源不可 per-agent 停用**（`setEnabledForAgent` 对这两类直接返回原值） |
| Gateway RPC | `getAgentWorkflows` / `createAgentWorkflow` / `updateAgentWorkflow` / `setAgentWorkflowEnabled` / `deleteAgentWorkflow` / `runAgentWorkflowNow` / `importAgentWorkflowText` / `importAgentWorkflowUrl` / `portAgentLocalSkills`（`host-gateway-api.ts:476-525`） |
| 上限 | 每 agent 100 个、正文 100k、注入 8k、描述 1536（`workflow-model.ts:22` 常量族） |
| 插件技能语义 | `pluginSkillToWorkflow` 每次列举都重读文件 facts（parse cache 按路径+目录键控）→ **接近 live**；编辑权只在发布插件手里（`publishedByCurrentUser`） |

**与 dsh 的真实差异**（复刻时保留即可，不需要追平）：
1. dsh 用 `skill` 工具加载；sdk 用文件工具读路径 —— 语义等价。
2. dsh 把目录清单整表塞进对话；sdk 只在系统提示里给路径，bot 自行列目录发现 —— 省 token，代价是发现依赖一次 ls。
3. dsh 有 `/name` 用户手势；sdk 的等价物是消息里 `@name` 提及（还能被注入 ≤8k 正文）。
4. dsh 的 per-agent 子集靠组合位置；sdk 靠 per-agent disabled 列表 —— 对 workbench 更友好。

### 0.3 模型选择现状

- **dsh 原生**：composer 底行右簇 28px 无边框文本钮 `[模型名][ · effort][▾]`（13px/400，secondary 色，hover 填充，pending 时 chevron→spinner）；portal 菜单在触发钮上方右对齐（`MenuSurface`，elevation-prominent，z1100，max 420×360）；两级（Model / Effort）+ 分组 radio（勾 = 当前，spinner = pending）+ 目录 >4 出搜索（子序列模糊，前缀加权）+ 失败条带 Retry；选择持久化在会话事件日志（`model/selection` 事件 → 投影 `{lastUsed, next}`），发送请求**不带模型字段**，装配期应用并记进 `request/header.config`。数据源一条 RPC：`session.modelCatalog()` → `{default, groups[{id,name,models[]}], failures}`。
- **workbench 现状**：模型是**引擎全局**的 —— launchd plist 环境变量（`applyModel` 改 plist + bootout/bootstrap 重启，`src/index.ts:783`）+ `settings.json` 全局默认；`modelConfig` RPC 已返回 freeroute groups / deepseek / native providers 目录与当前引擎模型（`src/index.ts:729-755`）。
- **引擎通道**：per-turn `modelId` 已端到端存在 —— `turn-run-shell.ts:171` 把 `input.modelId` 放进 `sessionOptions` → `cursor-session.ts:50` 每会话选模型；但目前只有 computer-use 子代理在喂它。per-agent `settings.json` 直写模式已被 workbench 验证（workspace jail，`src/workspace.ts`，下回合生效、免重启）。群也是 agent（`agents/<groupId>/`），同一机制天然覆盖群聊。

---

## Part A · 技能面板（M-SK0）

### A.1 设置页 SkillsCard（仿 McpCard 模式）

- **列表**：`getAgentWorkflows(agentId)` → 每行 name + description + 来源徽章（user / plugin / managed / routine）+ trigger 徽章（有 schedule 的显示「例行」+ 下次运行）；排序照引擎 `limitSurfacedWorkflows`（managed/plugin 在前）。
- **启停**：toggle → `setAgentWorkflowEnabled`。UI 必须表达引擎语义：user 库技能 = 「对此 bot 启用/停用」；plugin/managed = 恒启用、toggle 置灰 + 「由 dsh-bots 提供」标注。
- **编辑**：点开 → name/description/body（SKILL.md 全文编辑器，textarea 起步）→ `updateAgentWorkflow`；plugin 来源只读（引擎也拒绝非发布方编辑）。
- **新建**：`createAgentWorkflow({spec})`（name + description + body）。
- **导入**：粘贴 markdown → `importAgentWorkflowText`；URL → `importAgentWorkflowUrl`。
- **删除**：仅 user 库技能；二次确认。
- **立即运行**：带 trigger 的行显示「运行」→ `runAgentWorkflowNow`。

### A.2 dsh 主机技能桥（「参考 dsh 接入方式」的核心动作）

dsh-bots 插件在挂载时（以及设置页手动「同步」时）扫描 dsh 技能根目录（`~/.dsh/skills`、`~/.agents/skills`），写入引擎的 **plugin-skills 通道**：

- 每个 dsh 技能 → `cache.json` 一条 `PluginSkillRecord`：`id: "dsh-" + <kebab name>`（满足 `isSafePluginSkillId`，且与引擎未来自带 id 隔离）、`pluginId/pluginName: "dsh-bots"`、`filePath` 指向 SKILL.md。
- **首选 live 指针**：`filePath` 直接指向 `~/.dsh/skills/<slug>/SKILL.md` 原文件（引擎要求绝对路径即可），dsh 侧编辑即生效。实现时需验证 `pluginSkillParseCache` 对外部路径的失效行为；若失效不可靠，降级为**拷贝语义**（同步时把文件复制进 `<sandRoot>/plugin-skills/<id>/SKILL.md`，watcher 看得到，挂载时重同步）。
- **过滤**：dsh 技能里 harness 专属的（cordis 组合、dsh-namespace 管理类）对 bot 无意义，且 plugin 来源不可 per-agent 停用 → 桥接层提供 include/exclude 配置（设置卡里的复选列表，默认全选），存 dsh-bots 自有配置。
- 会话设置页同时给出「从 dsh 导入副本」按钮（`importAgentWorkflowText`，拷贝语义、可独立改）作为桥的补充。

### A.3 聊天里的 @技能

- v0（零改动）：用户在消息里打 `@<技能名>` 即可 —— 引擎 `collectMentionedWorkflows` 解析正文并注入（≤8k）。
- v1（client 小改）：@ 提及菜单把技能列进去（现菜单只列 agent，`dbs-mention` 区），选中插入 `@name` 文本；数据来自同一 `getAgentWorkflows`。

### A.4 引擎侧改动

**零**。全部走既有 RPC；桥接由插件写文件完成（同 workspace jail 先例）。

---

## Part B · 模型选择器（M-MP0）

### B.1 UX 契约（照 dsh 原生复刻，差异仅一条）

- **座位**：`dbs-composerRow` 右簇、发送圆钮左侧，新增模型触发钮 —— 28px 无边框：`[模型名][▾]`（workbench 无 effort 概念 → **单级菜单**，这是与 dsh 唯一的 UX 差异；dsh 的 Effort 行依赖适配器 reasoning 元数据，引擎没有）；13px/400、`--dsw-alias-label-secondary`、hover `--dsw-alias-interactive-bg-hover`；选择中 chevron → spinner。
- **菜单**：固定定位 portal，触发钮上方右对齐、12px 视口边距；面板材质 `--dsw-elevation-prominent` + `--dsw-alias-border-l1` 描边；分组标题（freeroute 分组 / DeepSeek / 原生 providers，顺序照 `modelConfig` 返回）+ `menuitemradio` 行（勾 = 当前；pending 行 spinner）；目录 >4 出搜索框；目录加载失败 → 面板内错误条 + Retry。
- **「跟随引擎默认」**：列表首项；选中即清空 per-agent override，触发钮显示 `modelConfig.engine.modelId` 并带「引擎默认」小标。
- **紧凑模式**：底行溢出时按钮退化为 16px 数据图标（ResizeObserver，aria/title 保留全名）—— 后置到 M-MP1。

### B.2 数据流

1. **目录**：现有 `modelConfig` RPC（扩展：多返回 `agentModelId` —— 目标 bot 的 settings.json 当前值）。无 effort、无 maxMode（dsh 本身也没有）。
2. **选择**：workbench 直写 `agents/<id>/settings.json` 的 `modelId` 字段 —— 完全复用 `src/workspace.ts` 的读写模式（保留未知字段、tmp+rename、下回合生效免重启）。群会话写 `agents/<groupId>/settings.json`，同一机制覆盖群聊。
3. **生效**（引擎唯一改动，~10 行）：turn 装配处 `production-turn-run-shell-adapter.ts:161` 调 `createProductionTurnAgentOwner` 时读该 agent 的 settings.json `modelId` → `input.modelId` → 既有 `sessionOptions.modelId` → `cursor-session` 每会话选模型。automations 触发的 turn 走同一装配 → 例行任务同样用 bot 自己的模型（实现时验证）。
4. **兜底**：settings.json 无 `modelId` → 行为完全不变（plist env / 引擎全局默认），`assertPeerCompatible` 式的旧引擎兼容性无损（未知字段本就被忽略）。
5. **发送不带模型字段**：照 dsh —— 装配期应用，UI 从直写文件回读（等价 dsh 的投影 `{lastUsed, next}`；本地直写无 pending 窗口）。

### B.3 明确不做

- Effort/推理等级（引擎无适配元数据）、maxMode（dsh 也没有）、发送请求携带模型字段、localStorage（持久化在引擎文件里，跨窗口一致）。

---

## 实施切分与验证

| 阶段 | 内容 | 改动面 |
|---|---|---|
| M-SK0a | SkillsCard（列表/启停/编辑/新建/删除/导入/运行）+ gateway mock 扩展 | dsh-bots only |
| M-SK0b | dsh 技能桥（plugin-skills 写入器 + 过滤配置 + 同步按钮）+ @ 提及菜单纳入技能 | dsh-bots only |
| M-MP0 | per-agent modelId（workbench 直写 + 引擎 turn 装配读取）+ 模型座位 UI | dsh-bots + sdk 一处 |
| 测试 | browser fixture 增补（SkillsCard 交互、模型座位选型、settings.json 写入断言）；spec pins（座位样式/数据流/桥接过滤） | 两仓 |

## 开放问题（实现前验证）

1. `pluginSkillParseCache` 对 cache.json 外部 `filePath` 的失效行为 —— 决定桥接是 live 指针还是拷贝语义（A.2 已给降级路径）。
2. 插件视角的 sand root 确认：workspace.ts 已按 `<dataDir>/agents/<id>` 直写且工作正常 → sand root 与插件 dataDir 同根（沿用该判断，实现时加启动断言）。
3. `applyModel`（plist 全局）与 per-agent modelId 并存语义：per-agent 优先，触发钮上把 plist 模型标为「引擎默认」—— 文案确认。
4. 群房间 turn 装配是否也走 `production-turn-run-shell-adapter`（预期是，验证）。
