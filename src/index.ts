/**
 * dsh-plugin-bots — host half.
 *
 * Bridges the sdk-bots orchestration gateway (single bots, group chats,
 * transcripts, live SSE) into dsh as a formal plugin. Publishes the `bots`
 * Remote namespace through the Typert gateway: every method takes a single
 * `request` JSON value and returns plain JSON (source-mode descriptors,
 * matching how the web client calls `bots/<method>` over the connection
 * RPC carrier).
 *
 * Typert identity: dsh's host identifies a `TypertRemoteService` by the module
 * instance it was loaded from — not by name. When this plugin is installed by
 * pnpm it can resolve a *separate* copy of `@deepseek-ai/dsh-typert-protocol`
 * from its own node_modules, producing a class that is unequal to the host's
 * and silently dropping every method. We therefore anchor at load time to the
 * running dsh CLI / global layout (the same technique used by dsh-freeroute)
 * and only fall back to plain resolution when anchoring fails. The `Remote`
 * markers are applied with a decorator-context shim for the same reason.
 * @module dsh-plugin-bots
 */

import type { Context } from '@deepseek-ai/cordis'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { appendFileSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import type {
  AgentInfo, Config, EventsSinceResult, GatewayInfo, SessionInfo,
  SseState, TranscriptEntry, WorkspaceInfo,
} from './shared.js'
import { callGateway, discover, expandHome, nextNonce, normalizeAgents, readDiscovery, trimAgent, trimEntry } from './gateway.js'
import { GatewaySseClient, SseRingBuffer } from './sse.js'
import { UnreadStore } from './unread.js'
import { satisfiesCaret } from './version.js'

export const name = 'dsh-plugin-bots'

/** No hard Cordis service requirements: host reads optional services via
 * guarded `ctx.get` so a partially-provisioned kernel never blocks activation. */
export const inject: string[] = []

/** Cordis range this plugin is tested against; only surfaces a warning. */
export const TESTED_CORDIS_RANGE = '^4.0.1'

const DEFAULT_DATA_DIR = '~/.sdk-bots'

/** Append-only diagnostics file, read when a shadow takeover misbehaves. */
const DIAG_FILE = 'dsh-bots-diag.jsonl'

/** Persisted read markers ("读到哪了") backing the sidebar unread badge. */
const UNREAD_FILE = 'dsh-bots-unread.json'

/** Stamped into every diagnostic line so records survive version skew. */
const PLUGIN_VERSION = resolvedModuleVersion('dsh-plugin-bots')

const require = createRequire(import.meta.url)

/** Resolve a package version without tripping `exports` maps (no /package.json). */
function resolvedModuleVersion(id: string): string {
  try {
    const entry = require.resolve(id)
    const manifest = join(dirname(dirname(entry)), 'package.json')
    const pkg = require(manifest) as { version?: string }
    return pkg.version ?? 'unknown'
  } catch {
    return 'unresolved'
  }
}

/**
 * Peer-compatibility probe — non-fatal. An unresolvable version or a caret
 * skew inside the tested range must not brick the whole plugin tree (the
 * guard existed to surface silent mismatches loudly).
 */
export function assertPeerCompatible(): void {
  const cordis = resolvedModuleVersion('@deepseek-ai/cordis')
  if (cordis !== 'unknown' && cordis !== 'unresolved' && !satisfiesCaret(cordis, TESTED_CORDIS_RANGE)) {
    // eslint-disable-next-line no-console
    console.warn(`[dsh-plugin-bots] resolved @deepseek-ai/cordis ${cordis}, tested with ${TESTED_CORDIS_RANGE}`)
  }
}

interface TypertRuntime {
  Remote: (exportName: string) => any
  TypertRemoteService: any
}

/**
 * Anchor to the running dsh CLI / global layout where the host's typert copy
 * lives, mirroring dsh-freeroute. Tries argv anchors, the global npm layout,
 * then plain resolution; returns the first module exposing the Typert API.
 */
async function resolveTypert(): Promise<TypertRuntime> {
  const candidates: Array<() => Promise<any>> = []
  try {
    const anchors: string[] = []
    for (const a of [process.argv && process.argv[1], process.argv && process.argv[0]]) {
      if (typeof a !== 'string' || a.length === 0) continue
      anchors.push(a)
      try { anchors.push(realpathSync(a)) } catch { /* keep original */ }
    }
    for (const a of anchors) {
      // eslint-disable-next-line @typescript-eslint/no-loop-func
      candidates.push(async () => import(pathToFileURL(createRequire(a).resolve('@deepseek-ai/dsh-typert-protocol')).href))
    }
    if (process.execPath) {
      const cand = join(dirname(dirname(process.execPath)), 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-typert-protocol', 'lib', 'index.js')
      candidates.push(async () => import(pathToFileURL(cand).href))
    }
  } catch { /* anchoring failed → fall back to plain resolution */ }
  candidates.push(async () => import('@deepseek-ai/dsh-typert-protocol'))
  for (const load of candidates) {
    try {
      const m = await load()
      if (m && m.TypertRemoteService && m.Remote) {
        return { Remote: m.Remote, TypertRemoteService: m.TypertRemoteService }
      }
    } catch { /* try next anchor */ }
  }
  throw new Error('[dsh-plugin-bots] 无法解析 @deepseek-ai/dsh-typert-protocol（宿主锚定与回退均失败）')
}

const { Remote, TypertRemoteService } = await resolveTypert()

/** Apply one `@Remote(method)` marker via a decorator-context shim. */
function markRemoteMethod(prototype: object, method: string): void {
  const decorator = Remote(method)
  decorator(undefined, {
    name: method,
    private: false,
    static: false,
    addInitializer(fn: () => void) { fn.call(Object.create(prototype)) },
  })
}

/**
 * The `bots` Remote namespace. One method per gateway capability, plus
 * host-backed lists (workspaces/sessions) and live SSE replay so the web
 * workbench renders natively without polling the transcript API.
 */
/** Exported for diagnostics/tests: marker assertions need the prototype. */
export class BotsRemote extends TypertRemoteService {
  private readonly cfg: Config
  private readonly sse: GatewaySseClient
  private readonly unread: UnreadStore
  private rebasing = false

  constructor(ctx: Context, config: Config) {
    super(ctx, 'bots')
    this.cfg = { dataDir: config?.dataDir ?? DEFAULT_DATA_DIR }
    this.unread = new UnreadStore(join(expandHome(this.cfg.dataDir), UNREAD_FILE))
    const ring = new SseRingBuffer(3000, (channel, data) => { this.observeTranscript(channel, data) })
    this.sse = new GatewaySseClient({
      ring,
      resolveBase: () => {
        const d = readDiscovery(this.cfg.dataDir)
        if (d === null) return null
        return { url: `http://${d.host}:${d.port}`, token: d.token }
      },
      channels: ['transcript', 'client-side-tool-v2', 'agents', 'agent-upserted', 'host-settings', 'outline'],
      onConnected: () => { void this.rebaseUnread() },
    })
  }

  /**
   * Ring observer: feed the unread model from live transcript traffic.
   * `appended` is the single-arrival shape; the gateway also replays a
   * `snapshot` payload on (re)connect — both are timestamp-guarded, so
   * replays never double-count.
   */
  private observeTranscript(channel: string, data: unknown): void {
    if (channel !== 'transcript' || data === null || typeof data !== 'object') return
    const payload = data as any
    if (payload?.type === 'appended') {
      this.unread.bump(String(payload?.agentId ?? ''), payload?.entry)
    } else if (payload?.type === 'snapshot' && Array.isArray(payload?.entries)) {
      const agentId = String(payload?.activeAgentId ?? '')
      for (const entry of payload.entries) this.unread.bump(agentId, entry)
    }
  }

  /**
   * Reconstruct counts from transcript tails (SSE has no replay, so events
   * that fire while the stream is down would otherwise be lost forever).
   * Runs once per (re)connect; never throws; skips while one is in flight.
   */
  private async rebaseUnread(): Promise<void> {
    if (this.rebasing) return
    this.rebasing = true
    try {
      const agents = normalizeAgents(await callGateway<any>(this.cfg.dataDir, 'listAgents', {}))
      for (const agent of agents) {
        try {
          const res = await callGateway<any>(this.cfg.dataDir, 'getAgentTranscriptTail', { id: agent.id, limit: 50 })
          this.unread.rebase(agent.id, Array.isArray(res?.entries) ? res.entries : [])
        } catch { /* one failed tail must not stop the others */ }
      }
      this.unread.prune(new Set(agents.map((a) => a.id)))
    } catch { /* gateway offline — the next reconnect retries */ } finally {
      this.rebasing = false
    }
  }

  async gatewayInfo(request: { dataDir?: string } | null): Promise<GatewayInfo> {
    const dataDir = request?.dataDir ?? this.cfg.dataDir
    // Report the CONFIGURED directory, so the settings page stops showing a
    // hardcoded default after the operator overrides `dataDir` in cordis.yml.
    return { ...await discover(dataDir), dataDir }
  }

  /**
   * Descriptor contract: every remote method declares exactly one plain
   * `request` formal parameter (no defaults/destructuring/rest) — the
   * source-mode descriptor derives its wire field from the parameter name,
   * and the client always sends `{ args: { request } }`. A zero-param method
   * would make the gateway reject the envelope with "unexpected request".
   */
  async list(request: unknown): Promise<AgentInfo[]> {
    return normalizeAgents(await callGateway<any>(this.cfg.dataDir, 'listAgents', {}))
  }

  async workspaces(request: unknown): Promise<{ workspaces: WorkspaceInfo[] }> {
    const registry = this.ctx.get('workspaceRegistry')
    if (registry === undefined || typeof registry.list !== 'function') return { workspaces: [] }
    try {
      const list = await registry.list() as any[]
      return {
        workspaces: (Array.isArray(list) ? list : []).map((w) => ({
          id: String(w.id),
          title: typeof w.title === 'string' ? w.title : '',
          path: typeof w.path === 'string' || w.path === null ? w.path : null,
        })),
      }
    } catch {
      return { workspaces: [] }
    }
  }

  async sessions(request: unknown): Promise<{ sessions: SessionInfo[] }> {
    const q = this.ctx.get('sessionQuery')
    if (q === undefined || typeof q.listSessions !== 'function') return { sessions: [] }
    const records = await q.listSessions() as any[]
    const recent = (Array.isArray(records) ? records : [])
      .filter((r) => r !== null && typeof r === 'object' && r.header !== undefined)
      .sort((a, b) => (b.header.createdAt ?? 0) - (a.header.createdAt ?? 0))
      .slice(0, 15)
    const titleMap = new Map<string, string>()
    const titleSvc = this.ctx.get('sessionTitle')
    if (titleSvc !== undefined && typeof titleSvc.readTitleSnapshots === 'function') {
      const obs = await titleSvc.readTitleSnapshots(recent.map((r) => r.header.id)) as any[]
      for (const o of Array.isArray(obs) ? obs : []) {
        if (o?.status === 'fulfilled' && o.value?.title?.title) titleMap.set(o.sessionId, o.value.title.title)
      }
    }
    return {
      sessions: recent.map((r) => ({
        id: r.header.id,
        title: titleMap.get(r.header.id)
          ?? (r.header.cwd ? String(r.header.cwd).split('/').pop()! : '未命名会话'),
        live: Boolean(r.live),
      })),
    }
  }

  async create(request: { name?: string; description?: string } | null): Promise<AgentInfo | null> {
    const created = await callGateway<any>(this.cfg.dataDir, 'createAgent', {
      name: String(request?.name ?? '').trim(),
      description: request?.description ? String(request.description) : '',
      clientNonce: nextNonce(),
    })
    return trimAgent(created?.agent ?? created)
  }

  async createGroup(request: { name?: string; memberIds?: string[] } | null): Promise<AgentInfo | null> {
    const created = await callGateway<any>(this.cfg.dataDir, 'createGroup', {
      name: String(request?.name ?? '').trim(),
      memberAgentIds: Array.isArray(request?.memberIds) ? request.memberIds : [],
    })
    return trimAgent(created?.agent ?? created)
  }

  async update(request: { id?: string; profile?: Record<string, unknown> } | null): Promise<AgentInfo | null> {
    const updated = await callGateway<any>(this.cfg.dataDir, 'updateAgent', {
      id: request?.id,
      profile: request?.profile ?? {},
    })
    return trimAgent(updated?.agent ?? updated)
  }

  async remove(request: { id?: string } | null): Promise<unknown> {
    return callGateway(this.cfg.dataDir, 'deleteAgent', { id: request?.id })
  }

  async send(request: { agentId?: string; prompt?: string } | null): Promise<unknown> {
    return callGateway(this.cfg.dataDir, 'sendPrompt', {
      agentId: request?.agentId,
      prompt: String(request?.prompt ?? ''),
      clientNonce: nextNonce(),
    })
  }

  async transcriptTail(request: { id?: string; limit?: number } | null): Promise<{ entries: TranscriptEntry[] }> {
    const res = await callGateway<any>(this.cfg.dataDir, 'getAgentTranscriptTail', {
      id: request?.id,
      limit: Number(request?.limit) || 40,
    })
    const entries: any[] = Array.isArray(res?.entries) ? res.entries : []
    return { entries: entries.map(trimEntry) }
  }

  /**
   * Clear an agent's unread badge. The plugin owns the unread model (see
   * `unread.ts`): the marker "上次读到哪" advances to now and the count
   * zeroes. The gateway call is kept best-effort so desktop-app surfaces
   * (spend guard's lastViewedAt) stay consistent with what the user saw.
   */
  async markRead(request: { id?: string; atMs?: number } | null): Promise<unknown> {
    if (typeof request?.id !== 'string' || request.id === '') return null
    const atMs = typeof request.atMs === 'number' && Number.isFinite(request.atMs) ? request.atMs : undefined
    this.unread.markRead(request.id, atMs)
    return callGateway(this.cfg.dataDir, 'setAgentUnread', {
      id: request.id, isUnread: false, atMs: atMs ?? Date.now(),
    })
  }

  /**
   * Append one diagnostic record to `<dataDir>/dsh-bots-diag.jsonl`.
   *
   * The shadow takeover of `sidebar.workspaces` is the one part of this plugin
   * whose failure mode is invisible — a missing shipped entry or a throwing
   * prop synthesis just renders a small notice. Recording those transitions is
   * the only way to tell, after the fact, whether delegation actually worked
   * on a user's machine. Best-effort by construction: diagnostics must never
   * be able to fail a render.
   */
  async diag(request: { stage?: string; detail?: unknown } | null): Promise<{ written: boolean }> {
    if (typeof request?.stage !== 'string' || request.stage === '') return { written: false }
    try {
      const line = JSON.stringify({
        at: new Date().toISOString(),
        version: PLUGIN_VERSION,
        stage: request.stage,
        detail: request.detail ?? null,
      })
      appendFileSync(join(expandHome(this.cfg.dataDir), DIAG_FILE), line + '\n')
      return { written: true }
    } catch {
      return { written: false }
    }
  }

  // Live event channel: ring-replay instead of transcript polling.
  eventsSince(request: { seq?: number } | null): EventsSinceResult {
    if (!this.sse.state().running) this.sse.start()
    return { ...this.sse.eventsSince(Number(request?.seq) || 0), unread: this.unread.counts() }
  }

  sseState(request: unknown): SseState {
    return this.sse.state()
  }

  /** Stop the live event loop on plugin teardown. */
  stopSse(): void {
    this.sse.stop()
  }
}

for (const m of [
  'gatewayInfo', 'list', 'workspaces', 'sessions',
  'create', 'createGroup', 'update', 'remove', 'send', 'transcriptTail', 'markRead', 'diag',
  'eventsSince', 'sseState',
]) {
  markRemoteMethod(BotsRemote.prototype, m)
}

/** Plugin entry: guard peers, publish the `bots` Remote namespace. */
export function apply(ctx: Context, config: Config): void {
  assertPeerCompatible()
  const remote = new BotsRemote(ctx, config)
  ctx.effect(() => () => { remote.stopSse() })
}
