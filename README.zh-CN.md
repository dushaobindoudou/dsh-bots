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
- 群聊 / 单聊分区，悬停浮现 `+`（新建）与 `⋯`（更多操作）菜单
- 未读徽章（插件自有已读模型：SSE + 转录重放对账）、生成中指示

**对话**

- 聊天显示在 dsh 原生主面板；弹窗仍使用 overlay
- 完整聊天界面：日期分割线、贴底滚动 + 跳到最新、IME 安全输入框、同作者连续发言合并
- 群聊发言调度：@提及定向回复、一跳接力、`@全员` 全员唤醒——由引擎的 responder 选举驱动
- Markdown 渲染、带状态圆点的工具调用卡片、思考块
- **停止生成**：输入框发送键在生成中变形为停止方块，直连网关 `interruptAgent`
- 本地媒体：Bot 提到的本地路径直接内联图片预览、文件一键打开
- 头像随会话状态切换动画，执行计时基于引擎起点，切换会话与刷新页面后保持连续

**共享技能**

- DSH、Agents、Codex 与内置技能在所有 Bot 和群聊间共享，聊天中通过 `@` 选择
- 设置页安装完整的本机或 GitHub 技能目录，Bot 也可通过 `update_state` 自行安装
- 内置金融技能动态获取行情，明确数据来源、时间与失败原因
- 关联引擎更新要求及目标进展证据协议见[共享技能与持续目标](./docs/session-continuity-and-shared-skills.md)

**持续目标（单 Bot）**

- 在「目标」页填写目标、逐条验收标准和推进间隔；引擎例行任务负责页面关闭后的执行
- 查看每轮记录与进展，暂停、恢复、退回改进或结束目标；Bot 声明达成后由用户确认验收

**管理**

- **会话设置**（聊天栏右上角齿轮）：改名、简介、工作区隔离编辑器
- 群聊**管理成员**（checkbox 名单编辑器，默认 8 人、引擎硬上限 16 人）
- 分区 header 新建 Bot / 群聊；删除带确认弹窗
- 设置页 Bots 卡片：网关健康、数据目录、SSE 状态、工作区列表、MCP 服务器与工具

**底层**

- 宿主半边：`TypertRemoteService` 桥接网关 RPC 端点 + SSE 代理，并持久化目标意图与验收状态
- 客户端半边：纯 JS React 走 Cordis Slots（无构建产物依赖），中英双语
- 每个 Bot 的工作区监狱（macOS Seatbelt）编辑：根目录 + 额外可写路径

## 📦 安装

前置要求：

- `dsh` 与 web 配置（插件在 Cordis `^4.0.1` 上测试）
- 一个运行中的 [sdk-bots](https://github.com/dushaobindoudou) 宿主网关（默认发现：
  `~/.dsh-bots/gateway.json`，自动回退旧版 `~/.sdk-bots/gateway.json`）
- 引擎 `multibot-sdk` **≥ 0.5.0** —— 本插件依赖的线协议（`attachmentPaths` 图片通道、
  `user-attachment` 转写条目、goal-guard 目标台账）在该版本落地；以可选 peer（`^0.5.0`）
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
| 创建持续目标 | 打开单 Bot →「目标」→ 填写目标与验收标准 →「开始持续推进」 |
| 验收目标 | 在「目标」页核对实际产物和进展记录，再确认验收或退回改进 |
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
│               main（Bot 聊天与目标）                         │
│               shell.overlay（弹窗）                          │
│               settings.section（Bots 卡片）                  │
│                      │ botsCall RPC（无损 JSON）             │
│  ┌─────────────────── Host半边 ────────────────────────┐    │
│  │  TypertRemoteService · RPC 桥接 + 目标工作流          │    │
│  │  SSE 代理（3k 环形缓冲）· 未读模型                   │    │
│  └──────────────────────┬────────────────────────────┘    │
└─────────────────────────┼──────────────────────────────────┘
                          │ HTTP + SSE（回环 token 鉴权）
              ┌───────────▼───────────┐
              │  sdk-bots 网关 :7331    │  ← 单 Bot · 沙盒群 · MCP
              └────────────────────────┘
```

- **Host**（`src/index.ts`、`src/gateway.ts`、`src/sse.ts` 等）：网关发现与调用、SSE 环形缓冲
  （重连 + 转录重放对账）、未读账本、媒体 `readImage`/`openFile`（realpath 白名单 fail-closed）、
  诊断文件。`src/goals.ts` 负责目标持久化、调度连接和用户验收。
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
