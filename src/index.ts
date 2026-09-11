/**
 * dsh-bots — host half.
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
 * @module dsh-bots
 */

import type { Context } from '@deepseek-ai/cordis'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { appendFileSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import type {
  AgentInfo, Config, EventsSinceResult, GatewayInfo, McpServerInfo, McpToolInfo,
  SessionInfo, SseState, TranscriptEntry, WorkspaceInfo,
} from './shared.js'
import { callGateway, discover, effectiveDataDir, expandHome, nextNonce, normalizeAgents, readDiscoveryWithFallback, trimAgent, trimEntry } from './gateway.js'
import { GatewaySseClient, SseRingBuffer } from './sse.js'
import { UnreadStore } from './unread.js'
import { listAgentWorkspaces, readAgentWorkspace, setAgentWorkspace } from './workspace.js'
import { satisfiesCaret } from './version.js'

export const name = 'dsh-bots'

/** No hard Cordis service requirements: host reads optional services via
 * guarded `ctx.get` so a partially-provisioned kernel never blocks activation. */
export const inject: string[] = []

/** Cordis range this plugin is tested against; only surfaces a warning. */
export const TESTED_CORDIS_RANGE = '^4.0.1'

const DEFAULT_DATA_DIR = '~/.dsh-bots'
/** Where the gateway lived before the 0.2.16 default rename — discovery and
 * every data-dir consumer fall back to it until the engine migrates. */
const LEGACY_DATA_DIR = '~/.sdk-bots'

/** Local OpenAI-compatible router the sdk-bots engine defaults to (same
 * default as the engine bootstrap). Reachability here decides whether the
 * model picker can offer the router's catalog or must fall back to the
 * account's configured default model. */
const FREEROUTE_BASE_URL = (process.env.SAND_OPENROUTER_BASE_URL ?? '').trim() || 'http://127.0.0.1:3080/freeroute/v1'

/**
 * The launchd job that owns the sdk-bots engine, and the env keys that decide
 * which model it runs.
 *
 * `resolveOpenRouterEndpoint()` reads `SAND_OPENROUTER_MODEL` at process start
 * and the engine's local chat path never consults the settings store, so this
 * plist — not `agentDefaultModel` — is the knob that actually changes what the
 * bots run. Reading it lets the settings card show the EFFECTIVE model, and
 * writing it (plus a kickstart) is the only way a pick takes effect.
 */
const ENGINE_LAUNCHD_LABEL = 'com.sdk-bots.host'
const ENGINE_PLIST = join(homedir(), 'Library', 'LaunchAgents', `${ENGINE_LAUNCHD_LABEL}.plist`)
const ENGINE_MODEL_ENV_KEYS = ['SAND_OPENROUTER_MODEL', 'SAND_AGENT_MODEL'] as const

/** Append-only diagnostics file, read when a shadow takeover misbehaves. */
const DIAG_FILE = 'dsh-bots-diag.jsonl'

/** Persisted read markers ("读到哪了") backing the sidebar unread badge. */
const UNREAD_FILE = 'dsh-bots-unread.json'
const BOTS_SETTINGS_FILE = 'dsh-bots-settings.json'

/** Stamped into every diagnostic line so records survive version skew. */
const PLUGIN_VERSION = resolvedModuleVersion('dsh-bots')

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
    console.warn(`[dsh-bots] resolved @deepseek-ai/cordis ${cordis}, tested with ${TESTED_CORDIS_RANGE}`)
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
  throw new Error('[dsh-bots] 无法解析 @deepseek-ai/dsh-typert-protocol（宿主锚定与回退均失败）')
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
    this.unread = new UnreadStore(join(effectiveDataDir(this.cfg.dataDir), UNREAD_FILE))
    const ring = new SseRingBuffer(3000, (channel, data) => { this.observeTranscript(channel, data) })
    this.sse = new GatewaySseClient({
      ring,
      resolveBase: () => {
        const d = readDiscoveryWithFallback(this.cfg.dataDir)
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
    // workspaceRoot mirrors the engine's exec-daemon default (`<dataDir>/
    // box-workspace`); once the engine exposes the authoritative value on
    // /health we prefer it — the plugin-side fallback stays for older engines.
    const discovered = await discover(dataDir)
    const healthRoot = (discovered.health as any)?.workspaceRoot
    const root = typeof healthRoot === 'string' && healthRoot.trim() !== ''
      ? healthRoot
      : join(expandHome(dataDir), 'box-workspace')
    return { ...discovered, dataDir, workspaceRoot: root }
  }

  /**
   * Descriptor contract: every remote method declares exactly one plain
   * `request` formal parameter (no defaults/destructuring/rest) — the
   * source-mode descriptor derives its wire field from the parameter name,
   * and the client always sends `{ args: { request } }`. A zero-param method
   * would make the gateway reject the envelope with "unexpected request".
   */
  async list(request: unknown): Promise<AgentInfo[]> {
    const agents = normalizeAgents(await callGateway<any>(this.cfg.dataDir, 'listAgents', {}))
    // The gateway row omits group.json's maxMembers, so read it here — the
    // settings editor needs the CURRENT cap, not a hardcoded default.
    for (const a of agents) {
      if (a.isGroup !== true) continue
      try {
        const cfg = JSON.parse(readFileSync(join(effectiveDataDir(this.cfg.dataDir), 'agents', a.id, 'group.json'), 'utf-8')) as { maxMembers?: unknown }
        const n = typeof cfg.maxMembers === 'number' ? Math.floor(cfg.maxMembers) : Number.NaN
        a.maxMembers = Number.isFinite(n) ? Math.min(16, Math.max(1, n)) : 8
      } catch { a.maxMembers = 8 }
    }
    return agents
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
    const cap = this.readPrefs().groupMaxMembers ?? 8
    const memberIds = Array.isArray(request?.memberIds) ? request.memberIds : []
    // The engine normalizes member lists down to maxMembers SILENTLY; an
    // over-cap pick must fail loudly here instead of dropping members.
    if (memberIds.length > cap) throw new Error(`群成员上限为 ${cap}，当前选择了 ${memberIds.length} 位成员`)
    const created = await callGateway<any>(this.cfg.dataDir, 'createGroup', {
      name: String(request?.name ?? '').trim(),
      memberAgentIds: memberIds,
      maxMembers: cap,
    })
    return trimAgent(created?.agent ?? created)
  }

  /**
   * Replace a group's member list (add + remove in one call — the gateway
   * command is a full-set put, not a delta). Wire field is `memberAgentIds`,
   * same as `createGroup` (§7.2). The global cap is policy here: every roster
   * edit is written with it, so per-group values converge on the setting as
   * groups are touched (existing rosters are never rewritten unprompted — the
   * engine truncates member lists to maxMembers on write, and a silent
   * rewrite would silently kick members out).
   */
  async setGroupMembers(request: { id?: string; memberIds?: string[]; maxMembers?: number } | null): Promise<AgentInfo | null> {
    const updated = await callGateway<any>(this.cfg.dataDir, 'setGroupMembers', {
      id: request?.id,
      memberAgentIds: Array.isArray(request?.memberIds) ? request.memberIds : [],
      maxMembers: this.readPrefs().groupMaxMembers ?? 8,
    })
    return trimAgent(updated?.agent ?? updated)
  }

  /**
   * Global group roster policy ("成员上限" in Bots settings): read with no
   * payload, set with `{ max }`. Stored in the plugin's OWN settings file —
   * the engine's host-settings store drops unknown fields, and this knob is
   * plugin-owned like the unread markers. 1..16 per the engine's hard max
   * (GROUP_HARD_MAX_MEMBERS); 8 is the engine default.
   */
  async groupCap(request: { max?: number } | null): Promise<{ max: number }> {
    if (request?.max === undefined) return { max: this.readPrefs().groupMaxMembers ?? 8 }
    const n = Math.floor(Number(request.max))
    if (!Number.isFinite(n) || n < 1 || n > 16) throw new Error('成员上限必须是 1–16 的整数')
    this.writePrefs({ groupMaxMembers: n })
    return { max: n }
  }

  /**
   * Pinned conversations (置顶会话). Plugin-owned, stored in the same prefs
   * file as `groupMaxMembers` — a per-device preference like the unread
   * markers, not engine state. `null` reads the current pin list (array of
   * agent ids, order = pin order, oldest first); `{ id, pinned }` toggles.
   */
  async pin(request: { id: string; pinned: boolean } | null): Promise<{ ids: string[] }> {
    if (request === null || typeof request.id !== 'string' || request.id === '') {
      return { ids: this.readPrefs().pinnedConversationIds ?? [] }
    }
    const ids = new Set(this.readPrefs().pinnedConversationIds ?? [])
    if (request.pinned === true) ids.add(request.id)
    else ids.delete(request.id)
    const next = [...ids]
    this.writePrefs({ pinnedConversationIds: next })
    return { ids: next }
  }

  /**
   * Sidebar visibility toggle. The flag lives in the agent's sand settings
   * (not the profile — updateAgent ignores it), so this proxies the
   * gateway's dedicated setAgentHiddenFromSidebar RPC.
   */
  async setHidden(request: { id: string; hidden: boolean }): Promise<unknown> {
    return callGateway(this.cfg.dataDir, 'setAgentHiddenFromSidebar', { id: request?.id, isHidden: request?.hidden === true })
  }

  /** Plugin-owned preferences (`<dataDir>/dsh-bots-settings.json`). */
  private readPrefs(): { groupMaxMembers?: number; pinnedConversationIds?: string[] } {
    try {
      const parsed = JSON.parse(readFileSync(join(effectiveDataDir(this.cfg.dataDir), BOTS_SETTINGS_FILE), 'utf-8'))
      return typeof parsed === 'object' && parsed !== null ? parsed as { groupMaxMembers?: number; pinnedConversationIds?: string[] } : {}
    } catch { return {} }
  }

  private writePrefs(patch: { groupMaxMembers?: number; pinnedConversationIds?: string[] }): void {
    const path = join(effectiveDataDir(this.cfg.dataDir), BOTS_SETTINGS_FILE)
    const next = { version: 1, ...this.readPrefs(), ...patch }
    writeFileSync(path, JSON.stringify(next, null, 2) + '\n', 'utf-8')
  }

  /**
   * Resolve a bot-written path against the media allowlist: only files inside
   * the gateway data dir (agent dirs, box-workspace, swarm blackboard…) may
   * be served or opened — the workbench must never become a disk-wide file
   * reader. Symlinks resolve before the check so escapes fail closed.
   */
  private resolveMediaPath(raw: unknown): { resolved: string; ext: string } {
    const p = String(raw ?? '').trim()
    if (p === '') throw new Error('path is required')
    const root = realpathSync(effectiveDataDir(this.cfg.dataDir))
    let resolved = resolve(expandHome(p))
    try { resolved = realpathSync(resolved) } catch { /* missing → prefix-check the literal path */ }
    if (resolved !== root && !resolved.startsWith(root + sep)) {
      throw new Error('path is outside the gateway data dir: ' + resolved)
    }
    return { resolved, ext: extname(resolved).toLowerCase() }
  }

  /** Inline-preview support: read a bot-written image as base64 for a data URL. */
  async readImage(request: { path?: string } | null): Promise<{ mime: string; dataBase64: string; sizeBytes: number }> {
    const { resolved, ext } = this.resolveMediaPath(request?.path)
    const mime: string | undefined = ({
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
      '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
    } as Record<string, string>)[ext]
    if (mime === undefined) throw new Error('not a supported image: ' + ext)
    const stat = statSync(resolved)
    if (!stat.isFile()) throw new Error('not a file: ' + resolved)
    if (stat.size > 8 * 1024 * 1024) throw new Error('image exceeds the 8MB preview cap (' + stat.size + ' bytes)')
    return { mime, dataBase64: readFileSync(resolved).toString('base64'), sizeBytes: stat.size }
  }

  /** Open a bot-written file with the desktop default app (macOS `open`). */
  async openFile(request: { path?: string } | null): Promise<{ opened: boolean }> {
    const { resolved } = this.resolveMediaPath(request?.path)
    statSync(resolved) // missing → honest error instead of a silent no-op
    const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
    spawn(cmd, [resolved], { detached: true, stdio: 'ignore' }).unref()
    return { opened: true }
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

  /** Wire image types we accept, mapped to the file extension the gateway's
   * `imageMimeFromPath` channel split expects. Video/others stay out of scope. */
  static readonly IMAGE_EXTS: Record<string, string> = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg',
    'image/gif': '.gif', 'image/webp': '.webp', 'image/bmp': '.bmp',
  }
  /** Mirrors the gateway's own limits: 4 inline images per message, 8MB each. */
  static readonly MAX_IMAGES_PER_SEND = 4
  static readonly MAX_IMAGE_BYTES = 8 * 1024 * 1024

  async send(request: { agentId?: string; prompt?: string; images?: Array<{ mediaType?: string; dataBase64?: string; name?: string }> } | null): Promise<unknown> {
    // Multimodal: image attachments are materialized as files under the
    // gateway data dir and handed to sendPrompt via `attachmentPaths` — the
    // same channel the native client uses — so the engine's
    // splitAttachmentPathsByChannel → selectedImages → model pipeline picks
    // them up for direct chats AND group turns with zero gateway changes.
    // Writing them under the gateway data dir (not the plugin dir) is what
    // keeps `readImage` previews inside the existing media-path boundary.
    const attachmentPaths: string[] = []
    const attachmentNames: string[] = []
    const images = Array.isArray(request?.images) ? request.images : []
    if (images.length > BotsRemote.MAX_IMAGES_PER_SEND) {
      throw new Error(`at most ${BotsRemote.MAX_IMAGES_PER_SEND} images per message`)
    }
    for (const img of images) {
      const b64 = String(img?.dataBase64 ?? '').replace(/\s+/g, '')
      if (b64 === '') continue
      const ext = BotsRemote.IMAGE_EXTS[String(img?.mediaType ?? '').toLowerCase()]
      if (ext === undefined) throw new Error('unsupported image type: ' + String(img?.mediaType ?? '(none)'))
      const bytes = Buffer.from(b64, 'base64')
      if (bytes.byteLength === 0) continue
      if (bytes.byteLength > BotsRemote.MAX_IMAGE_BYTES) {
        throw new Error(`image exceeds the ${BotsRemote.MAX_IMAGE_BYTES / 1024 / 1024}MB cap (${bytes.byteLength} bytes)`)
      }
      const dir = join(effectiveDataDir(this.cfg.dataDir), 'dsh-bots-uploads')
      mkdirSync(dir, { recursive: true })
      const n = attachmentPaths.length + 1
      const safe = String(img?.name ?? '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)
      const path = join(dir, `dshb-${Date.now()}-${n}${ext}`)
      writeFileSync(path, bytes)
      attachmentPaths.push(path)
      attachmentNames.push(safe !== '' ? safe : `image-${n}${ext}`)
    }
    return callGateway(this.cfg.dataDir, 'sendPrompt', {
      agentId: request?.agentId,
      prompt: String(request?.prompt ?? ''),
      ...(attachmentPaths.length > 0 ? { attachmentPaths, attachmentNames } : {}),
      clientNonce: nextNonce(),
    })
  }

  /**
   * Interrupt an agent's active run (the composer's stop button). Returns the
   * gateway's honest `{hadActiveRun}` so the UI can tell "stopped it" from
   * "there was nothing to stop" — never a fake success.
   */
  async interrupt(request: { id?: string } | null): Promise<{ hadActiveRun: boolean }> {
    const id = String(request?.id ?? '').trim()
    if (id === '') throw new Error('interrupt requires an agent id')
    const res = await callGateway<any>(this.cfg.dataDir, 'interruptAgent', {
      id, reason: '用户在 dsh Bots 工作台停止了生成',
    })
    const body = res?.result ?? res ?? {}
    return { hadActiveRun: body.hadActiveRun === true }
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

  // ==========================================================
  // MCP bridge (DEVELOPMENT.md §13): the engine already ships a
  // full MCP stack — management, routed tools, OAuth — so the
  // plugin only forwards. Every method is a thin `callGateway`
  // passthrough honoring the single-`request` descriptor rule.
  // ==========================================================

  /** Trim a gateway MCP server row to the settings-page projection. */
  private trimMcpServer(row: any): McpServerInfo {
    return {
      id: String(row?.id ?? ''),
      serverIdentifier: String(row?.serverIdentifier ?? row?.id ?? ''),
      name: String(row?.name ?? ''),
      status: String(row?.status ?? 'unknown'),
      accountKey: String(row?.accountKey ?? ''),
      transport: String(row?.transport ?? ''),
      toolCount: Number(row?.toolCount ?? 0) || 0,
      ...(row?.disabledToolCount == null ? {} : { disabledToolCount: Number(row.disabledToolCount) || 0 }),
      ...(row?.statusDetail == null ? {} : { statusDetail: String(row.statusDetail) }),
      ...(row?.customInstructions == null ? {} : { customInstructions: String(row.customInstructions) }),
    }
  }

  /** Trim a routed MCP tool row (schema passed through verbatim). */
  private trimMcpTool(row: any): McpToolInfo {
    return {
      name: String(row?.name ?? ''),
      providerIdentifier: String(row?.providerIdentifier ?? ''),
      toolName: String(row?.toolName ?? ''),
      ...(row?.description == null ? {} : { description: String(row.description) }),
      ...(row?.inputSchema == null ? {} : { inputSchema: row.inputSchema }),
    }
  }

  /** Installed MCP servers (engine `management.listInstalled`). */
  async mcpServers(request: unknown): Promise<{ servers: McpServerInfo[] }> {
    const res = await callGateway<any>(this.cfg.dataDir, 'listMcpServers', {})
    const rows: any[] = Array.isArray(res) ? res : Array.isArray(res?.servers) ? res.servers : []
    return { servers: rows.map((r) => this.trimMcpServer(r)) }
  }

  /** All routed MCP tools across servers (engine `mcp.listTools`). */
  async mcpTools(request: unknown): Promise<{ tools: McpToolInfo[] }> {
    const res = await callGateway<any>(this.cfg.dataDir, 'listRoutedMcpTools', {})
    const rows: any[] = Array.isArray(res) ? res : Array.isArray(res?.tools) ? res.tools : []
    return { tools: rows.map((r) => this.trimMcpTool(r)) }
  }

  /**
   * Register one MCP server. `configJson` must decode to a JSON object —
   * either a stdio config (`{"command": "…", "args": […]}`) or a remote URL
   * config; the gateway JSON.parses and re-validates it.
   */
  async mcpAdd(request: { name?: string; configJson?: string } | null): Promise<{ servers: McpServerInfo[] }> {
    const name = String(request?.name ?? '').trim()
    const configJson = String(request?.configJson ?? '').trim()
    if (name === '') throw new Error('mcpAdd 需要 name')
    if (configJson === '') throw new Error('mcpAdd 需要 configJson（stdio 或 URL 配置的 JSON 对象串）')
    try { JSON.parse(configJson) } catch (e) {
      throw new Error(`configJson 不是合法 JSON：${String((e as any)?.message ?? e)}`)
    }
    const res = await callGateway<any>(this.cfg.dataDir, 'addMcpServer', { name, configJson })
    const rows: any[] = Array.isArray(res?.servers) ? res.servers : []
    return { servers: rows.map((r) => this.trimMcpServer(r)) }
  }

  async mcpRemove(request: { serverId?: string } | null): Promise<unknown> {
    const serverId = String(request?.serverId ?? '').trim()
    if (serverId === '') throw new Error('mcpRemove 需要 serverId')
    return callGateway(this.cfg.dataDir, 'removeMcpServer', { serverId })
  }

  /** Restart / reconnect all MCP servers (engine `management.restart`). */
  async mcpRefresh(request: unknown): Promise<unknown> {
    return callGateway(this.cfg.dataDir, 'refreshMcp', {})
  }

  /**
   * Execute one routed MCP tool outside a bot turn (tool try-run panel).
   * Passthrough of the gateway wire shape — note the engine swaps `name`/
   * `toolName` on the way into the executor (DEVELOPMENT.md §13.5), so the
   * caller maps `{name: row.toolName, toolName: row.name}` until实测 confirmed.
   */
  async mcpExecute(request: {
    agentId?: string; name?: string; toolName?: string
    providerIdentifier?: string; args?: unknown; toolCallId?: string
  } | null): Promise<unknown> {
    return callGateway(this.cfg.dataDir, 'executeRoutedMcpTool', {
      agentId: request?.agentId,
      name: request?.name,
      toolName: request?.toolName,
      providerIdentifier: request?.providerIdentifier,
      args: request?.args ?? {},
      toolCallId: request?.toolCallId ?? `dsh-try-${Date.now()}`,
    })
  }

  // ==========================================================
  // Per-agent workspace jail bridge. The ENGINE owns the isolation
  // (macOS Seatbelt write confinement, engine `agent-workspace-jail.ts`);
  // these methods only read/write the per-agent settings.json contract.
  // ==========================================================

  async workspaceList(request: unknown) {
    return { workspaces: listAgentWorkspaces(effectiveDataDir(this.cfg.dataDir)) }
  }

  async workspaceGet(request: { agentId?: string } | null) {
    const config = readAgentWorkspace(effectiveDataDir(this.cfg.dataDir), String(request?.agentId ?? ''))
    if (config === null) throw new Error(`workspaceGet: agent 不存在或 id 不合法`)
    return config
  }

  async workspaceSet(request: {
    agentId?: string; workspaceRoot?: string | null; allowPaths?: string[]
  } | null) {
    return setAgentWorkspace(effectiveDataDir(this.cfg.dataDir), String(request?.agentId ?? ''), {
      workspaceRoot: request?.workspaceRoot,
      allowPaths: request?.allowPaths,
    })
  }

  /** Model configuration surface: the engine's account-level default model
   * (setHostSettings.agentDefaultModel) plus freeroute availability. The
   * engine keeps no per-bot model — this is the one runtime-effective knob. */
  async modelConfig(request: unknown): Promise<{
    provider: string | null
    agentDefaultModel: string | null
    freerouteReachable: boolean
    models: string[]
    groups: Array<{ provider: string; models: string[] }>
    deepseek: string[]
    engine: { modelId: string | null; plist: string; present: boolean }
    native: { providers: Array<{ id: string; name: string; registered: boolean; models: Array<{ id: string; name: string }> }>; default: { provider: string; model: string } | null } | null
  }> {
    const settings = await callGateway<any>(this.cfg.dataDir, 'getHostSettings', {})
    const selection = settings?.agentDefaultModel ?? null
    const probe = await this.probeFreerouteModels()
    return {
      provider: typeof settings?.inferenceProvider === 'string' ? settings.inferenceProvider : null,
      agentDefaultModel: typeof selection?.modelId === 'string' ? selection.modelId : null,
      freerouteReachable: probe.ok,
      models: probe.models,
      groups: probe.groups,
      // Grouped by upstream owner, freeroute's DeepSeek ids sit under a bucket
      // named after the aggregator (orcarouter), which is why the picker read
      // as "no DeepSeek". These are the ids that actually mean DeepSeek.
      deepseek: probe.models.filter((id) => /deepseek/i.test(id)),
      engine: this.engineModelInfo(),
      native: await this.nativeModelCatalog(),
    }
  }

  /** The model the engine will actually run, straight off the launchd job. */
  private engineModelInfo(): { modelId: string | null; plist: string; present: boolean } {
    try {
      const xml = readFileSync(ENGINE_PLIST, 'utf8')
      const hit = /<key>SAND_OPENROUTER_MODEL<\/key>\s*<string>([^<]*)<\/string>/.exec(xml)
      const modelId = hit !== null && hit[1].trim() !== '' ? hit[1].trim() : null
      return { modelId, plist: ENGINE_PLIST, present: true }
    } catch {
      return { modelId: null, plist: ENGINE_PLIST, present: false }
    }
  }

  /** Point the engine at one model and restart its job.
   *
   * The environment is read at process start, and launchd caches the loaded job
   * definition — a `kickstart` restarts the OLD definition, so the edited plist
   * would never reach the process (verified the hard way: the engine kept
   * running the previous model). Reloading the definition is therefore
   * mandatory: `bootout` then `bootstrap`, with a `kickstart` to make sure the
   * freshly loaded job actually spawns. */
  async applyModel(request: { modelId?: string } | null): Promise<{ modelId: string; restarted: boolean; reloaded: boolean }> {
    const modelId = String(request?.modelId ?? '').trim()
    if (modelId === '') throw new Error('applyModel requires a model id')
    let xml = readFileSync(ENGINE_PLIST, 'utf8')
    for (const key of ENGINE_MODEL_ENV_KEYS) {
      const re = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`)
      if (re.test(xml)) xml = xml.replace(re, `$1${modelId}$2`)
    }
    writeFileSync(ENGINE_PLIST, xml)
    const uid = typeof process.getuid === 'function' ? process.getuid() : 501
    const target = `gui/${uid}/${ENGINE_LAUNCHD_LABEL}`
    const run = (args: string[]): boolean => spawnSync('launchctl', args, { encoding: 'utf8' }).status === 0
    // bootout is expected to be a no-op when the job is not loaded.
    run(['bootout', target])
    const reloaded = run(['bootstrap', `gui/${uid}`, ENGINE_PLIST])
    // A bootstrap can load the job without spawning it (the outgoing process
    // still holds the label); kickstart guarantees the new definition runs.
    const started = run(['kickstart', target])
    return { modelId, restarted: started, reloaded }
  }

  /** Models one provider route advertises; an unreachable/declared-only route
   * simply contributes none rather than failing the whole catalog. */
  private async modelsOfProvider(llm: any, provider: string): Promise<Array<{ id: string; name: string }>> {
    try {
      if (typeof llm.listModels !== 'function') return []
      const list: any[] = await llm.listModels(provider)
      return (Array.isArray(list) ? list : [])
        .map((m) => ({ id: String(m?.id ?? ''), name: String(m?.name ?? m?.id ?? '') }))
        .filter((m) => m.id !== '')
    } catch {
      return []
    }
  }

  /** The catalog the DSH model page itself renders: provider routes with a
   * registered adapter plus every declared configurable provider, each with the
   * models it advertises — read through the optional `llm` service so a
   * deployment without it degrades to freeroute's list alone. */
  private async nativeModelCatalog(): Promise<{ providers: Array<{ id: string; name: string; registered: boolean; models: Array<{ id: string; name: string }> }>; default: { provider: string; model: string } | null } | null> {
    try {
      const llm: any = this.ctx.get('llm')
      if (llm === null || llm === undefined) return null
      const registered: any[] = typeof llm.listProviders === 'function' ? await llm.listProviders() : []
      const declared: any[] = typeof llm.listConfigurableProviders === 'function' ? await llm.listConfigurableProviders() : []
      const seen = new Set<string>()
      const providers: Array<{ id: string; name: string; registered: boolean; models: Array<{ id: string; name: string }> }> = []
      const take = async (id: unknown, name: unknown, registeredFlag: boolean): Promise<void> => {
        const key = String(id ?? '').trim()
        if (key === '' || seen.has(key)) return
        seen.add(key)
        providers.push({ id: key, name: String(name ?? '').trim() || key, registered: registeredFlag, models: await this.modelsOfProvider(llm, key) })
      }
      for (const p of Array.isArray(registered) ? registered : []) await take(p?.id, p?.name, true)
      for (const p of Array.isArray(declared) ? declared : []) await take(p?.provider, p?.displayName, false)
      return { providers, default: this.nativeDefaultModel() }
    } catch {
      return null
    }
  }

  /** The deployment's own default selection — what the native model page
   * highlights as current. */
  private nativeDefaultModel(): { provider: string; model: string } | null {
    try {
      const svc: any = this.ctx.get('agentDefaultModel')
      const selection = typeof svc?.currentSelection === 'function' ? svc.currentSelection() : null
      const provider = String(selection?.provider ?? '').trim()
      const model = String(selection?.model ?? '').trim()
      return provider !== '' && model !== '' ? { provider, model } : null
    } catch {
      return null
    }
  }

  private async probeFreerouteModels(): Promise<{ ok: boolean; models: string[]; groups: Array<{ provider: string; models: string[] }> }> {
    try {
      const res = await fetch(`${FREEROUTE_BASE_URL}/models`, { signal: AbortSignal.timeout(2500) })
      if (res.ok === false) return { ok: false, models: [], groups: [] }
      // freeroute aggregates upstream providers; each entry's `owned_by` is
      // the provider dimension the picker groups by (`_` marks pseudo-route
      // entries like `auto` — surfaced as the synthetic 路由 group).
      const body = await res.json() as { data?: Array<{ id?: unknown; owned_by?: unknown }> }
      const rows = Array.isArray(body?.data) ? body.data : []
      const models = rows.map((m) => (typeof m?.id === 'string' ? m.id : '')).filter((id: string) => id !== '')
      const byOwner = new Map<string, string[]>()
      for (const row of rows) {
        const id = typeof row?.id === 'string' ? row.id : ''
        if (id === '') continue
        const owner = typeof row?.owned_by === 'string' && row.owned_by.trim() !== '' ? row.owned_by.trim() : '_'
        const key = owner === '_' ? 'router' : owner
        const list = byOwner.get(key) ?? []
        list.push(id)
        byOwner.set(key, list)
      }
      const groups = [...byOwner.entries()]
        .map(([provider, list]) => ({ provider, models: list.sort((a, b) => a.localeCompare(b)) }))
        .sort((a, b) => b.models.length - a.models.length)
      return { ok: true, models, groups }
    } catch {
      return { ok: false, models: [], groups: [] }
    }
  }

  /** Unset (null) = freeroute auto routing; a modelId pins the account's
   * default model (the engine's own settings store validates the shape). */
  async setModelConfig(request: { modelId?: string | null } | null): Promise<{ agentDefaultModel: string | null }> {
    const modelId = typeof request?.modelId === 'string' && request.modelId.trim() !== '' ? request.modelId.trim() : null
    const updated = await callGateway<any>(this.cfg.dataDir, 'setHostSettings', {
      agentDefaultModel: modelId === null
        ? null
        : { modelId, maxMode: true, parameters: [] },
    })
    const selection = updated?.agentDefaultModel ?? null
    return { agentDefaultModel: typeof selection?.modelId === 'string' ? selection.modelId : null }
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
      appendFileSync(join(effectiveDataDir(this.cfg.dataDir), DIAG_FILE), line + '\n')
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
  'create', 'createGroup', 'setGroupMembers', 'groupCap', 'pin', 'setHidden', 'update', 'remove', 'send', 'interrupt', 'readImage', 'openFile', 'transcriptTail', 'markRead', 'diag',
  'mcpServers', 'mcpTools', 'mcpAdd', 'mcpRemove', 'mcpRefresh', 'mcpExecute',
  'workspaceList', 'workspaceGet', 'workspaceSet', 'modelConfig', 'setModelConfig', 'applyModel',
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
