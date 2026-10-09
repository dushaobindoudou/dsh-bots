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
const skills = [
  { id: 'weekly', name: '周报生成', description: '每周五生成周报草稿', body: '# 步骤', source: 'workflow', isEnabledForAgent: true, trigger: null, disableModelInvocation: true },
  { id: 'dsh-bridged', name: 'DSH 桥接技能', description: '来自 ~/.dsh/skills', body: 'bridged', source: 'plugin', isEnabledForAgent: true, trigger: null },
  { id: 'routine', name: '每日站会提醒', description: 'cron 例行', body: 'remind', source: 'workflow', isEnabledForAgent: true, trigger: { schedule: '0 9 * * *', isEnabled: true }, scheduleDescription: '每天 09:00' },
]
const dshSkills = [
  { id: 'dsh-finance', name: '金融助手', description: '金融场景总入口', bridged: false, path: '/mock/.dsh/skills/finance/SKILL.md' },
  { id: 'dsh-note', name: '笔记整理', description: '整理零散笔记', bridged: true, path: '/mock/.agents/skills/note.md' },
]
let agentModelId = null
// Mutable so the settings ModelCard case can prove the set→apply flow, and the
// gateway-online state so the offline case can flip it. The composer seat is
// per-bot (settings.json modelId, no restart) — applyModelCalls stays 0 there.
let engineModelId = 'deepseek-v4'
let pickedModel = null
let applyModelCalls = 0
let gwOk = true
const modelCfg = () => ({
  provider: null, agentDefaultModel: 'deepseek-v4', agentModelId, freerouteReachable: true,
  models: ['deepseek-v4', 'glm-5'], groups: [{ provider: 'orcarouter', models: ['deepseek-v4', 'glm-5'] }],
  deepseek: ['deepseek-v4'], engine: { modelId: engineModelId, plist: '/mock/com.sdk-bots.host.plist', present: true }, native: null,
})
const group = { id: 'room1', name: '项目群', isGroup: true, memberIds: ['bot'], description: '协作群' }
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
        for (const s of dshSkills) s.bridged = on.has(s.id)
        value = { bridged: on.size }
      }
      else if (method === 'modelConfig') value = modelCfg()
      else if (method === 'getAgentOutline') value = { items: [] }
      else if (method === 'automationsList') {
        value = request.agentId === 'bot'
          ? [{ id: 'r1', name: '晨报汇总', prompt: '汇总昨日进展', isEnabled: true, schedule: '0 9 * * *', triggerDescription: '每天 09:00', nextRunAt: Date.now() + 3600000, lastStatus: 'ok' }]
          : []
      }
      else if (method === 'setAgentModel') {
        agentModelId = typeof request.modelId === 'string' && request.modelId !== '' ? request.modelId : null
        value = { modelId: agentModelId }
      }
      // Goals engine teardown (parallel session): the room panel still reads
      // member goals, which now answer empty until the engine re-adds them.
      else if (method === 'goals') value = []
      else if (method === 'createGoal') value = null
      else if (method === 'goalAction') value = null
      else if (method === 'transcriptTail') value = {
        entries: [{
          id: 'm1', kind: 'message', display: 'assistant', timestampMs: Date.now() - 60_000, role: 'assistant',
          content: '风险评估已完成：risk/09999_risk_opinion_20261009.md，请查收。',
          authorId: 'bot', authorName: '风险助手', isStreaming: false,
        }],
      }
      else if (method === 'readText') {
        value = { path: request.path, text: '# 风险意见\n\n组合回撤上限 8%，单票仓位不超过 15%。\n', offset: 0, nextOffset: 4096, eof: true, bytes: 96, mtimeMs: Date.now() }
      }
      else if (method === 'readBytes') value = { path: request.path, mime: 'application/pdf', dataBase64: '', sizeBytes: 128_000, mtimeMs: Date.now() }
      else if (method === 'revealFile') value = { revealed: true }
      else if (method === 'eventsSince') value = { events: [], nextSeq: 0, unread: {} }
      else if (method === 'pin') value = { ids: [] }
      else if (method === 'gatewayInfo') value = { ok: gwOk, port: 7331 }
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
  // Composer model seat (per-bot, per the committed design doc): the pill
  // names THIS bot's model; picking writes the agent's settings.json modelId
  // — effective next turn, NO restart. The engine-global set+apply flow is
  // the settings ModelCard's surface and is NOT driven from the composer.
  await page.locator('.dbs-modelChip').click()
  await page.locator('.dbs-modelMenu').waitFor()
  assert.ok((await page.locator('.dbs-modelRow[data-current="true"]').innerText()).includes('跟随引擎默认'),
    'with no override the follow-engine-default row must be checked')
  await page.locator('.dbs-modelRow', { hasText: 'glm-5' }).first().click()
  await page.locator('.dbs-modelChip', { hasText: 'glm-5' }).waitFor()
  assert.equal(agentModelId, 'glm-5', 'picking must write the per-agent modelId')
  assert.equal(applyModelCalls, 0, 'the composer seat must never restart the engine')
  const headerAvatar = await page.locator('.dbs-chatbar [data-avatar-state]').boundingBox()
  assert.equal(headerAvatar.width, 28, 'the header avatar must be compact')
  assert.ok(await page.locator('.dbs-chatbar .dbs-avatarBlob').evaluate(el => el.querySelector('mask path').getBBox().width > 160),
    'thinking must keep a full character silhouette')
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
  // Group task planning: the group header carries a 任务 toggle; the panel
  // lists each member's routines/goals (read-only — members plan in chat).
  await page.getByText('项目群', { exact: true }).click()
  await page.getByRole('button', { name: '任务规划', exact: true }).click()
  await page.locator('.dbs-taskPanel').waitFor()
  // The member rows arrive from the panel's own RPCs — wait, don't race them.
  await page.locator('.dbs-taskRow', { hasText: '晨报汇总' }).waitFor()
  assert.ok(await page.locator('.dbs-taskPanel').innerText().then(t => t.includes('晨报汇总')),
    'member routines must be visible in the room panel')
  assert.ok(await page.locator('.dbs-taskPanel').innerText().then(t => t.includes('测试 Bot')),
    'rows must be attributed to the planning member')
  await page.getByRole('button', { name: '任务规划', exact: true }).click()
  await page.getByText('测试 Bot', { exact: true }).click()
  // File preview: the bot's reply carries a workspace-relative document
  // path; its chip must open the native-renderer preview modal (the old
  // openFile RPC is gone, and the old path regex truncated relative paths).
  const docChip = page.locator('.dbs-fileChip', { hasText: '09999_risk_opinion_20261009.md' })
  await docChip.waitFor()
  assert.match(await docChip.getAttribute('title') ?? '', /risk\/09999_risk_opinion_20261009\.md$/,
    'the chip must carry the full workspace-relative path, not the truncated basename')
  await docChip.click()
  await page.locator('.dbs-previewCard').waitFor()
  assert.equal(await page.locator('.dbs-previewName').innerText(), '09999_risk_opinion_20261009.md')
  // The body streams in from readText — wait for the render, don't race it.
  await page.locator('.dbs-previewMd').waitFor()
  assert.match(await page.locator('.dbs-previewCard').innerText(), /风险意见/, 'markdown must render through the native renderer')
  assert.match(await page.locator('.dbs-previewCard').innerText(), /回撤上限/, 'markdown body content must be present')
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.locator('.dbs-previewCard').waitFor({ state: 'detached' })
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
  await page.getByRole('button', { name: 'Plugin settings' }).click()
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
  await page.getByPlaceholder('一句话说明何时使用（会随库路径提示给 Bot）').fill('测试用')
  await page.getByPlaceholder('技能正文（Markdown）。可粘贴带 frontmatter 的 SKILL.md，引擎会解析 name/description。').fill('# 正文')
  await page.getByRole('button', { name: '保存技能' }).click()
  await page.getByText('冒烟技能', { exact: true }).waitFor()
  assert.equal(skills.some((s) => s.name === '冒烟技能'), true)
  await page.getByRole('button', { name: '安装技能', exact: true }).click()
  await page.getByRole('textbox', { name: '本机技能目录或 GitHub 技能目录链接' }).fill('/mock/skills/research')
  await page.getByRole('button', { name: '安装技能', exact: true }).last().click()
  await page.getByText('research', { exact: true }).waitFor()
  // Bridge block: check the unbridged row, save, and the mock set updates.
  await page.getByText('DSH 技能桥', { exact: true }).waitFor()
  const financeRow = page.getByRole('checkbox').first()
  await financeRow.check()
  await page.getByRole('button', { name: '保存桥接' }).click()
  await page.waitForTimeout(150)
  assert.equal(dshSkills[0].bridged, true)
  assert.equal(dshSkills[1].bridged, true)
  await page.screenshot({ path: process.env.BROWSER_SKILLS_SCREENSHOT ?? '/tmp/dsh-bots-skills.png', fullPage: true })
  // Gateway-offline UX: with the engine unreachable the sidebar collapses to
  // an actionable reconnect card; reconnect boots the engine and flips the UI
  // back only when it truly answers (no more dead "网关未连接" hint).
  gwOk = false
  const page2 = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors2 = []; page2.on('pageerror', (error) => errors2.push(error.message))
  await page2.goto(`http://127.0.0.1:${server.address().port}`)
  await page2.getByRole('button', { name: 'Bots', exact: true }).click()
  const compact = page2.locator('.dbs-offlineCompact')
  await compact.waitFor()
  await compact.getByRole('button', { name: '重新连接' }).click()
  await page2.getByText('测试 Bot', { exact: true }).waitFor()
  assert.equal(gwOk, true, 'reconnect must have run against the host')
  await page2.getByText('测试 Bot', { exact: true }).click()
  await page2.locator('.dbs-composerInput').waitFor()
  assert.equal(await page2.locator('.dbs-offlineCard').count(), 0, 'an online chat must not render the offline card')
  assert.deepEqual(errors2, [])
  await page2.close()
  assert.deepEqual(errors, [])
  console.log('browser: native navigation, Escape, fold geometry, narrow layout, @mention skills, composer model seat, group task planning, skills card and offline reconnect passed')
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true })
}
