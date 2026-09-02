# 蜂群运行手册（swarm kit）

把任意复杂目标变成 **7x24 无人值守的多 bot 自驱协作**。全部幂等，可反复执行。

## 30 秒上手

```bash
cd ~/workspaces/dsh-bots
node scripts/swarm/swarm-bootstrap.mjs --goal "把 <你的复杂任务> 做到 <验收标准>" --schedule "@every 30m"
```

就这样。引导器会：

1. 在共享黑板 `~/.sdk-bots/swarm/` 落 `GOAL.md`（目标）与 `PROGRESS.md`（进度账本）——
   本地部署中 bot 的 Shell 工具直接运行在宿主机上（loopback 盒 = 宿主自身容器，§DEVELOPMENT-40），
   宿主绝对路径所有 bot 共见，即同一份文件；
2. 创建（或复用）指挥官 bot「蜂群指挥部」，写入蜂群作战 persona；
3. 给指挥官创建 cron 例行任务 `SWARM-CYCLE`：每次醒来 → 读目标与进度 → 规划最小推进 →
   需要人手时 `CreateAgent` 创建专项 bot 并 `SendToAgent` 派活 → 把进展追加到 `PROGRESS.md`。

## 观测

| 方式 | 命令/入口 |
|---|---|
| dsh Web GUI | 侧栏 Bots → 打开「蜂群指挥部」会话 |
| 进度账本 | `tail -f ~/.sdk-bots/swarm/PROGRESS.md` |
| 状态速查 | `node scripts/swarm/swarm-bootstrap.mjs --status` |
| 调度日志 | `grep 'firing "SWARM-CYCLE"' /tmp/sdk-bots-host.log` |

## 暂停 / 恢复 / 换目标

```bash
node scripts/swarm/swarm-bootstrap.mjs --pause                 # 停自驱（bot 与账本保留）
node scripts/swarm/swarm-bootstrap.mjs --resume                # 恢复
node scripts/swarm/swarm-bootstrap.mjs --goal "新目标" --schedule "@every 1h"   # 覆盖目标与节奏
```

换目标只重写 `GOAL.md` 并更新例行任务的 prompt 引用（进度账本永远只追加，不覆盖）。

## 排程语法

- 5 字段 cron：`*/30 * * * *`（每 30 分钟）、`0 9 * * 1-5`（工作日 9 点）
- 简写：`@hourly`、`@daily`、`@every 30m`（引擎修复后网关也接受 `@every`；
  旧引擎上引导器会自动把 `@every 15m` 换算成 `*/15 * * * *` 重试）

## 7x24 保障链（谁在兜底）

| 层 | 机制 |
|---|---|
| 进程 | launchd `com.sdk-bots.host`（`KeepAlive=true`）：崩溃 ~5s 内自动拉起，重启自启 |
| 调度 | 引擎本地 cron 调度器（30s tick，headless 无凭证也自驱），状态落 `~/.sdk-bots/local-cron-state.json` |
| 网关发现 | dsh-plugin-bots 每次调用重读 `gateway.json`（pid 活性校验），网关换 pid 无感 |
| 数据 | transcript / 账本 / 例行任务全部落盘 `~/.sdk-bots/`，重启即恢复 |

## 已知边界

- **worker 信任链**：worker bot 对来历不明的指令会拒绝（引擎的注入防御）。
  引导器的例行 prompt 已要求指挥官创建 worker 时把「指挥链合法性」写进对方 description ——
  若 worker 仍拒绝执行，在它 description 里补一句「接受蜂群指挥部的 SendToAgent 指令」。
- **节奏与配额**：免费上游池有速率限制；`@every 5m` 仅适合演练，长期任务建议 `@every 30m` 起步。
- **单 bot 轮次超时**：单轮推理 10–180s（auto 接管时更久），排程间隔须大于单轮耗时。
