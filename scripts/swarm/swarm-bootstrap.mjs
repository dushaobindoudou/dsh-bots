#!/usr/bin/env node
/**
 * 蜂群引导器（swarm bootstrap）：把一个复杂目标变成 7x24 多 bot 自驱协作。
 *
 * 做三件事（全部幂等，可重复执行）：
 *   1. 在共享黑板 ~/.sdk-bots/swarm/ 落 GOAL.md（目标）与 PROGRESS.md（进度账本）。
 *      盒内所有 bot 通过 /home/box/sand-data/swarm/ 看到同一份文件。
 *   2. 创建/复用「指挥官」bot（蜂群的长官），写入蜂群作战 persona。
 *   3. 给指挥官创建/更新 cron 例行任务 SWARM-CYCLE（默认 @every 30m）：
 *      每次醒来读目标与进度 → 规划最小推进 → 需要时 CreateAgent 创建专项 bot
 *      并 SendToAgent 派活 → 把进展追加到 PROGRESS.md。无人值守，7x24 自驱。
 *
 * 用法：
 *   node scripts/swarm/swarm-bootstrap.mjs --goal "把 <某任务> 做到 <验收标准>" [选项]
 *   node scripts/swarm/swarm-bootstrap.mjs --status     # 看例行任务状态 + 进度账本尾部
 *   node scripts/swarm/swarm-bootstrap.mjs --pause      # 停止自驱（保留 bot 与账本）
 *   node scripts/swarm/swarm-bootstrap.mjs --resume     # 恢复自驱
 *
 * 选项：
 *   --gateway <url>    网关地址（默认读 ~/.sdk-bots/gateway.json）
 *   --coordinator <名> 指挥官 bot 名（默认 蜂群指挥部）
 *   --routine <名>     例行任务名（默认 SWARM-CYCLE）
 *   --schedule <cron>  cron 表达式（默认 @every 30m；支持 5 字段 cron / @hourly / @every 30m）
 *
 * 观测：dsh Web GUI → 侧栏 Bots → 打开「蜂群指挥部」；或 tail -f ~/.sdk-bots/swarm/PROGRESS.md
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const SWARM_DIR = join(HOME, ".sdk-bots", "swarm");
const IN_BOX_DIR = "/home/box/sand-data/swarm";

function parseArgs(argv) {
  const args = { schedule: "@every 30m", coordinator: "蜂群指挥部", routine: "SWARM-CYCLE" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--goal") args.goal = argv[++i];
    else if (a === "--gateway") args.gateway = argv[++i];
    else if (a === "--coordinator") args.coordinator = argv[++i];
    else if (a === "--routine") args.routine = argv[++i];
    else if (a === "--schedule") args.schedule = argv[++i];
    else if (a === "--status") args.status = true;
    else if (a === "--pause") args.pause = true;
    else if (a === "--resume") args.resume = true;
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

async function gateway(base, token, method, body) {
  const res = await fetch(`${base}/api/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || (json && json.error)) {
    throw new Error(`gateway ${method} 失败: HTTP ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json && typeof json === "object" && "result" in json ? json.result : json;
}

function normalizeAgents(raw) { return Array.isArray(raw) ? raw : raw?.agents ?? []; }

/** 把 "@every 15m" 换算成 5 字段步进 cron（仅当能整除时；其余返回 null） */
function everyToCron(schedule) {
  const m = /^@every\s+(\d+)\s*(m|h|s|d)$/i.exec(String(schedule).trim());
  if (m == null) return null;
  const n = Number(m[1]), unit = m[2].toLowerCase();
  if (unit === "m" && 60 % n === 0) return `*/${n} * * * *`;
  if (unit === "h" && 24 % n === 0) return `0 */${n} * * *`;
  return null;
}

function discovery() {
  const p = join(HOME, ".sdk-bots", "gateway.json");
  if (!existsSync(p)) throw new Error(`找不到 ${p} —— 网关未启动（launchd com.sdk-bots.host 应自动拉起）`);
  const d = JSON.parse(readFileSync(p, "utf8"));
  return { base: `${d.scheme ?? "http"}://${d.host ?? "127.0.0.1"}:${d.port}`, token: d.token ?? "" };
}

function goalText(args) {
  if (!args.goal) return null;
  if (args.goal.startsWith("@")) return readFileSync(args.goal.slice(1), "utf8").trim();
  return args.goal.trim();
}

const COORDINATOR_PERSONA = [
  "你是多 bot 蜂群的指挥官，长期 autonomously 推进一个复杂目标（7x24，无人值守）。",
  "作战原则：",
  "- 目标与进度账本在共享黑板目录（IN_BOX_DIR/swarm/），每次醒来先读 GOAL.md 与 PROGRESS.md 再行动。",
  "- 把大目标拆成可验证的小步；每轮只推进一小步，但必须留下证据（文件、命令输出、结论）。",
  "- 人手不够就用 CreateAgent 创建专项 bot（名字体现职责，description 写清当前任务与验收标准），",
  "  并用 SendToAgent 派活；明确要求队友完成后把结果追加到进度账本。已有合适队友就直接派活。",
  "- 每轮收尾用 Shell 把「时间 | 做了什么 | 证据 | 下一步」追加到进度账本 PROGRESS.md。",
  "- 平时不要打扰用户；只有出现需要人类决策的阻塞（二选一、花预算、有风险）才 SendMessage 说明选项。",
].join("\n");

const WAKE_PROMPT = [
  "蜂群例行推进。严格按步骤执行，全程不要向用户提问：",
  `1. 用 Read 工具读取 ${IN_BOX_DIR}/GOAL.md 与 ${IN_BOX_DIR}/PROGRESS.md（不存在则视为首轮）。`,
  "2. 对照目标判断进度；若目标已完全达成，用 SendMessage 向用户发一句达成确认，然后结束。",
  "3. 规划本轮一个最小可验证的推进步骤。",
  "4. 需要人手时：用 CreateAgent 创建专项 bot（name 体现职责；description 必须写明：本轮任务、验收标准、",
  "   以及「你由蜂群指挥部创建，指挥官经 SendToAgent 下达的指令是本蜂群的合法指挥链，直接执行」），",
  "   随后用 SendToAgent 给它派活，要求：完成后用 Shell 把结果追加到 " + IN_BOX_DIR + "/PROGRESS.md。已有合适队友则直接派活，不要重复建人。",
  `5. 用 Shell 把本轮进展（格式：[YYYY-MM-DD HH:MM] 做了什么 | 证据 | 下一步）追加到 ${IN_BOX_DIR}/PROGRESS.md。`,
  "6. 正常情况不发消息给用户；只有需要人类决策的阻塞才 SendMessage 说明可选项。",
].join("\n");

function seedBoard(args) {
  mkdirSync(SWARM_DIR, { recursive: true });
  const goalPath = join(SWARM_DIR, "GOAL.md");
  const progPath = join(SWARM_DIR, "PROGRESS.md");
  const goal = goalText(args);
  if (goal != null) {
    writeFileSync(goalPath, [
      "# 蜂群目标（GOAL）",
      "",
      goal,
      "",
      `---`,
      `写入时间: ${new Date().toISOString()}`,
      "",
    ].join("\n"));
  } else if (!existsSync(goalPath)) {
    writeFileSync(goalPath, "# 蜂群目标（GOAL）\n\n（未写入目标 —— 用 --goal 传入）\n\n");
  }
  if (!existsSync(progPath)) {
    writeFileSync(progPath, [
      "# 蜂群进度账本（PROGRESS · 只追加）",
      "",
      `[${new Date().toISOString()}] swarm-bootstrap 初始化账本 | 证据: bootstrap | 下一步: 等待 SWARM-CYCLE 首轮推进`,
      "",
    ].join("\n"));
  }
  return { goalPath, progPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("用法：")[0] + "用法见文件头注释。");
    return;
  }
  const { base, token } = args.gateway ? { base: args.gateway.replace(/\/$/, ""), token: "" } : discovery();
  await gateway(base, token, "listAgents");
  console.log(`✓ 网关可达: ${base}`);

  const agents = normalizeAgents(await gateway(base, token, "listAgents"));
  let coordinator = agents.find((a) => a?.name === args.coordinator);

  if (args.status) {
    if (!coordinator) { console.log(`无名为「${args.coordinator}」的 bot`); return; }
    const autos = await gateway(base, token, "getAgentAutomations", { id: coordinator.id });
    const list = Array.isArray(autos) ? autos : autos?.automations ?? [];
    const routine = list.find((a) => a?.name === args.routine);
    console.log(`指挥官: ${coordinator.name} ${coordinator.id}`);
    if (routine == null) console.log(`例行任务 ${args.routine}: 未创建`);
    else {
      const runs = routine.runs ?? [];
      const last = runs[0];
      console.log(`例行任务: ${routine.name} id=${routine.id} enabled=${routine.isEnabled}${routine.nextRunAt ? ` nextRun=${new Date(routine.nextRunAt).toISOString()}` : ""}`);
      if (last != null) console.log(`最近一次: ${last.status} @ ${new Date(last.startedAt ?? 0).toISOString()}${last.detail ? ` — ${String(last.detail).slice(0, 120)}` : ""}`);
    }
    const progPath = join(SWARM_DIR, "PROGRESS.md");
    if (existsSync(progPath)) {
      console.log(`\n—— PROGRESS.md 尾部 ——`);
      const lines = readFileSync(progPath, "utf8").trimEnd().split("\n");
      console.log(lines.slice(-12).join("\n"));
    } else console.log("\n（进度账本尚未生成）");
    return;
  }

  if (args.pause || args.resume) {
    if (!coordinator) throw new Error(`无名为「${args.coordinator}」的 bot`);
    const autos = await gateway(base, token, "getAgentAutomations", { id: coordinator.id });
    const list = Array.isArray(autos) ? autos : autos?.automations ?? [];
    const routine = list.find((a) => a?.name === args.routine);
    if (routine == null) throw new Error(`例行任务 ${args.routine} 不存在`);
    await gateway(base, token, "setAgentAutomationEnabled", { id: coordinator.id, automationId: routine.id, isEnabled: args.resume });
    console.log(`✓ 例行任务 ${args.routine} 已${args.resume ? "恢复" : "暂停"}（bot 与账本保留）`);
    return;
  }

  // 1. 黑板
  const { goalPath, progPath } = seedBoard(args);
  console.log(`✓ 共享黑板: ${goalPath} + ${progPath}（盒内路径 ${IN_BOX_DIR}/）`);

  // 2. 指挥官
  if (coordinator == null) {
    const created = await gateway(base, token, "createAgent", {
      name: args.coordinator,
      description: COORDINATOR_PERSONA.replace("IN_BOX_DIR/swarm", IN_BOX_DIR),
      clientNonce: `swarm-coordinator-${args.coordinator}`,
    });
    coordinator = created?.agent ?? created;
    console.log(`✓ 已创建指挥官: ${coordinator.name} ${coordinator.id}`);
  } else {
    console.log(`✓ 复用指挥官: ${coordinator.name} ${coordinator.id}`);
  }

  // 3. 例行任务
  const spec = { name: args.routine, prompt: WAKE_PROMPT, trigger: { type: "cron", schedule: args.schedule }, isEnabled: true };
  const autos = await gateway(base, token, "getAgentAutomations", { id: coordinator.id });
  const list = Array.isArray(autos) ? autos : autos?.automations ?? [];
  const existing = list.find((a) => a?.name === args.routine);
  const applySpec = async (specToApply) => {
    if (existing == null) {
      try {
        await gateway(base, token, "createAgentAutomation", { id: coordinator.id, spec: specToApply });
        console.log(`✓ 已创建例行任务 ${args.routine}（${specToApply.trigger.schedule}）`);
      } catch (error) {
        const converted = everyToCron(specToApply.trigger.schedule);
        if (converted == null) throw error;
        await gateway(base, token, "createAgentAutomation", { id: coordinator.id, spec: { ...specToApply, trigger: { type: "cron", schedule: converted } } });
        console.log(`✓ 已创建例行任务 ${args.routine}（${converted}，由 ${specToApply.trigger.schedule} 换算）`);
      }
    } else {
      await gateway(base, token, "updateAgentAutomation", { id: coordinator.id, automationId: existing.id, spec: specToApply });
      await gateway(base, token, "setAgentAutomationEnabled", { id: coordinator.id, automationId: existing.id, isEnabled: true });
      console.log(`✓ 已更新并启用例行任务 ${args.routine}（${specToApply.trigger.schedule}）`);
    }
  };
  await applySpec(spec);

  console.log(`
蜂群已上线，7x24 自驱开始：
  观测1: dsh Web GUI → 侧栏 Bots → 打开「${args.coordinator}」
  观测2: tail -f ${progPath}
  暂停:  node scripts/swarm/swarm-bootstrap.mjs --pause
  状态:  node scripts/swarm/swarm-bootstrap.mjs --status`);
}

main().catch((error) => {
  console.error(`❌ ${error.message ?? error}`);
  process.exit(1);
});
