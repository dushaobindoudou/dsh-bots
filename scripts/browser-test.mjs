// Isolated browser regression: no live profiles, model calls or user data.
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { GoalWorkflow } from '../lib/goals.js'

const dir = mkdtempSync(join(tmpdir(), 'dsh-bots-browser-'))
const agent = { id: 'bot', name: '测试 Bot', isGroup: false, memberIds: [], isRunning: false, isActive: true }
const autos = []
const skills = [
  { id: 'weekly', name: '周报生成', description: '每周五生成周报草稿', body: '# 步骤', source: 'workflow', isEnabledForAgent: true, trigger: null },
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
const workflow = new GoalWorkflow(dir, async (method, args) => {
  if (method === 'listAgents') return [agent]
  if (method === 'getAgentAutomations') return autos
  if (method === 'createAgentAutomation') {
    autos.push({ id: 'routine', ...args.spec, runs: [], nextRunAt: Date.now() + 60000 })
    mkdirSync(join(dir, 'agents', 'bot', 'automations', 'routine'), { recursive: true }); return autos
  }
  if (method === 'setAgentAutomationEnabled') { autos[0].isEnabled = args.isEnabled; return autos }
  if (method === 'interruptAgent') return { hadActiveRun: false }
  throw new Error('Unexpected gateway method: ' + method)
})
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
      if (method === 'list') value = [agent]
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
      else if (method === 'setAgentModel') {
        agentModelId = typeof request.modelId === 'string' && request.modelId !== '' ? request.modelId : null
        value = { modelId: agentModelId }
      }
      else if (method === 'goals') value = await workflow.list(request.agentId)
      else if (method === 'createGoal') value = await workflow.create(request)
      else if (method === 'goalAction') value = await workflow.act(request)
      else if (method === 'transcriptTail') value = { entries: [] }
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
  await page.getByRole('button', { name: '目标', exact: true }).click()
  await page.getByLabel('希望完成什么？').fill('修复登录问题并通过回归')
  await page.getByLabel('验收标准（每行一条）').fill('复现并修复登录失败\n移动端回归通过')
  await page.getByRole('button', { name: '开始持续推进' }).click()
  await page.getByRole('heading', { name: '修复登录问题并通过回归' }).waitFor()
  assert.equal(autos.length, 1)
  await page.getByRole('button', { name: '暂停目标', exact: true }).click()
  await page.getByRole('button', { name: '恢复推进', exact: true }).waitFor()
  assert.equal(autos[0].isEnabled, false)
  await page.getByRole('button', { name: '恢复推进', exact: true }).click()
  await page.getByRole('button', { name: '暂停目标', exact: true }).waitFor()
  assert.equal(autos[0].isEnabled, true)
  await page.keyboard.press('Escape')
  await page.getByRole('heading', { name: '修复登录问题并通过回归' }).waitFor()
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
  await page.getByRole('button', { name: '目标', exact: true }).click()
  await page.getByRole('heading', { name: '修复登录问题并通过回归' }).waitFor()
  // Simulate an engine checkpoint; the model claim must require explicit review.
  const ledgerPath = join(dir, 'agents', 'bot', 'automations', 'routine', 'goal.json')
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  ledger.status = 'achieved'; ledger.acceptance.forEach(c => { c.done = true })
  writeFileSync(ledgerPath, JSON.stringify(ledger))
  writeFileSync(join(dir, 'agents', 'bot', 'automations', 'routine', 'progress.md'), '证据：登录回归测试通过。下一步：等待用户验收。')
  await page.getByRole('button', { name: '刷新状态' }).click()
  await page.getByRole('button', { name: '确认验收通过' }).waitFor()
  assert.equal((await workflow.list('bot'))[0].status, 'review')
  await page.getByRole('button', { name: '退回继续改进' }).click()
  await page.getByLabel('还需要完成什么？').fill('补充过期登录态用例')
  await page.getByRole('button', { name: '保存并继续推进' }).click()
  await page.getByRole('button', { name: '暂停目标', exact: true }).waitFor()
  assert.equal((await workflow.list('bot'))[0].status, 'scheduled')
  assert.equal((await workflow.list('bot'))[0].acceptance.some(c => c.done), false)
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
  // Bridge block: check the unbridged row, save, and the mock set updates.
  await page.getByText('DSH 技能桥', { exact: true }).waitFor()
  const financeRow = page.getByRole('checkbox').first()
  await financeRow.check()
  await page.getByRole('button', { name: '保存桥接' }).click()
  await page.waitForTimeout(150)
  assert.equal(dshSkills[0].bridged, true)
  assert.equal(dshSkills[1].bridged, true)
  await page.screenshot({ path: process.env.BROWSER_SKILLS_SCREENSHOT ?? '/tmp/dsh-bots-skills.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log('browser: goal create/pause/resume/review/revise, native navigation, Escape, fold geometry, narrow layout and skills card passed')
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true })
}
