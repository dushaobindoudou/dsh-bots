// Isolated browser regression: no live profiles, model calls or user data.
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const dir = mkdtempSync(join(tmpdir(), 'dsh-bots-browser-'))
const agent = { id: 'bot', name: '测试 Bot', isGroup: false, memberIds: [], isRunning: true, isActive: true,
  runStartedAt: Date.now() - 90000, currentActivity: { kind: 'thinking' } }
const autos = []
// Routines the composer's 定时任务 form creates (routineCreate/routineDelete).
const createdRoutines = []
const routineCalls = []
const createGroupCalls = []
const skills = [
  { id: 'weekly', name: '周报生成', description: '每周五生成周报草稿', body: '# 步骤', source: 'workflow', isEnabledForAgent: true, trigger: null, disableModelInvocation: true },
  { id: 'dsh-bridged', name: 'DSH 桥接技能', description: '来自 ~/.dsh/skills', body: 'bridged', source: 'plugin', isEnabledForAgent: true, trigger: null },
  { id: 'routine', name: '每日站会提醒', description: 'cron 例行', body: 'remind', source: 'workflow', isEnabledForAgent: true, trigger: { schedule: '0 9 * * *', isEnabled: true }, scheduleDescription: '每天 09:00' },
]
const dshSkills = [
  { id: 'dsh-finance', name: '金融助手', description: '金融场景总入口', bridged: false, status: 'pending', changed: false, bundled: false, sha256: 'a'.repeat(64), path: '/mock/.dsh/skills/finance/SKILL.md' },
  { id: 'dsh-note', name: '笔记整理', description: '整理零散笔记', bridged: true, status: 'shared', changed: true, bundled: false, sha256: 'b'.repeat(64), path: '/mock/.agents/skills/note.md' },
]
let agentModelId = null
let modelSelectionCalls = 0
let catalogFails = 0
let selectionFails = 0
let holdSelection = false
let releaseSelection = null
// Mutable so the settings ModelCard case can prove the set→apply flow, and the
// gateway-online state so the offline case can flip it. The composer seat is
// per-bot (settings.json modelId, no restart) — applyModelCalls stays 0 there.
let engineModelId = 'deepseek-v4'
let pickedModel = null
let applyModelCalls = 0
let gwOk = true
const modelCfg = () => ({
  provider: null, agentDefaultModel: pickedModel ?? 'deepseek-v4', agentModelId, freerouteReachable: true,
  models: ['deepseek-v4', 'glm-5'], groups: [{ provider: 'orcarouter', models: ['deepseek-v4', 'glm-5'] }],
  deepseek: ['deepseek-v4'], engine: { modelId: engineModelId, plist: '/mock/com.sdk-bots.host.plist', present: true }, native: null,
})
const group = { id: 'room1', name: '项目群', isGroup: true, memberIds: ['bot'], description: '协作群' }
// Bot history: 200 rows, newest last (the risk report). Paged by the
// engine's own beforeSeq cursor so "load earlier" is exercised for real.
const riskRow = {
  id: 'm1', kind: 'message', display: 'assistant', timestampMs: Date.now() - 60_000, role: 'assistant',
  content: '风险评估已完成：risk/09999_risk_opinion_20261009.md，请查收。',
  authorId: 'bot', authorName: '风险助手', isStreaming: false,
}
const history = Array.from({ length: 199 }, (_, i) => ({
  id: 'h' + i, kind: 'message', display: i % 2 === 0 ? 'user' : 'assistant', timestampMs: Date.now() - 3_600_000 + i * 1000,
  role: i % 2 === 0 ? 'user' : 'assistant', content: '历史消息 ' + i, authorId: null, authorName: null, isStreaming: false,
})).concat([riskRow])
let tailCalls = 0
function tailOf(rows, limit, beforeSeq) {
  const upto = typeof beforeSeq === 'number' ? beforeSeq : rows.length
  const start = Math.max(0, upto - limit)
  return { entries: rows.slice(start, upto), nextBeforeSeq: start > 0 ? start : null }
}
// Events the test injects into the host ring.
const ringEvents = []
// The host fingerprint the built client expects (baked by bake-version);
// serving a different one simulates a dsh web still running the old host.
const builtHost = /const EXPECTED_HOST_BUILD = '([^']*)'/.exec(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))?.[1]
let servedHost = builtHost
const gateway = async (method, args) => {
  if (method === 'listAgents') return [agent, group]
  if (method === 'getAgentAutomations') return autos
  if (method === 'createAgentAutomation') {
    autos.push({ id: 'routine', ...args.spec, runs: [], nextRunAt: Date.now() + 60000 })
    mkdirSync(join(dir, 'agents', 'bot', 'automations', 'routine'), { recursive: true }); return autos
  }
  if (method === 'setAgentAutomationEnabled') { autos[0].isEnabled = args.isEnabled; return autos }
  if (method === 'interruptAgent') return { hadActiveRun: false }
  throw new Error('Unexpected gateway method: ' + method)
}
const fixture = await build({ entryPoints: ['scripts/fixtures/workbench.tsx'], bundle: true, write: false, format: 'iife' })
const theme = `:root{--dsw-alias-bg-base:#fff;--dsw-specific-sidebar-fill:#f7f7f8;--dsw-alias-label-primary:#202124;--dsw-alias-label-secondary:#65676b;--dsw-alias-label-tertiary:#888;--dsw-alias-border-l1:#eee;--dsw-alias-border-l2:#ddd;--dsw-alias-interactive-bg-hover:#f2f3f5;--dsw-specific-input-major:#fff;--dsw-alias-state-business-primary:#4568de;--dsw-font-family:system-ui}body{margin:0;font:14px system-ui}button{font:inherit;cursor:pointer;padding:6px 10px}button:disabled{opacity:.5}*{box-sizing:border-box}`
const server = createServer(async (req, res) => {
  if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fixture.outputFiles[0].text); return }
  if (req.url === '/client.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(readFileSync(new URL('../lib/client.js', import.meta.url))); return }
  if (req.url === '/rpc') {
    try {
      let body = ''; for await (const chunk of req) body += chunk
      const { method, request } = JSON.parse(body)
      let value = null
      if (method === 'list') value = [agent, group]
      else if (method === 'skillsList') value = { skills }
      else if (method === 'skillsEnable') {
        const row = skills.find((s) => s.id === request.workflowId)
        if (row) row.isEnabledForAgent = request.isEnabled === true
        value = { skills }
      }
      else if (method === 'skillsSave') {
        if (request.id) {
          const row = skills.find((s) => s.id === request.id)
          if (row) { row.name = request.name; row.description = request.description; row.body = request.body }
        } else skills.push({ id: 'new-' + skills.length, name: request.name, description: request.description, body: request.body, source: 'workflow', isEnabledForAgent: true, trigger: null })
        value = { skills }
      }
      else if (method === 'skillsDelete') {
        const at = skills.findIndex((s) => s.id === request.workflowId)
        if (at >= 0) skills.splice(at, 1)
        value = { skills }
      }
      else if (method === 'skillsRunNow' || method === 'skillsImportText') value = { skills }
      else if (method === 'skillsInstall') {
        assert.equal(request.source, '/mock/skills/research')
        skills.push({ id: 'research', name: 'research', description: 'Installed bundle', source: 'workflow', isEnabledForAgent: true, trigger: null })
        value = { skills }
      }
      else if (method === 'skillsBridgeList') value = { skills: dshSkills }
      else if (method === 'skillsBridgeSet') {
        const on = new Set((request.ids ?? []).filter((x) => typeof x === 'string'))
        for (const s of dshSkills) { s.bridged = on.has(s.id); s.status = s.bridged ? 'shared' : 'declined'; s.changed = false }
        value = { bridged: on.size, pending: 0 }
      }
      else if (method === 'modelConfig') {
        if (catalogFails > 0) { catalogFails--; throw new Error('catalog temporarily unavailable') }
        value = modelCfg()
      }
      else if (method === 'getAgentOutline') value = { items: [] }
      else if (method === 'automationsList') {
        value = (request.agentId === 'bot'
          ? [{ id: 'r1', name: '晨报汇总', prompt: '汇总昨日进展', isEnabled: true, schedule: '0 9 * * *', triggerDescription: '每天 09:00', nextRunAt: Date.now() + 3600000, lastStatus: 'ok' }]
          : []).concat(createdRoutines.filter((r) => r.agentId === request.agentId).map((r) => r.routine))
      }
      else if (method === 'createGroup') {
        // Like the engine: a member set matching an existing group returns
        // that group instead of creating one.
        createGroupCalls.push(request)
        value = (request.memberIds ?? []).join(',') === group.memberIds.join(',') ? group : { id: 'room-new', name: request.name, isGroup: true, memberIds: request.memberIds }
      }
      else if (method === 'routineCreate') {
        routineCalls.push({ agentId: request.agentId, prompt: request.prompt, schedule: request.schedule })
        createdRoutines.push({ agentId: request.agentId, routine: { id: 'u' + routineCalls.length, name: request.prompt.split('\n')[0], prompt: request.prompt, isEnabled: true, schedule: request.schedule, triggerDescription: '', nextRunAt: Date.now() + 86400000, lastStatus: null } })
        value = { ok: true }
      }
      else if (method === 'routineDelete') {
        const at = createdRoutines.findIndex((r) => r.agentId === request.agentId && r.routine.id === request.routineId)
        if (at >= 0) createdRoutines.splice(at, 1)
        value = { ok: true }
      }
      else if (method === 'setAgentModel') {
        modelSelectionCalls++
        if (holdSelection) await new Promise(resolve => { releaseSelection = resolve })
        if (selectionFails > 0) { selectionFails--; throw new Error('selection temporarily unavailable') }
        agentModelId = typeof request.modelId === 'string' && request.modelId !== '' ? request.modelId : null
        value = { modelId: agentModelId }
      }
      else if (method === 'transcriptTail') {
        if (request.id === 'bot') { tailCalls += 1; value = tailOf(history, request.limit ?? 40, request.beforeSeq) }
        else value = { entries: [riskRow], nextBeforeSeq: null }
      }
      else if (method === 'readText') {
        value = { path: request.path, text: '# 风险意见\n\n组合回撤上限 8%，单票仓位不超过 15%。\n', offset: 0, nextOffset: 4096, eof: true, bytes: 96, mtimeMs: Date.now() }
      }
      else if (method === 'readBytes') value = { path: request.path, mime: 'application/pdf', dataBase64: '', sizeBytes: 128_000, mtimeMs: Date.now() }
      else if (method === 'revealFile') value = { revealed: true }
      else if (method === 'resolvePath') value = { path: '/mock/box-workspace/AI股票交易台/' + String(request.path).replace(/^\.\//, ''), isFile: true }
      else if (method === 'eventsSince') value = { events: ringEvents.splice(0), nextSeq: 0, unread: {} }
      else if (method === 'pin') value = { ids: [] }
      else if (method === 'gatewayInfo') value = { ok: gwOk, port: 7331, hostBuild: servedHost }
      else if (method === 'reconnect') { gwOk = true; value = { ok: true, port: 7331, bootstrapped: true, waitedMs: 4000, reason: null } }
      else if (method === 'setModelConfig') { pickedModel = String(request.modelId ?? ''); value = { ok: true } }
      else if (method === 'applyModel') {
        assert.equal(request.modelId, pickedModel, 'apply must target the model just set')
        engineModelId = String(request.modelId)
        applyModelCalls += 1
        value = { modelId: engineModelId, restarted: true, reloaded: true, errors: [], healthy: true, waitedMs: 4000 }
      }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, value }))
    } catch (error) { res.end(JSON.stringify({ ok: false, error: { message: error.message } })) }
    return
  }
  res.setHeader('Content-Type', 'text/html')
  res.end(`<meta charset="utf-8"><style>${theme}</style><div id="root"></div><script src="/fixture.js"></script>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: 'chrome' }) })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('button', { name: 'Bots', exact: true }).click()
  await page.getByText('测试 Bot', { exact: true }).click()
  await page.locator('.dbs-runningText').waitFor()
  assert.match(await page.locator('.dbs-runningText').innerText(), /1分/, 'clock must reflect the actual run start before opening')
  assert.equal(await page.locator('.dbs-chatbar').getByRole('button', { name: '关闭', exact: true }).count(), 0)
  assert.equal(await page.locator('.dbs-chatbar [data-avatar-state="thinking"]').count(), 1)
  await page.getByRole('button', { name: 'Native workspace' }).click()
  await page.getByText('测试 Bot', { exact: true }).click()
  assert.match(await page.locator('.dbs-runningText').innerText(), /1分/, 'switching away must preserve the run clock')
  await page.reload()
  await page.getByRole('button', { name: 'Bots', exact: true }).click()
  await page.getByText('测试 Bot', { exact: true }).click()
  assert.match(await page.locator('.dbs-runningText').innerText(), /1分/, 'reload must preserve the engine run clock')
  await page.locator('.dbs-composerInput').fill('@周报')
  await page.locator('.dbs-mentionRow').filter({ hasText: '周报生成' }).waitFor()
  await page.locator('.dbs-composerInput').press('Tab')
  assert.equal(await page.locator('.dbs-composerInput').inputValue(), 'sand-workflow:weekly ')
  await page.locator('.dbs-composerInput').fill('')
  // `/` opens the command menu (native slash commands): add images first,
  // then the bot's skills; the query filters, and a pick replaces the token.
  await page.locator('.dbs-composerInput').fill('/')
  await page.locator('.dbs-mentionRow', { hasText: '周报生成' }).waitFor()
  assert.match(await page.locator('.dbs-mentionRow').first().innerText(), /添加图片/)
  assert.equal(await page.locator('.dbs-mention').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)',
    'the command menu paints an opaque base')
  await page.locator('.dbs-composerInput').fill('总结 /周报')
  await page.locator('.dbs-mentionRow', { hasText: '周报生成' }).waitFor()
  assert.equal(await page.locator('.dbs-mentionRow').count(), 1, 'the query filters the command menu')
  await page.locator('.dbs-composerInput').press('Enter')
  assert.equal(await page.locator('.dbs-composerInput').inputValue(), '总结 sand-workflow:weekly ')
  // A path inside a word is not a command.
  await page.locator('.dbs-composerInput').fill('看 risk/a')
  assert.equal(await page.locator('.dbs-mention').count(), 0, 'a/b paths open no menu')
  // The + button opens the same menu with nothing typed and inserts the
  // pick at the caret; its add-images row opens the file chooser.
  await page.locator('.dbs-composerInput').fill('请用')
  const plus = page.getByRole('button', { name: '添加图片或使用技能', exact: true })
  await plus.click()
  await page.locator('.dbs-mentionRow', { hasText: '周报生成' }).waitFor()
  assert.equal(await plus.getAttribute('aria-expanded'), 'true')
  await page.locator('.dbs-mentionRow', { hasText: '周报生成' }).click()
  assert.equal(await page.locator('.dbs-composerInput').inputValue(), '请用 sand-workflow:weekly ')
  assert.equal(await page.locator('.dbs-mention').count(), 0)
  await page.locator('.dbs-composerInput').fill('')
  await plus.click()
  const chooser = page.waitForEvent('filechooser')
  await page.locator('.dbs-mentionRow', { hasText: '添加图片' }).click()
  await chooser
  assert.equal(await page.locator('.dbs-composerInput').inputValue(), '')
  // Native trigger-menu row metrics: 34px rows (the 40px ones read too tall).
  await page.locator('.dbs-composerInput').fill('/')
  await page.locator('.dbs-mentionRow').first().waitFor()
  assert.equal(Math.round((await page.locator('.dbs-mentionRow').first().boundingBox()).height), 34, 'command rows are 34px')
  // 定时任务: the command menu opens a form in its place; the draft becomes
  // what to do, and a one-off time writes a one-shot "@at" routine.
  await page.locator('.dbs-composerInput').fill('整理今天的风险报告 /定时')
  await page.locator('.dbs-mentionRow', { hasText: '定时任务' }).click()
  const form = page.locator('.dbs-schedule')
  await form.waitFor()
  assert.equal(await form.locator('.dbs-scheduleInput').inputValue(), '整理今天的风险报告')
  assert.equal(await page.locator('.dbs-composerInput').inputValue(), '', 'the draft moved into the form')
  // Escape cancels and hands the draft back.
  await page.keyboard.press('Escape')
  await form.waitFor({ state: 'detached' })
  assert.equal(await page.locator('.dbs-composerInput').inputValue(), '整理今天的风险报告 /定时')
  await page.locator('.dbs-composerInput').fill('整理今天的风险报告 /定时')
  await page.locator('.dbs-mentionRow', { hasText: '定时任务' }).click()
  await form.waitFor()
  await form.locator('.dbs-scheduleTime').fill('2099-01-02T10:30')
  assert.match(await form.locator('.dbs-scheduleStatus').innerText(), /将在 .*10:30 运行一次/)
  await form.locator('.dbs-scheduleTime').fill('2001-01-02T10:30')
  assert.match(await form.locator('.dbs-scheduleStatus').innerText(), /已经过去/)
  assert.equal(await form.getByRole('button', { name: '创建', exact: true }).isDisabled(), true, 'a past one-off cannot be created')
  await form.locator('.dbs-scheduleTime').fill('2099-01-02T10:30')
  await form.getByRole('button', { name: '创建', exact: true }).click()
  await form.waitFor({ state: 'detached' })
  assert.deepEqual(routineCalls.at(-1), { agentId: 'bot', prompt: '整理今天的风险报告', schedule: '@at 2099-01-02 10:30' })
  await page.locator('.dbs-composerNotice', { hasText: '已创建定时任务' }).waitFor()
  // Repeats write a cron: weekdays at the chosen time.
  await page.getByRole('button', { name: '添加图片或使用技能', exact: true }).click()
  await page.locator('.dbs-mentionRow', { hasText: '定时任务' }).click()
  await form.locator('.dbs-scheduleInput').fill('盘前提醒')
  await form.locator('.dbs-scheduleTime').fill('2099-01-02T08:45')
  await form.getByRole('radio', { name: '工作日' }).click()
  await form.getByRole('button', { name: '创建', exact: true }).click()
  await form.waitFor({ state: 'detached' })
  assert.equal(routineCalls.at(-1).schedule, '45 8 * * 1-5')
  // The routines entry lists them (one-offs read 仅一次) with a two-click cancel.
  const routinesEntry = page.getByRole('button', { name: '3 个例行任务', exact: true })
  await routinesEntry.click()
  const oneOff = page.locator('.dbs-routinesRow', { hasText: '整理今天的风险报告' })
  await oneOff.waitFor()
  assert.match(await oneOff.innerText(), /仅一次/)
  for (const name of ['整理今天的风险报告', '盘前提醒']) {
    const row = page.locator('.dbs-routinesRow', { hasText: name })
    await row.hover()
    await row.locator('.dbs-routinesCancel').click()
    assert.equal(await row.locator('.dbs-routinesCancel').innerText(), '确认取消？')
    await row.locator('.dbs-routinesCancel').click()
    await row.waitFor({ state: 'detached' })
  }
  assert.equal(createdRoutines.length, 0)
  await page.keyboard.press('Escape')
  await page.locator('.dbs-routinesMenu').waitFor({ state: 'detached' })
  await page.locator('.dbs-composerInput').fill('')
  // Sidebar rows: 24px avatars in the 32px row (32px ones filled it).
  const rowAvatar = await page.locator('.dbs-srow', { hasText: '测试 Bot' }).locator('[data-avatar-state]').first().boundingBox()
  assert.equal(Math.round(rowAvatar.width), 24, 'sidebar avatars are 24px')
  // Composer model seat (per-bot, per the committed design doc): the pill
  // names THIS bot's model; picking writes the agent's settings.json modelId
  // — effective next turn, NO restart. The engine-global set+apply flow is
  // the settings ModelCard's surface and is NOT driven from the composer.
  await page.locator('.dbs-modelChip').click()
  await page.locator('.dbs-modelMenu').waitFor()
  assert.equal(await page.locator('.dbs-modelMenu').getAttribute('data-pane'), 'root',
    'native model picker first opens the Model/current-value menu')
  assert.equal(await page.locator('.dbs-modelMenu .dbs-modelRow').count(), 0)
  assert.equal(await page.locator('.dbs-modelMenu').evaluate(el => el.parentElement === document.body), true,
    'the model menu is portaled outside the clipped composer')
  assert.equal(await page.locator('.dbs-modelMenu').evaluate(el => getComputedStyle(el).position), 'fixed')
  await page.screenshot({ path: '/tmp/dsh-bots-model-picker-root.png' })
  await page.locator('.dbs-modelCell').click()
  assert.ok((await page.locator('.dbs-modelRow[data-current="true"]').innerText()).includes('跟随全局默认'),
    'with no override the follow-global-default row must be checked')
  // The menu is opaque: the menu tint over the base colour, so the
  // transcript never reads through it (user report).
  assert.equal(await page.locator('.dbs-modelMenu').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)',
    'the model menu paints an opaque base')
  const modelBox = await page.locator('.dbs-modelMenu').boundingBox()
  assert.ok(modelBox.width >= 240 && modelBox.width <= 420, 'the model menu uses native 240–420px sizing')
  assert.ok(modelBox.x >= 0 && modelBox.x + modelBox.width <= 1280, 'the model menu stays on screen (opens leftward from the chip)')
  await page.setViewportSize({ width: 600, height: 480 })
  await page.waitForFunction(() => {
    const rect = document.querySelector('.dbs-modelMenu').getBoundingClientRect()
    return rect.left >= 12 && rect.right <= innerWidth - 12 && rect.top >= 12 && rect.bottom <= innerHeight - 12
  })
  assert.equal(await page.locator('.dbs-modelCompactIcon').isVisible(), true,
    'the native narrow composer seat falls back to an icon while retaining its accessible label')
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.waitForFunction(() => {
    const menu = document.querySelector('.dbs-modelMenu').getBoundingClientRect()
    const trigger = document.querySelector('.dbs-modelChip').getBoundingClientRect()
    return Math.abs(menu.right - trigger.right) < 2
  })
  await page.screenshot({ path: '/tmp/dsh-bots-model-picker-list.png' })
  holdSelection = true
  await page.locator('.dbs-modelRow', { hasText: 'glm-5' }).first().click()
  await page.locator('.dbs-modelRow .dbs-modelSpinner').waitFor()
  assert.equal(await page.locator('.dbs-modelChip .dbs-modelSpinner').count(), 1)
  assert.equal(await page.locator('.dbs-modelMenu').getAttribute('aria-busy'), 'true')
  assert.equal(agentModelId, null, 'pending selection must not claim success')
  holdSelection = false; releaseSelection()
  await page.locator('.dbs-modelChip', { hasText: 'glm-5' }).waitFor()
  assert.equal(agentModelId, 'glm-5', 'picking must write the per-agent modelId')
  assert.equal(applyModelCalls, 0, 'the composer seat must never restart the engine')
  await page.locator('.dbs-modelChip').click()
  await page.locator('.dbs-modelCell').click()
  const callsBeforeRepeat = modelSelectionCalls
  await page.locator('.dbs-modelRow', { hasText: 'glm-5' }).first().click()
  await page.locator('.dbs-modelMenu').waitFor({ state: 'detached' })
  assert.equal(modelSelectionCalls, callsBeforeRepeat, 'selecting the active model only closes the menu')
  // A rejected write keeps the old model and offers a retry of that choice.
  selectionFails = 1
  await page.locator('.dbs-modelChip').click()
  await page.locator('.dbs-modelCell').click()
  await page.locator('.dbs-modelRow', { hasText: 'deepseek-v4' }).last().click()
  await page.locator('.dbs-modelErrorStrip').waitFor()
  assert.equal(agentModelId, 'glm-5')
  await page.locator('.dbs-modelRetry').click()
  await page.locator('.dbs-modelMenu').waitFor({ state: 'detached' })
  assert.equal(agentModelId, 'deepseek-v4')
  // Reset the override through the same menu.
  await page.locator('.dbs-modelChip').click()
  await page.locator('.dbs-modelCell').click()
  await page.locator('.dbs-modelRow', { hasText: '跟随全局默认' }).click()
  await page.locator('.dbs-modelMenu').waitFor({ state: 'detached' })
  assert.equal(agentModelId, null)
  // Escape closes the menu wherever focus sits (a short list has no search
  // field to hold focus, and its scrim would otherwise swallow every click).
  await page.locator('.dbs-modelChip').click()
  await page.locator('.dbs-modelMenu').waitFor()
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.locator('.dbs-modelCell').evaluate(el => el === document.activeElement), true)
  await page.keyboard.press('Enter')
  await page.locator('.dbs-modelMenu[data-pane="model"]').waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.dbs-modelMenu[data-pane="root"]').waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.dbs-modelMenu').waitFor({ state: 'detached' })
  assert.equal(await page.locator('.dbs-modelChip').evaluate(el => el === document.activeElement), true)
  await page.locator('.dbs-modelChip').click()
  await page.locator('.dbs-composerInput').click()
  await page.locator('.dbs-modelMenu').waitFor({ state: 'detached' })
  assert.equal(await page.locator('.dbs-composerInput').evaluate(el => el === document.activeElement), true,
    'outside clicks dismiss the menu and reach their target in one click')
  catalogFails = 2
  await page.reload()
  await page.getByRole('button', { name: 'Bots', exact: true }).click()
  await page.getByText('测试 Bot', { exact: true }).click()
  await page.locator('.dbs-modelChip').click()
  await page.locator('.dbs-modelCell').click()
  await page.locator('.dbs-modelErrorStrip').waitFor()
  await page.locator('.dbs-modelRetry').click()
  await page.locator('.dbs-modelErrorStrip').waitFor({ state: 'detached' })
  await page.locator('.dbs-modelRow', { hasText: 'glm-5' }).waitFor()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.locator('.dbs-modelMenu').waitFor({ state: 'detached' })
  const headerAvatar = await page.locator('.dbs-chatbar [data-avatar-state]').boundingBox()
  assert.equal(headerAvatar.width, 28, 'the header avatar must be compact')
  assert.ok(await page.locator('.dbs-chatbar .dbs-avatarBlob').evaluate(el => el.querySelector('mask path').getBBox().width > 160),
    'thinking must keep a full character silhouette')
  // The running row's screen-reader status must not leak scrollable overflow
  // into the panel container: a phantom there lets any focus scroll strand
  // the whole panel mid-scroll (chatbar/composer flying off the viewport).
  const phantom = await page.evaluate(() => {
    const main = document.querySelector('main')
    return main.scrollHeight - main.clientHeight
  })
  assert.equal(phantom, 0, 'no phantom scrollable overflow while the running row is mounted')
  await page.screenshot({ path: '/tmp/dsh-bots-running.png' })
  agent.isRunning = false; agent.runStartedAt = null; agent.currentActivity = null
  // The standalone goals module is gone (user feedback: conversations only);
  // group planning lives INSIDE the group conversation behind a 任务 toggle.
  assert.equal(await page.getByRole('button', { name: '目标', exact: true }).count(), 0,
    'no standalone goals module')
  await page.getByRole('button', { name: 'Fold sidebar' }).click()
  await page.waitForTimeout(150)
  const geometry = await page.locator('.dbs-chatview').boundingBox()
  assert.equal(Math.round(geometry.x), 80)
  assert.equal(Math.round(geometry.width), 1200)
  // Returning from a native panel must reopen the same chat without overlays.
  await page.getByRole('button', { name: 'Native workspace' }).click()
  await page.getByText('Native workspace content').waitFor()
  assert.equal(await page.locator('.dbs-chatview').count(), 0)
  await page.getByRole('button', { name: 'Fold sidebar' }).click()
  await page.getByText('测试 Bot', { exact: true }).click()
  // A room turn names the members on it (the group row alone said nothing
  // about who was actually replying).
  group.isRunning = true; agent.isRunning = true
  await page.getByText('项目群', { exact: true }).click()
  await page.locator('.dbs-runningWho', { hasText: '测试 Bot 正在回复' }).waitFor()
  // A group's avatar is its members' own blobs, not an initial on a disc.
  assert.equal(await page.locator('.dbs-srow', { hasText: '项目群' }).locator('.dbs-avatarGroup[data-members="1"] .dbs-avatarBlob').count(), 1,
    'the group avatar shows its member')
  assert.equal(await page.locator('.dbs-chatbar .dbs-avatarGroup').count(), 1)
  group.isRunning = false; agent.isRunning = false
  // Routines entry = the native session-reminder seat (dsh-client-ui-schedule
  // ScheduleCatalogAction): an icon-only clock named with the count, opening
  // a 336px popover anchored 5px under it; Escape returns focus.
  const routinesTrigger = page.getByRole('button', { name: '1 个例行任务', exact: true })
  await routinesTrigger.waitFor()
  assert.equal((await routinesTrigger.innerText()).trim(), '', 'the trigger is icon-only')
  await routinesTrigger.click()
  const routinesMenu = page.locator('.dbs-routinesMenu')
  await routinesMenu.locator('.dbs-routinesRow', { hasText: '晨报汇总' }).waitFor()
  assert.match(await routinesMenu.innerText(), /测试 Bot/, 'group rows name their member')
  assert.match(await routinesMenu.innerText(), /下次运行/, 'rows carry the native next-run line')
  const trig = await routinesTrigger.boundingBox()
  const box = await routinesMenu.boundingBox()
  assert.equal(Math.round(box.width), 336)
  assert.equal(Math.round(box.y), Math.round(trig.y + trig.height + 5), 'anchored 5px below the trigger')
  assert.ok(box.x >= 16 && box.x + box.width <= 1280 - 16, 'kept 16px inside the viewport')
  assert.equal(await page.locator('.dbs-composerInput').isVisible(), true, 'the routines popover never hides the conversation')
  await routinesMenu.press('Escape')
  await routinesMenu.waitFor({ state: 'detached' })
  assert.equal(await routinesTrigger.evaluate((el) => el === document.activeElement), true, 'Escape returns focus to the trigger')
  await page.getByText('测试 Bot', { exact: true }).click()
  // File preview: the bot's reply carries a workspace-relative document
  // path; its chip must open the native-renderer preview modal (the old
  // openFile RPC is gone, and the old path regex truncated relative paths).
  const docChip = page.locator('.dbs-fileChip', { hasText: '09999_risk_opinion_20261009.md' })
  await docChip.waitFor()
  assert.match(await docChip.getAttribute('title') ?? '', /risk\/09999_risk_opinion_20261009\.md$/,
    'the chip must carry the full workspace-relative path, not the truncated basename')
  await docChip.click()
  // The preview docks beside the chat: the conversation stays on screen
  // (user report: previewing a .md switched to an ordinary conversation).
  const pane = page.locator('.dbs-previewPane')
  await pane.waitFor()
  assert.equal(await page.locator('.dbs-previewCard').count(), 0, 'no modal while a chat is open')
  assert.equal(await page.locator('.dbs-composerInput').isVisible(), true, 'the conversation stays beside the preview')
  assert.equal(await page.locator('.dbs-previewName').innerText(), '09999_risk_opinion_20261009.md')
  // The body streams in from readText — wait for the render, don't race it.
  await page.locator('.dbs-previewMd').waitFor()
  assert.match(await pane.innerText(), /风险意见/, 'markdown must render through the native renderer')
  assert.match(await pane.innerText(), /回撤上限/, 'markdown body content must be present')
  // Measure after the 160ms slide-in: a running transform offsets the box.
  await page.waitForFunction(() => document.querySelector('.dbs-previewPane')?.getAnimations().length === 0)
  const paneBox = await pane.boundingBox()
  const chatBox = await page.locator('.dbs-chatview').boundingBox()
  assert.ok(paneBox.x >= chatBox.x + chatBox.width - 1, 'the pane sits to the right of the chat')
  await page.screenshot({ path: process.env.BROWSER_PREVIEW_SCREENSHOT ?? '/tmp/dsh-bots-preview.png' })
  await pane.getByRole('button', { name: '全屏查看', exact: true }).click()
  assert.equal(await pane.getAttribute('data-expanded'), 'true')
  const wide = await pane.boundingBox()
  assert.ok(Math.abs(wide.x - chatBox.x) <= 1, 'expanded covers the whole workbench')
  await pane.getByRole('button', { name: '关闭', exact: true }).click()
  await pane.waitFor({ state: 'detached' })
  assert.equal(await page.locator('.dbs-composerInput').isVisible(), true)
  // History paging: the first read is the newest page only; the top row
  // pages earlier messages in through the engine cursor, keeping the
  // reader's place instead of jumping to the bottom.
  assert.equal(await page.getByText('历史消息 0', { exact: true }).count(), 0, 'the first page must not carry the whole history')
  // DOM clicks: Playwright's scroll-into-view would reach the top and fire
  // the infinite-scroll page-in too, racing the click it is testing.
  await page.locator('.dbs-older button').evaluate((button) => button.click())
  await page.getByText('历史消息 49', { exact: true }).waitFor()
  await page.locator('.dbs-older button').evaluate((button) => button.click())
  await page.getByText('历史消息 0', { exact: true }).waitFor()
  assert.equal(await page.locator('.dbs-older').count(), 0, 'the start of history removes the row')
  assert.equal(await page.locator('[data-eid="h0"]').count(), 1, 'paged rows are not duplicated')
  // Live merge: an appended row renders straight from the event ring — no
  // tail re-read per event (the old path re-fetched 80 rows every time).
  const before = tailCalls
  ringEvents.push({ seq: 1, channel: 'transcript', data: { type: 'appended', agentId: 'bot', view: {
    id: 'live1', kind: 'message', display: 'assistant', timestampMs: Date.now(), role: 'assistant',
    content: '实时到达的消息', authorId: 'bot', authorName: null, isStreaming: false,
  } } })
  await page.getByText('实时到达的消息', { exact: true }).waitFor()
  assert.equal(tailCalls, before, 'a live row must merge without re-reading the transcript')
  // Drafts survive a reload (native persisted-draft contract).
  await page.locator('.dbs-composerInput').fill('写到一半的草稿')
  await page.waitForTimeout(500)
  await page.reload()
  await page.getByRole('button', { name: 'Bots', exact: true }).click()
  await page.getByText('测试 Bot', { exact: true }).click()
  // The draft is restored by the chat's open effect — wait for it, don't race it.
  await page.waitForFunction(() => document.querySelector('.dbs-composerInput')?.value === '写到一半的草稿')
  await page.locator('.dbs-composerInput').fill('')
  await page.waitForTimeout(500)
  // A matching host fingerprint shows no restart notice.
  assert.equal(await page.locator('.dbs-hostUpdate').count(), 0)
  // Verify narrow layout and capture a reviewable artifact.
  await page.setViewportSize({ width: 720, height: 900 })
  await page.getByRole('button', { name: 'Fold sidebar' }).click()
  await page.waitForTimeout(150)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: process.env.BROWSER_SCREENSHOT ?? '/tmp/dsh-bots-goals.png', fullPage: true })
  // Skills card: the settings section mounts in the fixture shell; the skills
  // tab lists the engine library with per-bot enablement (plugin rows locked)
  // and create/edit flows through the same save RPC.
  await page.setViewportSize({ width: 1280, height: 900 })
  // 新建群聊 answers every click: an incomplete form says what is missing
  // (user report: "点击新建群聊没反应" — a greyed 创建 / silent Enter), and a
  // member set matching an existing group says so and opens that group.
  const groupsHead = page.locator('.dbs-secHead').first()
  await groupsHead.hover()
  await groupsHead.locator('[aria-label="新建群聊"]').click()
  const dialog = page.locator('.dbs-modalCard')
  await dialog.waitFor()
  assert.match(await dialog.innerText(), /至少选择 1 位成员/)
  await dialog.locator('input').first().fill('新项目组')
  await dialog.locator('input').first().press('Enter')
  await dialog.locator('.dbs-error', { hasText: '至少选择 1 位成员' }).waitFor()
  await dialog.getByRole('button', { name: '创建', exact: true }).click()
  assert.equal(createGroupCalls.length, 0, 'an incomplete form never calls createGroup')
  await dialog.locator('.dbs-member', { hasText: '测试 Bot' }).click()
  await dialog.getByRole('button', { name: '创建', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  assert.deepEqual(createGroupCalls.at(-1), { name: '新项目组', memberIds: ['bot'] })
  // A notice, not an error: the roster refresh clears `error` on success.
  const dupNotice = page.locator('.dbs-sidebarNotice', { hasText: '未新建：已有成员完全相同的群聊「项目群」' })
  await dupNotice.waitFor()
  await page.locator('.dbs-chatbarName', { hasText: '项目群' }).waitFor()
  await page.waitForTimeout(1500)
  assert.equal(await dupNotice.count(), 1, 'the notice survives roster refreshes')
  await dupNotice.click()
  await dupNotice.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Plugin settings' }).click()
  // Overview: product capabilities and status — no gateway plumbing.
  await page.getByText('能做什么', { exact: true }).waitFor()
  // The status line reads 正在检查 until the probe answers — wait for it.
  await page.waitForFunction(() => document.querySelector('#dbs-settings-panel-overview')?.innerText.includes('Bots 服务运行中'))
  const overview = await page.locator('#dbs-settings-panel-overview').innerText()
  assert.match(overview, /群聊协作/)
  for (const word of ['sdk-bots', '网关', 'PID', '数据目录', '多 Bot 工作台']) {
    assert.equal((await page.locator('.dbs-settings').innerText()).includes(word), false, 'settings must not show ' + word)
  }
  // Models: one trigger opening the composer's grouped menu (below it).
  await page.getByRole('tab', { name: '模型' }).click()
  await page.locator('.dbs-modelSelect').click()
  await page.locator('.dbs-modelMenu[data-side="bottom"]').waitFor()
  assert.equal(await page.locator('#dbs-settings-panel-models select').count(), 0, 'no provider select')
  await page.locator('.dbs-modelMenu .dbs-modelRow', { hasText: 'glm-5' }).first().click()
  await page.locator('.dbs-modelSelect', { hasText: 'glm-5' }).waitFor()
  assert.equal(pickedModel, 'glm-5')
  await page.getByRole('button', { name: '应用并重启服务', exact: true }).click()
  await page.getByText('已生效（用时 4 秒）', { exact: true }).waitFor()
  assert.equal(applyModelCalls, 1, 'apply restarts the service once')
  await page.screenshot({ path: process.env.BROWSER_MODELS_SCREENSHOT ?? '/tmp/dsh-bots-models.png' })
  await page.getByRole('tab', { name: '技能' }).click()
  await page.getByText('周报生成', { exact: true }).waitFor()
  await page.getByText('DSH 桥接技能', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '停用', exact: true }).count(), 1,
    'exactly the workflow-sourced row is toggleable (plugin row locked)')
  await page.getByRole('button', { name: '停用', exact: true }).click()
  await page.getByRole('button', { name: '启用', exact: true }).waitFor()
  assert.equal(skills[0].isEnabledForAgent, false)
  await page.getByRole('button', { name: '新建技能' }).click()
  await page.getByPlaceholder('技能名，例如 weekly-report').fill('冒烟技能')
  await page.getByPlaceholder('一句话说明何时使用').fill('测试用')
  await page.getByPlaceholder('技能正文（Markdown）。可直接粘贴带 frontmatter 的 SKILL.md，会自动读取 name/description。').fill('# 正文')
  await page.getByRole('button', { name: '保存技能' }).click()
  await page.getByText('冒烟技能', { exact: true }).waitFor()
  assert.equal(skills.some((s) => s.name === '冒烟技能'), true)
  await page.getByRole('button', { name: '安装技能', exact: true }).click()
  await page.getByRole('textbox', { name: '本机技能目录或 GitHub 技能目录链接' }).fill('/mock/skills/research')
  await page.getByRole('button', { name: '安装技能', exact: true }).last().click()
  await page.getByText('research', { exact: true }).waitFor()
  // Sharing block: a newly found skill is NOT shared until confirmed — the
  // card says so, lists it first with its source path and content hash,
  // and flags a shared skill whose file changed since it was shared.
  await page.getByText('DSH 技能共享', { exact: true }).waitFor()
  await page.locator('.dbs-bridgeNotice').waitFor()
  assert.match(await page.locator('.dbs-bridgeNotice').innerText(), /发现 1 个新技能/)
  const firstBridge = page.locator('.dbs-bridgeRow').first()
  assert.equal(await firstBridge.getAttribute('data-status'), 'pending', 'undecided skills sort first')
  assert.match(await firstBridge.innerText(), /新发现/)
  assert.match(await firstBridge.innerText(), /sha256 aaaaaaaaaaaa/)
  assert.match(await page.locator('.dbs-bridgeRow').nth(1).innerText(), /共享后内容已变更/)
  assert.equal(await firstBridge.locator('input').isChecked(), false, 'pending skills start unshared')
  await firstBridge.locator('input').check()
  await page.getByRole('button', { name: '保存共享设置' }).click()
  await page.locator('.dbs-bridgeNotice').waitFor({ state: 'detached' })
  assert.equal(dshSkills[0].bridged, true)
  assert.equal(dshSkills[1].bridged, true)
  await page.screenshot({ path: process.env.BROWSER_SKILLS_SCREENSHOT ?? '/tmp/dsh-bots-skills.png', fullPage: true })
  // Gateway-offline UX: with the engine unreachable the sidebar collapses to
  // an actionable reconnect card; reconnect boots the engine and flips the UI
  // back only when it truly answers (no more dead "网关未连接" hint).
  gwOk = false
  servedHost = 'stale-host'
  const page2 = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors2 = []; page2.on('pageerror', (error) => errors2.push(error.message))
  await page2.goto(`http://127.0.0.1:${server.address().port}`)
  await page2.getByRole('button', { name: 'Bots', exact: true }).click()
  // page2 loads against a host started before this build: the restart
  // status in the sidebar footer, shaped like the shell's own update pill.
  const pill = page2.locator('.dbs-hostUpdate')
  await pill.waitFor()
  assert.match(await pill.innerText(), /重启 dsh web/)
  const pillBox = await pill.boundingBox()
  assert.equal(Math.round(pillBox.height), 28, 'native indicator height')
  assert.match(await pill.getAttribute('aria-label'), /新功能需要重启 dsh web/, 'the detail stays reachable for assistive tech')
  const compact = page2.locator('.dbs-offlineCompact')
  await compact.waitFor()
  // 没连接上就不展示群聊/单聊: the mock keeps answering `list` while the
  // engine probe is down, so the gate must hide the two section headers and
  // their stale rows — the reconnect card is the whole body.
  assert.equal(await page2.locator('.dbs-botsBody .dbs-secGroup').count(), 0, 'offline sidebar must not render the 群聊/单聊 sections')
  await compact.getByRole('button', { name: '重新连接' }).click()
  await page2.getByText('测试 Bot', { exact: true }).waitFor()
  assert.equal(gwOk, true, 'reconnect must have run against the host')
  assert.equal(await page2.locator('.dbs-botsBody .dbs-secGroup').count(), 2, 'reconnect brings the 群聊/单聊 sections back')
  await page2.getByText('测试 Bot', { exact: true }).click()
  await page2.locator('.dbs-composerInput').waitFor()
  assert.equal(await page2.locator('.dbs-offlineCard').count(), 0, 'an online chat must not render the offline card')
  assert.deepEqual(errors2, [])
  await page2.close()
  // Shell preview services present (?native=1) change nothing: the file
  // still opens in the docked pane, no dsh Session is borrowed and the main
  // column never leaves the bot conversation.
  gwOk = true; servedHost = builtHost
  const page3 = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors3 = []; page3.on('pageerror', (error) => errors3.push(error.message))
  await page3.goto(`http://127.0.0.1:${server.address().port}/?native=1`)
  await page3.getByRole('button', { name: 'Bots', exact: true }).click()
  await page3.getByText('测试 Bot', { exact: true }).click()
  await page3.locator('.dbs-fileChip', { hasText: '09999_risk_opinion_20261009.md' }).click()
  await page3.locator('.dbs-previewPane .dbs-previewMd').waitFor()
  assert.deepEqual(await page3.evaluate(() => window.__native.opened), [], 'no shell resource was opened')
  assert.equal(await page3.getByText('Native workspace content').count(), 0, 'the main column stays on the bot')
  assert.equal(await page3.locator('.dbs-chatview').count(), 1)
  // Narrow column: the pane covers the chat instead of squeezing it.
  await page3.setViewportSize({ width: 760, height: 900 })
  await page3.waitForFunction(() => document.querySelector('.dbs-previewPane')?.getAnimations().length === 0)
  const narrow = await page3.locator('.dbs-previewPane').boundingBox()
  const narrowChat = await page3.locator('.dbs-chatview').boundingBox()
  assert.ok(Math.abs(narrow.x - narrowChat.x) <= 1 && Math.abs(narrow.width - narrowChat.width) <= 1, 'narrow: the pane covers the chat')
  assert.deepEqual(errors3, [])
  await page3.close()
  assert.deepEqual(errors, [])
  console.log('browser: native navigation, Escape, fold geometry, narrow layout, @mention skills, composer model seat, group task planning, skills card, offline reconnect, docked document preview, composer commands, group avatars and settings overview passed')
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true })
}
