import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GoalWorkflow } from '../src/goals.js'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-goals-')); dirs.push(root)
  const agent = { id: 'bot', isGroup: false, isRunning: false }
  const autos: any[] = []
  const calls: Array<{ method: string; args: any }> = []
  let fail = ''
  const ledgerPath = () => join(root, 'agents', 'bot', 'automations', 'routine-1', 'goal.json')
  const rpc = async (method: string, args: any) => {
    calls.push({ method, args })
    if (method === fail) throw new Error('temporary failure')
    if (method === 'listAgents') return [agent]
    if (method === 'getAgentAutomations') return autos
    if (method === 'createAgentAutomation') {
      autos.push({ id: 'routine-1', ...args.spec, runs: [], nextRunAt: 123456 })
      mkdirSync(join(root, 'agents', 'bot', 'automations', 'routine-1'), { recursive: true })
      return autos
    }
    if (method === 'setAgentAutomationEnabled') {
      if (args.isEnabled) {
        // This is what matters at the execution boundary: no enabled routine
        // may exist without a fully written goal and user intent record.
        expect(JSON.parse(readFileSync(ledgerPath(), 'utf8')).acceptance).toHaveLength(2)
        expect(JSON.parse(readFileSync(join(root, 'dsh-bots-goals', 'bot', 'goal-1.json'), 'utf8')).automationId).toBe('routine-1')
      }
      autos[0].isEnabled = args.isEnabled
      return autos
    }
    if (method === 'interruptAgent') { agent.isRunning = false; return { hadActiveRun: true } }
    throw new Error('Unexpected method: ' + method)
  }
  const input = { agentId: 'bot', requestId: 'goal-1', objective: '修复登录并回归', acceptance: ['问题可复现', '回归通过'] }
  const workflow = new GoalWorkflow(root, rpc)
  const update = (patch: any) => writeFileSync(ledgerPath(), JSON.stringify({ ...JSON.parse(readFileSync(ledgerPath(), 'utf8')), ...patch }))
  return { root, agent, autos, calls, rpc, input, workflow, update, ledgerPath, fail: (method: string) => { fail = method } }
}

describe('persistent goal workflow', () => {
  it('arms only after writing the ledger and survives a new host instance', async () => {
    const f = fixture()
    expect((await f.workflow.create(f.input))[0].status).toBe('scheduled')
    expect(f.calls.find(c => c.method === 'createAgentAutomation')?.args.spec.isEnabled).toBe(false)
    const recovered = new GoalWorkflow(f.root, f.rpc)
    expect((await recovered.list('bot'))[0]).toMatchObject({ objective: f.input.objective, intervalMinutes: 1, nextRunAt: 123456 })
  })
  it('serializes concurrent duplicate requests and never resumes on retry', async () => {
    const f = fixture()
    await Promise.all([f.workflow.create(f.input), new GoalWorkflow(f.root, f.rpc).create(f.input)])
    expect(f.calls.filter(c => c.method === 'createAgentAutomation')).toHaveLength(1)
    await f.workflow.act({ agentId: 'bot', goalId: 'goal-1', action: 'pause' })
    expect((await f.workflow.create(f.input))[0].status).toBe('paused')
    await expect(f.workflow.create({ ...f.input, objective: 'changed' })).rejects.toThrow('different goal')
  })
  it('does not permit a second unfinished goal or missing acceptance criteria', async () => {
    const f = fixture()
    await expect(f.workflow.create({ ...f.input, acceptance: [] })).rejects.toThrow('acceptance criteria')
    await f.workflow.create(f.input)
    await expect(f.workflow.create({ ...f.input, requestId: 'goal-2' })).rejects.toThrow('existing goal')
  })
  it('can retry setup after a gateway failure without losing user intent', async () => {
    const f = fixture(); f.fail('createAgentAutomation')
    await expect(f.workflow.create(f.input)).rejects.toThrow('temporary failure')
    expect((await f.workflow.list('bot'))[0]).toMatchObject({ status: 'attention', setupPending: true })
    f.fail('')
    expect((await f.workflow.create(f.input))[0].status).toBe('scheduled')
  })
  it('adopts a created disabled routine after losing its response', async () => {
    const f = fixture()
    let once = true
    const unreliable = new GoalWorkflow(f.root, async (method, args) => {
      const result = await f.rpc(method, args)
      if (method === 'createAgentAutomation' && once) { once = false; throw new Error('lost response') }
      return result
    })
    await expect(unreliable.create(f.input)).rejects.toThrow('lost response')
    expect((await unreliable.create(f.input))[0].status).toBe('scheduled')
    expect(f.autos).toHaveLength(1)
  })
  it('refuses to adopt an unrelated routine with the same name', async () => {
    const f = fixture()
    f.autos.push({ id: 'other', name: 'DSH-GOAL-goal-1', isEnabled: false,
      trigger: { type: 'cron', schedule: '@every 1m' }, prompt: 'unrelated work', runs: [] })
    await expect(f.workflow.create(f.input)).rejects.toThrow('different routine')
    expect(f.autos).toHaveLength(1)
    expect(f.autos[0].isEnabled).toBe(false)
    expect((await f.workflow.list('bot'))[0]).toMatchObject({ status: 'attention', setupPending: true })
  })
  it('leaves a recoverable paused goal if enabling fails', async () => {
    const f = fixture(); f.fail('setAgentAutomationEnabled')
    await expect(f.workflow.create(f.input)).rejects.toThrow('temporary failure')
    expect((await f.workflow.list('bot'))[0].status).toBe('paused')
    f.fail('')
    expect((await f.workflow.act({ agentId: 'bot', goalId: 'goal-1', action: 'resume' }))[0].status).toBe('scheduled')
  })
  it('disarms before interrupting, including when interruption fails', async () => {
    const f = fixture(); await f.workflow.create(f.input); f.calls.length = 0
    f.autos[0].runs = [{ id: 'run1', status: 'running', startedAt: Date.now() }]
    f.fail('interruptAgent')
    await expect(f.workflow.act({ agentId: 'bot', goalId: 'goal-1', action: 'pause' })).rejects.toThrow('temporary failure')
    const writes = f.calls.filter(c => ['setAgentAutomationEnabled', 'interruptAgent'].includes(c.method))
    expect(writes.map(c => c.method)).toEqual(['setAgentAutomationEnabled', 'interruptAgent'])
    expect(f.autos[0].isEnabled).toBe(false)
  })
  it('pauses the schedule without interrupting an unrelated chat run', async () => {
    const f = fixture(); await f.workflow.create(f.input); f.calls.length = 0
    f.agent.isRunning = true
    expect((await f.workflow.act({ agentId: 'bot', goalId: 'goal-1', action: 'pause' }))[0].status).toBe('paused')
    expect(f.calls.map(c => c.method)).not.toContain('interruptAgent')
    expect(f.autos[0].isEnabled).toBe(false)
  })
  it('requires explicit acceptance and all criteria, not just model status', async () => {
    const f = fixture(); await f.workflow.create(f.input)
    f.update({ status: 'achieved' })
    expect((await f.workflow.list('bot'))[0].status).toBe('review')
    await expect(f.workflow.act({ agentId: 'bot', goalId: 'goal-1', action: 'complete' })).rejects.toThrow('Every acceptance')
    f.update({ acceptance: f.input.acceptance.map((text, i) => ({ id: `c${i + 1}`, text, done: true })) })
    expect((await f.workflow.act({ agentId: 'bot', goalId: 'goal-1', action: 'complete' }))[0].status).toBe('completed')
    expect(f.autos[0].isEnabled).toBe(false)
    await expect(f.workflow.act({ agentId: 'bot', goalId: 'goal-1', action: 'resume' })).rejects.toThrow('already ended')
  })
  it('returns rejected work to execution with feedback and cleared claims', async () => {
    const f = fixture(); await f.workflow.create(f.input)
    f.update({ status: 'achieved', acceptance: f.input.acceptance.map((text, i) => ({ id: `c${i + 1}`, text, done: true })) })
    await expect(f.workflow.act({ agentId: 'bot', goalId: 'goal-1', action: 'resume' })).rejects.toThrow('Review')
    const goals = await f.workflow.act({ agentId: 'bot', goalId: 'goal-1', action: 'revise', feedback: '补测移动端' })
    expect(goals[0]).toMatchObject({ status: 'scheduled', note: '补测移动端' })
    expect(goals[0].acceptance.every(c => !c.done)).toBe(true)
    expect(goals[0].checkpoint).toContain('补测移动端')
  })
  it('does not overwrite a running bot ledger during resume', async () => {
    const f = fixture(); await f.workflow.create(f.input); f.agent.isRunning = true
    const before = readFileSync(f.ledgerPath(), 'utf8')
    await expect(f.workflow.act({ agentId: 'bot', goalId: 'goal-1', action: 'resume' })).rejects.toThrow('wait for')
    expect(readFileSync(f.ledgerPath(), 'utf8')).toBe(before)
    expect(f.autos[0].isEnabled).toBe(false)
  })
  it('keeps corrupted or rewritten criteria visible and refuses completion', async () => {
    const f = fixture(); await f.workflow.create(f.input)
    f.update({ acceptance: [{ id: 'c1', text: '降低标准', done: true }] })
    expect((await f.workflow.list('bot'))[0].status).toBe('attention')
    await expect(f.workflow.act({ agentId: 'bot', goalId: 'goal-1', action: 'complete' })).rejects.toThrow('criteria changed')
    expect((await f.workflow.act({ agentId: 'bot', goalId: 'goal-1', action: 'cancel' }))[0].status).toBe('cancelled')
  })
  it('rejects traversal and symlink escapes before writing outside the data root', async () => {
    const f = fixture()
    await expect(f.workflow.list('../escape')).rejects.toThrow('Invalid')
    const outside = mkdtempSync(join(tmpdir(), 'dsh-outside-')); dirs.push(outside)
    symlinkSync(outside, join(f.root, 'dsh-bots-goals'))
    await expect(f.workflow.create(f.input)).rejects.toThrow('escapes')
  })
  it('reports engine run failures separately from goal acceptance', async () => {
    const f = fixture(); await f.workflow.create(f.input)
    f.autos[0].runs = [{ id: 'run1', status: 'error', startedAt: Date.now(), finishedAt: Date.now(), detail: 'upstream unavailable' }]
    const goal = (await f.workflow.list('bot'))[0]
    expect(goal.status).toBe('scheduled')
    expect(goal.runs[0].detail).toBe('upstream unavailable')
    expect(goal.acceptance.some(c => c.done)).toBe(false)
  })
  it('surfaces an engine guard failure when a goal was disarmed', async () => {
    const f = fixture(); await f.workflow.create(f.input)
    f.autos[0].isEnabled = false
    f.autos[0].runs = [{ id: 'run1', status: 'error', startedAt: Date.now(),
      detail: 'Goal loop stopped by the engine (ledger write failed); repair the ledger before resuming.' }]
    expect((await f.workflow.list('bot'))[0]).toMatchObject({ status: 'paused', note: f.autos[0].runs[0].detail })
  })
})
