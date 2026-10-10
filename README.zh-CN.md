<div align="center">

# dsh-bots

**DeepSeek Harness (dsh) 多 Bot 工作台** ——
把 sdk-bots 编排网关桥接进 dsh web 外壳：单聊、群聊、转录流、实时事件，UI 与官方风格一致。

[![npm](https://img.shields.io/npm/v/dsh-bots?logo=npm&color=cb3837)](https://www.npmjs.com/package/dsh-bots)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Cordis](https://img.shields.io/badge/cordis-%5E4.0.1-blue)](./package.json)

[English](./README.md) · 简体中文

</div>

---

**dsh-bots** 是一个正式的 Cordis插件（宿主 + 客户端双半边），服务于 `dsh` web 配置。它在侧边栏
挂载一个工作台，让 sdk-bots 蜂群里的每个 Bot 都触手可及——和单个 Bot 对话、用 @提及指挥群聊
剧组、看转录随 SSE 实时滚动、不离开外壳就能管理每个 Bot 的工作区沙盒。

## ✨ 功能

**工作台侧栏**

- 「工作区 ｜ Bots」双分组可折叠导航，完全对齐原生侧栏交互（悬停操作、chevron 折叠、手风琴
  展开、网关状态圆点）
- 群聊 / 单聊分区，悬停（或键盘聚焦）浮现 `+`（新建）与 `⋯`（更多操作）菜单；分区为空时 `+` 常显；引擎未连接时两个分区不展示，侧栏收起为重连卡片
- 未读徽章（插件自有已读模型：SSE + 转录重放对账）、生成中指示

**对话**

- 聊天显示在 dsh 原生主面板；弹窗仍使用 overlay
- 完整聊天界面：日期分割线、贴底滚动 + 跳到最新、IME 安全输入框、同作者连续发言合并
- 历史记录按需加载：首屏只取最新一页，滚到顶部（或点「加载更早的消息」）沿引擎游标向前翻页
- 实时更新：新消息直接从事件流合并，生成中约每秒 4 次刷新，不再每个事件重拉整段转录
- 草稿按会话保存在本浏览器，切换会话、刷新页面后仍在
- 群聊发言调度：@提及定向回复、一跳接力、`@全员` 全员唤醒——由引擎的 responder 选举驱动；运行状态行显示当前正在回复的成员
- Markdown 渲染、带状态圆点的工具调用卡片、思考块
- **停止生成**：输入框发送键在生成中变形为停止方块，直连网关 `interruptAgent`
- 本地文件：Bot 提到的图片内联预览；消息里的文件路径显示为原生文件标签，点开后在**对话右侧停靠预览面板**（dsh 的 Markdown / 代码 / PDF / 图片渲染器，可全屏查看，窄窗口下覆盖对话区）——始终停留在当前 Bot 对话。**绝不直接执行 Bot 生成的文件**；支持工作区相对路径、`/workspace/<名称>` 与中文路径
- 头像随会话状态切换动画（群聊头像由成员头像组成），执行计时基于引擎起点，切换会话与刷新页面后保持连续
- 输入框 **+** / `/` 指令菜单：添加图片或调用技能，与原生输入框的指令一致

**共享技能**

- DSH、Agents、Codex 与内置技能可共享给所有 Bot 和群聊，聊天中通过 `@` 选择
- **共享需确认**：共享的技能会作为指令交给每个 Bot，所以新发现的技能先进入「待确认」，在设置页勾选后才共享；插件内置技能默认共享；每个技能显示来源路径与内容哈希，共享后内容有改动会标出
- 设置页安装完整的本机或 GitHub 技能目录，Bot 也可通过 `update_state` 自行安装
- 内置金融技能动态获取行情，明确数据来源、时间与失败原因
- 关联引擎更新要求见[共享技能与会话连续性](./docs/session-continuity-and-shared-skills.md)

**目标即对话**

- 没有单独的「目标」模块：直接在对话里交代要做成什么，Bot 会自己建例行任务推进
- 有例行任务的会话在聊天栏显示一个纯图标的时钟；点开是例行任务浮层，列出每个成员的例行任务、下次运行时间与上次是否失败（只读——例行任务由 Bot 在对话里自己管理）

**管理**

- **会话设置**（聊天栏右上角齿轮）：改名、简介、工作区隔离编辑器
- 群聊**管理成员**（checkbox 名单编辑器，默认 8 人、引擎硬上限 16 人）
- 分区 header 新建 Bot / 群聊；删除带确认弹窗
- 设置页 Bots 卡片：网关健康、数据目录、SSE 状态、工作区列表、MCP 服务器与工具

**底层**

- 宿主半边：`TypertRemoteService` 桥接网关 RPC 端点 + SSE 代理、文件预览读取（白名单内分页读取）
- 宿主过期提示：宿主代码的构建指纹同时写入两半边，dsh web 仍跑着旧宿主时，侧栏底部出现与 dsh 自身更新提示同款的品牌色状态药丸，提示重启
- 客户端半边：纯 JS React 走 Cordis Slots（无构建产物依赖），中英双语
- 每个 Bot 的工作区监狱（macOS Seatbelt）编辑：根目录 + 额外可写路径

## 📦 安装

前置要求：

- `dsh` 与 web 配置（插件在 Cordis `^4.0.1` 上测试）
- 一个运行中的 [sdk-bots](https://github.com/dushaobindoudou) 宿主网关（默认发现：
  `~/.dsh-bots/gateway.json`，自动回退旧版 `~/.sdk-bots/gateway.json`）
- 引擎 `multibot-sdk` **≥ 0.6.0** —— 本插件依赖的线协议（`attachmentPaths` 图片通道、
  `user-attachment` 转写条目、转录 `beforeSeq` 翻页、按 Bot 的 `modelId`、技能包安装、单次 `@at` 定时任务）在该版本前落地；以可选 peer（`^0.6.0`）
  声明：引擎独立进程运行，不应被打进插件的依赖树

```bash
# 从 npm 安装
dsh plugin --profile web add dsh-bots

# 或从本地打包安装
pnpm pack
dsh plugin --profile web add ./dsh-bots-*.tgz
```

然后重启 `dsh web` 并刷新页面。工作台出现在侧栏第二个分组；设置页多出 **Bots** 卡片。

> ⚠️ **两半边加载陷阱**：插件客户端半边每次页面加载都现读，但宿主半边只在 `dsh web` 启动时
> 加载一次。升级后 UI 改动刷新即可；宿主 RPC 有变化时必须重启 `dsh web`（否则新 UI 打旧
> host，新端点 404）。升级 dsh 本身后也必须重启 `dsh web`，避免旧进程加载新版客户端包后出现
> `Failed to load plugins` 和缺失 `shortcuts` 等服务的错误。

## ⚙️ 配置

插件只有一个配置项（随 `cordis.patch.yml` 下发）：

| 配置 | 默认值 | 说明 |
|---|---|---|
| `dataDir` | `~/.dsh-bots` | 存放 `gateway.json` 与插件自有状态。引擎迁移完成前，发现逻辑自动回退旧版 `~/.sdk-bots`；未读账本、工作区操作、媒体白名单都跟随网关真实所在目录。 |

```yaml
# cordis.patch.yml（随包分发；插件装入 profile 时应用——
# 网关不在默认位置时在这里改 dataDir）
- insert:
    - id: bots
      name: dsh-bots
      config:
        dataDir: '~/.dsh-bots'
```

## 🚀 使用

| 任务 | 操作 |
|---|---|
| 打开对话 | 点击单聊中的 Bot 或群聊中的群 |
| 交代目标 | 在对话里直接说要做成什么（如「每天早上把日报发到群里」） |
| 查看成员在做什么 | 聊天栏 ⏱ 时钟浮层（纯图标；有例行任务时才出现） |
| 预览 Bot 生成的文档 | 点击消息里的文件标签（在对话右侧打开，× 或 Esc 关闭） |
| 共享新技能 | 设置页 → Bots → 技能 → 勾选「新发现」的技能 → 保存共享设置 |
| 让群里某人回话 | 输入 `@` 选成员；`@全员` 唤醒所有人 |
| 停止生成 | 点击 ⏹ 方块（生成中替换 ▲ 发送键） |
| 改名 / 工作区隔离 | 聊天栏右上角齿轮 |
| 增删群成员 | 群聊聊天栏右上角「管理成员」 |
| 新建 / 刷新 | 悬停分区 header → `+` / `⋯` |
| 折叠分区 | 点击分区 header 行 |
| 网关健康 & MCP | 设置页 → Bots 卡片 |

**工作区隔离**（仅单聊 Bot）：设置工作区根目录后，Bot 的 Shell 写入被 macOS Seatbelt 限制在
工作区内（读取不受限，同名 Bot 共享目录，下一轮对话生效）。根目录留空 = 不启用。额外可写路径
接受逗号分隔列表。

**群成员上限**：引擎硬性限制每群 **6 人**，超限名单会被静默截断——成员编辑器会把上限明示出来，
不让保存假装成功。

## 🏗️ 架构

```
┌────────────────────────── dsh web ──────────────────────────┐
│  shell ── Slots: sidebar.workspaces（影子替换）              │
│               main（Bot 聊天）                               │
│               shell.overlay（弹窗）                          │
│               settings.section（Bots 卡片）                  │
│                      │ botsCall RPC（无损 JSON）             │
│  ┌─────────────────── Host半边 ────────────────────────┐    │
│  │  TypertRemoteService · RPC 桥接 + 文件预览            │    │
│  │  SSE 代理（3k 环形缓冲）· 未读模型                   │    │
│  └──────────────────────┬────────────────────────────┘    │
└─────────────────────────┼──────────────────────────────────┘
                          │ HTTP + SSE（回环 token 鉴权）
              ┌───────────▼───────────┐
              │  sdk-bots 网关 :7331    │  ← 单 Bot · 沙盒群 · MCP
              └────────────────────────┘
```

- **Host**（`src/index.ts`、`src/gateway.ts`、`src/sse.ts` 等）：网关发现与调用（gateway.json
  优先；记录丢失时按 plist 固定端口 `/health` 兜底探测并自愈回写，重连对「已加载但不应答」的
  任务执行 `kickstart -k`）、SSE 环形缓冲
  （重连 + 转录重放对账，转录事件附带展示形态的条目）、未读账本、文件预览
  `readImage`/`readText`/`readBytes`/`revealFile`（realpath 白名单 fail-closed，从不交给系统打开）、
  诊断文件。`src/skill-bridge.ts` 负责技能共享的确认状态与内容哈希。
- **Client**（`src/client.ts`）：整个 UI 在一个工厂里——侧栏导航、聊天界面、六个弹窗、设置
  卡片——通过 Cordis Slots 注册，中英双语字典。

## 🧪 开发

```bash
pnpm install
pnpm build             # tsc 宿主 + 客户端
pnpm test              # vitest
pnpm test:integration  # 校验宿主 RPC 端点
pnpm test:browser      # 隔离浏览器交互回归；需要本机 Chrome
pnpm test:dsh-smoke    # 插件在真实 dsh profile 内加载
```

发布流程：build → test → integration → bump → pack → `dsh plugin --profile web add` →
verify → commit → push → `npm publish --access public`。

项目文档：[DESIGN.md](./DESIGN.md)（架构决策）· [DEVELOPMENT.md](./DEVELOPMENT.md)（工程日志
与踩坑记录）。

## 📄 许可

[MIT](./LICENSE)
