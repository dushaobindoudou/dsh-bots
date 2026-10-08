/** Persistent goal workflow over the engine's durable automation scheduler.
 * The engine owns execution. This adapter owns user intent and review, never
 * calls sendPrompt in a browser timer, and never treats model claims as proof.
 */
import { mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

type Rpc = (method: string, args: Record<string, unknown>) => Promise<any>
interface Criterion { id: string; text: string; done: boolean }
interface Ledger {
  version: 1; objective: string; acceptance: Criterion[]
  status: 'active' | 'achieved' | 'blocked' | 'abandoned'
  cycle: number; stallCount: number; updatedAt: number; lastFiredAt: number | null; note?: string
}
interface GoalRecord {
  version: 1; id: string; agentId: string; objective: string; acceptance: Criterion[]
  intervalMinutes: number; createdAt: number; automationId: string | null
  disposition: 'open' | 'completed' | 'cancelled'; reviewedAt?: number
}
export interface GoalCreate {
  agentId: string; requestId: string; objective: string; acceptance: string[]; intervalMinutes?: number
}
export interface GoalAction {
  agentId: string; goalId: string; action: 'pause' | 'resume' | 'complete' | 'cancel' | 'revise'; feedback?: string
}
export interface GoalView {
  id: string; agentId: string; objective: string; createdAt: number; intervalMinutes: number
  setupPending: boolean
  status: 'scheduled' | 'running' | 'paused' | 'blocked' | 'review' | 'completed' | 'cancelled' | 'attention'
  acceptance: Criterion[]; cycle: number; nextRunAt: number | null; note: string | null
  checkpoint: string | null; runs: Array<{ id: string; status: string; startedAt: number; finishedAt: number | null; detail?: string }>
}

function safeId(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w-]{1,128}$/.test(value)) throw new Error('Invalid goal or agent id')
  return value
}
function readJson(path: string): any {
  if (statSync(path).size > 1024 * 1024) throw new Error('Goal file exceeds 1MB')
  return JSON.parse(readFileSync(path, 'utf8'))
}
function atomic(path: string, value: unknown): void {
  const tmp = path + '.' + randomUUID() + '.tmp'
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, path)
}
const queues = new Map<string, Promise<unknown>>()

export class GoalWorkflow {
  constructor(private readonly root: string, private readonly rpc: Rpc) {}

  /** Validate every existing ancestor, including symlinks supplied by a bot. */
  private path(...parts: string[]): string {
    const root = realpathSync(this.root)
    let path = root
    for (const part of parts) {
      path = join(path, part)
      try {
        const real = realpathSync(path)
        if (real !== root && !real.startsWith(root + sep)) throw new Error('Goal path escapes data directory')
      } catch (error: any) { if (error.code !== 'ENOENT') throw error }
    }
    return path
  }
  private store(agentId: string): string {
    const dir = this.path('dsh-bots-goals', safeId(agentId))
    mkdirSync(dir, { recursive: true })
    return dir
  }
  private file(agentId: string, id: string): string {
    this.store(agentId)
    return this.path('dsh-bots-goals', safeId(agentId), safeId(id) + '.json')
  }
  private records(agentId: string): GoalRecord[] {
    return readdirSync(this.store(agentId)).filter(f => f.endsWith('.json')).map(f => {
      const record = readJson(this.file(agentId, f.slice(0, -5))) as GoalRecord
      if (record.version !== 1 || record.agentId !== agentId || record.id !== f.slice(0, -5)
        || !Array.isArray(record.acceptance)) throw new Error('Invalid saved goal; repair it before continuing')
      return record
    }).sort((a, b) => b.createdAt - a.createdAt)
  }
  private exclusive<T>(agentId: string, operation: () => Promise<T>): Promise<T> {
    const key = this.root + ':' + safeId(agentId)
    const previous = queues.get(key) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(operation)
    queues.set(key, next)
    void next.finally(() => { if (queues.get(key) === next) queues.delete(key) }).catch(() => {})
    return next
  }
  private async automations(agentId: string): Promise<any[]> {
    const result = await this.rpc('getAgentAutomations', { id: safeId(agentId) })
    const rows = Array.isArray(result) ? result : result?.automations
    if (!Array.isArray(rows)) throw new Error('Engine does not expose automations')
    return rows
  }
  private ledgerPath(record: GoalRecord): string {
    return this.path('agents', record.agentId, 'automations', safeId(record.automationId), 'goal.json')
  }
  private allowCheckpointWrites(record: GoalRecord): void {
    const path = this.path('agents', record.agentId, 'settings.json')
    let settings: any
    try { settings = readJson(path) } catch (error: any) { if (error.code === 'ENOENT') return; throw error }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Invalid bot settings')
    if (!settings.workspaceRoot) return
    const allowed = settings.workspaceAllowPaths ?? []
    if (!Array.isArray(allowed)) throw new Error('Invalid workspace allow paths')
    // A jailed bot needs a narrowly scoped writable checkpoint directory.
    // Grant this goal's directory only, preserving all existing settings.
    const directory = dirname(this.ledgerPath(record))
    if (!allowed.includes(directory)) atomic(path, { ...settings, workspaceAllowPaths: [...allowed, directory] })
  }
  private ledger(record: GoalRecord): Ledger {
    const ledger = readJson(this.ledgerPath(record)) as Ledger
    if (ledger.version !== 1 || ledger.objective !== record.objective
      || !Array.isArray(ledger.acceptance) || ledger.acceptance.length !== record.acceptance.length
      || !record.acceptance.every((c, i) => ledger.acceptance[i]?.id === c.id && ledger.acceptance[i]?.text === c.text)
      || !['active', 'achieved', 'blocked', 'abandoned'].includes(ledger.status)
      || !Number.isFinite(ledger.cycle) || !Number.isFinite(ledger.stallCount)) {
      throw new Error('Goal ledger is invalid or acceptance criteria changed; pause and inspect the goal')
    }
    return ledger
  }
  private view(record: GoalRecord, automation: any): GoalView {
    let ledger: Ledger | null = null
    let issue: string | null = null
    if (record.automationId !== null) {
      try { ledger = this.ledger(record) } catch (error: any) { issue = error.message }
    }
    let checkpoint: string | null = null
    if (record.automationId !== null) {
      try {
        const path = this.path('agents', record.agentId, 'automations', safeId(record.automationId), 'progress.md')
        if (statSync(path).size <= 128 * 1024) checkpoint = readFileSync(path, 'utf8')
      } catch { /* a checkpoint is optional, unlike the ledger */ }
    }
    const runs = (Array.isArray(automation?.runs) ? automation.runs : []).slice(0, 8).map((run: any) => ({
      id: String(run.id), status: String(run.status), startedAt: Number(run.startedAt),
      finishedAt: typeof run.finishedAt === 'number' ? run.finishedAt : null,
      ...(typeof run.detail === 'string' ? { detail: run.detail.slice(0, 4000) } : {}),
    }))
    const stoppedByGuard = automation?.isEnabled === false && runs[0]?.status === 'error'
      && runs[0].detail?.startsWith('Goal loop stopped by the engine (') ? runs[0].detail : null
    const claimed = ledger?.status === 'achieved' || ledger?.acceptance.every(c => c.done === true)
    const status: GoalView['status'] = record.disposition !== 'open' ? record.disposition
      : issue !== null || !automation ? 'attention'
        : claimed ? 'review' : ledger?.status === 'blocked' ? 'blocked'
          : ledger?.status === 'abandoned' ? 'attention'
            : automation.isEnabled !== true ? 'paused'
              : runs[0]?.status === 'running' ? 'running' : 'scheduled'
    return {
      id: record.id, agentId: record.agentId, objective: record.objective, createdAt: record.createdAt,
      setupPending: record.automationId === null,
      intervalMinutes: record.intervalMinutes, status,
      acceptance: ledger?.acceptance ?? record.acceptance, cycle: ledger?.cycle ?? 0,
      nextRunAt: status === 'scheduled' && typeof automation?.nextRunAt === 'number' ? automation.nextRunAt : null,
      note: issue ?? (record.automationId === null ? 'Goal setup is incomplete; retry creating it'
        : !automation ? 'Engine routine is missing; retry creating this goal' : stoppedByGuard ?? ledger?.note ?? null),
      checkpoint, runs,
    }
  }
  async list(agentId: string): Promise<GoalView[]> {
    const records = this.records(safeId(agentId))
    if (records.length === 0) return []
    const autos = await this.automations(agentId)
    return records.map(r => this.view(r, autos.find(a => a.id === r.automationId)))
  }
  async create(input: GoalCreate): Promise<GoalView[]> {
    return this.exclusive(input.agentId, async () => {
      const id = safeId(input.requestId)
      if (id.length > 48) throw new Error('Goal request id must be at most 48 characters')
      const objective = typeof input.objective === 'string' ? input.objective.trim() : ''
      const criteria = Array.isArray(input.acceptance) ? input.acceptance.map(c => typeof c === 'string' ? c.trim() : '') : []
      const interval = input.intervalMinutes ?? 1
      if (!objective || objective.length > 8000 || criteria.length < 1 || criteria.length > 20
        || criteria.some(c => !c || c.length > 2000) || ![1, 5, 15, 30].includes(interval)) {
        throw new Error('Provide a goal, 1–20 acceptance criteria, and a supported interval')
      }
      const agents = await this.rpc('listAgents', {})
      const agent = (Array.isArray(agents) ? agents : agents?.agents ?? []).find((a: any) => a.id === input.agentId)
      if (!agent || agent.isGroup) throw new Error('Goals currently require a single bot')
      const records = this.records(input.agentId)
      let record = records.find(r => r.id === id)
      if (record && (record.objective !== objective || record.intervalMinutes !== interval
        || JSON.stringify(record.acceptance.map(c => c.text)) !== JSON.stringify(criteria))) {
        throw new Error('This request id already belongs to a different goal')
      }
      if (!record && records.some(r => r.disposition === 'open')) throw new Error('Complete or cancel the existing goal first')
      if (!record) {
        record = { version: 1, id, agentId: input.agentId, objective,
          acceptance: criteria.map((text, i) => ({ id: `c${i + 1}`, text, done: false })),
          intervalMinutes: interval, createdAt: Date.now(), automationId: null, disposition: 'open' }
        atomic(this.file(input.agentId, id), record)
      }
      // Repeated delivery must not resume a paused or completed goal.
      if (record.automationId !== null) return this.list(input.agentId)
      const name = 'DSH-GOAL-' + id
      const prompt = [
        '持续推进下面的目标。每轮先读 <goal_guard> 中的台账，以及同目录 progress.md 恢复点。',
        `目标：${objective}`, '验收标准不可自行删除、改写或降低：',
        ...record.acceptance.map(c => `${c.id}: ${c.text}`),
        '检查当前工作区与已有产物，选择一个可验证的步骤并执行。重复运行前先核对副作用是否已经发生。',
        '更新 progress.md：本轮实际变化、每条验收对应的证据路径或验证结果、下一步、需要用户决定的问题。',
        '按 goal_guard 更新台账。只有实际证据成立才标记 done；全部满足时声明 achieved，等待用户验收。',
        '不能因为一轮结束而声明完成。需要用户提供信息时写 blocked 和具体 note；不要反复重试相同失败。',
        '保持目标和验收文本不变，不要自行修改调度设置或创建其他例行任务。',
      ].join('\n')
      let autos = await this.automations(input.agentId)
      let automation = autos.find(a => a.name === name)
      // A retry may adopt a routine whose creation response was lost, but a
      // user-created routine with the same name must never be repurposed.
      if (automation && (automation.prompt !== prompt
        || automation.trigger?.type !== 'cron'
        || automation.trigger.schedule !== `@every ${interval}m`)) {
        throw new Error('A different routine already uses this goal name')
      }
      if (!automation) {
        await this.rpc('createAgentAutomation', { id: input.agentId, spec: {
          name, isEnabled: false, trigger: { type: 'cron', schedule: `@every ${interval}m` },
          prompt,
        } })
        autos = await this.automations(input.agentId)
        automation = autos.find(a => a.name === name)
      }
      if (!automation || automation.isEnabled || automation.prompt !== prompt
        || automation.trigger?.type !== 'cron' || automation.trigger.schedule !== `@every ${interval}m`) {
        throw new Error('Goal routine was not created in the expected paused state')
      }
      record.automationId = safeId(automation.id)
      const path = this.ledgerPath(record)
      // Engine must have created its own directory before we write the ledger.
      if (!statSync(dirname(path)).isDirectory()) throw new Error('Engine routine directory is missing')
      const ledger: Ledger = { version: 1, objective, acceptance: record.acceptance,
        status: 'active', cycle: 0, stallCount: 0, updatedAt: Date.now(), lastFiredAt: null }
      atomic(path, ledger)
      this.allowCheckpointWrites(record)
      atomic(this.file(input.agentId, id), record)
      // A failure here leaves a visible, recoverable paused goal. No rollback
      // can accidentally delete a routine that the engine already accepted.
      await this.rpc('setAgentAutomationEnabled', { id: input.agentId, automationId: automation.id, isEnabled: true })
      return this.list(input.agentId)
    })
  }
  async act(input: GoalAction): Promise<GoalView[]> {
    return this.exclusive(input.agentId, async () => {
      const record = this.records(input.agentId).find(r => r.id === safeId(input.goalId))
      if (!record) throw new Error('Goal not found')
      if (!['pause', 'resume', 'complete', 'cancel', 'revise'].includes(input.action)) throw new Error('Unknown goal action')
      if (record.disposition !== 'open') throw new Error('This goal has already ended')
      const autos = await this.automations(input.agentId)
      const automation = autos.find(a => a.id === record.automationId || a.name === 'DSH-GOAL-' + record.id)
      if (!automation) {
        if (input.action !== 'cancel') throw new Error('Engine routine is missing')
        record.disposition = 'cancelled'
        atomic(this.file(input.agentId, record.id), record)
        return this.list(input.agentId)
      }
      const args = { id: input.agentId, automationId: automation.id }
      if (input.action === 'pause' || input.action === 'cancel') {
        // Disarm first: interrupt alone would let the next tick restart work.
        await this.rpc('setAgentAutomationEnabled', { ...args, isEnabled: false })
        // The bot may also be handling a manual chat. Only interrupt a run
        // that belongs to this goal's routine.
        if (automation.runs?.some((run: any) => run.status === 'running')) {
          await this.rpc('interruptAgent', { id: input.agentId, reason: '用户暂停了目标执行' })
        }
        if (input.action === 'cancel') {
          record.disposition = 'cancelled'
          atomic(this.file(input.agentId, record.id), record)
        }
        return this.list(input.agentId)
      }
      const ledger = this.ledger(record)
      if (input.action === 'complete' && !ledger.acceptance.every(c => c.done === true)) {
        throw new Error('Every acceptance criterion must be ready for review')
      }
      if (input.action === 'resume' && (ledger.status === 'achieved' || ledger.acceptance.every(c => c.done))) {
        throw new Error('Review this goal or return it with feedback')
      }
      const feedback = typeof input.feedback === 'string' ? input.feedback.trim() : ''
      if (input.action === 'revise' && (!feedback || feedback.length > 8000)) throw new Error('Describe what still needs work')
      await this.rpc('setAgentAutomationEnabled', { ...args, isEnabled: false })
      const agents = await this.rpc('listAgents', {})
      const agent = (Array.isArray(agents) ? agents : agents?.agents ?? []).find((a: any) => a.id === input.agentId)
      if (!agent || agent.isRunning || agent.isComposingMessage) throw new Error('Goal is paused; wait for the current run to stop before continuing')
      if (input.action === 'complete') {
        record.disposition = 'completed'; record.reviewedAt = Date.now()
        atomic(this.file(input.agentId, record.id), record)
      } else {
        this.allowCheckpointWrites(record)
        atomic(this.ledgerPath(record), { ...ledger, status: 'active', stallCount: 0, updatedAt: Date.now(),
          ...(input.action === 'revise' ? { acceptance: record.acceptance.map(c => ({ ...c, done: false })), note: feedback } : {}) })
        if (input.action === 'revise') {
          // The engine's injected guard omits ledger.note; put feedback in
          // the checkpoint that the routine reads explicitly every cycle.
          const path = this.path('agents', record.agentId, 'automations', safeId(record.automationId), 'progress.md')
          let previous = ''
          try { if (statSync(path).size <= 128 * 1024) previous = readFileSync(path, 'utf8') } catch { /* first checkpoint */ }
          writeFileSync(path, `${previous}\n\n## 用户要求继续改进\n${feedback}\n`, 'utf8')
        }
        await this.rpc('setAgentAutomationEnabled', { ...args, isEnabled: true })
      }
      return this.list(input.agentId)
    })
  }
}
