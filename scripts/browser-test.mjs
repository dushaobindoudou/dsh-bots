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
      else if (method === 'goals') value = await workflow.list(request.agentId)
      else if (method === 'createGoal') value = await workflow.create(request)
      else if (method === 'goalAction') value = await workflow.act(request)
      else if (method === 'transcriptTail') value = { entries: [] }
      else if (method === 'eventsSince') value = { events: [], nextSeq: 0, unread: {} }
      else if (method === 'pin') value = { ids: [] }
      else if (method === 'gatewayInfo') value = { ok: true, port: 7331 }
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
  assert.deepEqual(errors, [])
  console.log('browser: goal create/pause/resume/review/revise, native navigation, Escape, fold geometry and narrow layout passed')
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true })
}
