/**
 * sdk-bots gateway client for the host half.
 *
 * The formal plugin runs inside the real host process, so this uses native
 * `fetch` and `node:fs` — the curl-over-shell bridge from the dynamic-plugin
 * prototype is gone. Discovery follows `gateway.json` in the sdk-bots data
 * directory; `SAND_GATEWAY_TOKEN` (or the file's optional `token` field) pins
 * auth when present.
 * @module dsh-plugin-bots/gateway
 */

import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import type { AgentInfo, GatewayInfo, TranscriptDisplay, TranscriptEntry } from './shared.js'
import { AVATAR_DATA_URL_MAX } from './shared.js'

export interface Discovery {
  port: number
  pid: number | null
  token: string | null
  host: string
}

const TOKEN_RE = /^[A-Za-z0-9._~+-]+$/

export function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
}

/** Read loopback discovery from `<dataDir>/gateway.json`; null when absent/stale. */
export function readDiscovery(dataDir: string): Discovery | null {
  const file = join(expandHome(dataDir), 'gateway.json')
  let raw: string
  try {
    raw = readFileSync(file, 'utf-8')
  } catch {
    return null
  }
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || !Number.isInteger(parsed.port) || parsed.port <= 0) {
    return null
  }
  const token = typeof parsed.token === 'string' && TOKEN_RE.test(parsed.token)
    ? parsed.token
    : (process.env['SAND_GATEWAY_TOKEN'] !== undefined && TOKEN_RE.test(process.env['SAND_GATEWAY_TOKEN'])
        ? process.env['SAND_GATEWAY_TOKEN']
        : null)
  return {
    port: parsed.port,
    pid: Number.isInteger(parsed.pid) ? parsed.pid : null,
    token,
    host: parsed.host === '0.0.0.0' ? '127.0.0.1' : (parsed.host ?? '127.0.0.1'),
  }
}

/** Discovery + `/health` probe with pid match validation. */
export async function discover(dataDir: string): Promise<GatewayInfo> {
  const d = readDiscovery(dataDir)
  if (d === null) return { ok: false, reason: 'no-gateway-json' }
  const baseUrl = `http://${d.host}:${d.port}`
  let health: any
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return { ok: false, reason: `health-http-${res.status}`, baseUrl, port: d.port, pid: d.pid }
    health = await res.json() as any
  } catch (e) {
    return { ok: false, reason: 'health-failed', baseUrl, port: d.port, pid: d.pid }
  }
  if (d.pid !== null && health !== null && health.pid !== d.pid) {
    return { ok: false, reason: 'stale-gateway-json', baseUrl, port: d.port, pid: d.pid }
  }
  return {
    ok: true,
    baseUrl,
    port: d.port,
    pid: d.pid,
    hasToken: d.token !== null,
    health: {
      pid: health !== null ? health.pid : null,
      isBusy: Boolean(health?.isBusy),
      activeAgentId: health?.activeAgentId ?? null,
      startedAt: health?.startedAt ?? null,
    },
  }
}

/** POST one `/api/<method>` command; unwraps `{result}` and throws on errors. */
export async function callGateway<T>(dataDir: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const d = readDiscovery(dataDir)
  if (d === null) throw new Error('gateway.json not found — sdk-bots host 是否在运行？')
  const baseUrl = `http://${d.host}:${d.port}`
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (d.token !== null) headers['authorization'] = `Bearer ${d.token}`
  const res = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(90_000),
  })
  if (res.status === 401) throw new Error('gateway unauthorized — 需要 token')
  let json: any
  try {
    json = await res.json() as any
  } catch {
    throw new Error(`bad-json-from-gateway (${res.status})`)
  }
  if (json !== null && typeof json === 'object' && json.error !== undefined) {
    throw new Error(typeof json.error?.message === 'string' ? json.error.message : JSON.stringify(json.error))
  }
  return (json !== null && typeof json === 'object' && 'result' in json ? json.result : json) as T
}

/** Project a raw gateway agent onto the wire type. */
export function trimAgent(a: any): AgentInfo | null {
  if (a === null || typeof a !== 'object') return null
  const avatar = typeof a.avatarDataUrl === 'string' ? a.avatarDataUrl : null
  return {
    id: String(a.id),
    name: String(a.name ?? ''),
    description: typeof a.description === 'string' ? a.description : '',
    title: typeof a.title === 'string' ? a.title : '',
    isGroup: Boolean(a.isGroup),
    memberIds: Array.isArray(a.memberIds) ? a.memberIds.map(String) : [],
    isRunning: Boolean(a.isRunning),
    isActive: a.isActive !== false,
    lastMessagePreview: typeof a.lastMessagePreview === 'string' ? a.lastMessagePreview : null,
    updatedAt: a.updatedAt ?? null,
    isComposingMessage: Boolean(a.isComposingMessage),
    hasUnread: Boolean(a.hasUnread),
    unreadCount: Number.isFinite(a.unreadCount) ? Number(a.unreadCount) : 0,
    isHiddenFromSidebar: Boolean(a.isHiddenFromSidebar),
    awaitingUserResponse: typeof a.awaitingUserResponse === 'string' ? a.awaitingUserResponse : null,
    lastActivityAt: Number.isFinite(a.lastActivityAt) ? Number(a.lastActivityAt) : null,
    // Oversized avatars are dropped, not truncated: a half data URL renders as
    // a broken image, whereas null cleanly falls through to the initial chip.
    avatarDataUrl: avatar !== null && avatar.length <= AVATAR_DATA_URL_MAX ? avatar : null,
    avatarShape: typeof a.avatarShape === 'string' ? a.avatarShape : null,
    avatarColor: typeof a.avatarColor === 'string' ? a.avatarColor : null,
    hasAvatar: avatar !== null,
  }
}

/** Pick the best display text out of any sdk-bots transcript entry shape. */
function entryText(en: any): string {
  if (typeof en.content === 'string' && en.content !== '') return en.content
  const msg = en.message
  if (typeof msg === 'string') return msg
  if (msg !== null && typeof msg === 'object' && typeof msg.content === 'string') return msg.content
  if (typeof en.text === 'string') return en.text
  if (typeof en.summary === 'string') return en.summary
  return ''
}

/**
 * Millisecond wall-clock time for one transcript entry, or null.
 *
 * sdk-bots is not consistent about the field name or the unit: newer entries
 * carry `timestampMs`, older ones `timestamp`/`createdAt`/`time`, and either
 * can arrive as an ISO string or as *seconds*. The chat draws a reply clock
 * off this value, so reading only one shape silently renders a whole
 * conversation with no times at all.
 */
function entryTimestamp(en: any): number | null {
  for (const raw of [en?.timestampMs, en?.timestamp, en?.createdAt, en?.time]) {
    const ms = toEpochMs(raw)
    if (ms !== null) return ms
  }
  return null
}

/** Seconds/milliseconds/ISO -> epoch ms. Anything unreadable is null. */
function toEpochMs(raw: unknown): number | null {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return null
    // Below ~1973 in milliseconds is a seconds stamp, never a real date.
    return Math.round(raw < 1e11 ? raw * 1000 : raw)
  }
  if (typeof raw !== 'string' || raw === '') return null
  if (/^\d+$/.test(raw)) return toEpochMs(Number(raw))
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : null
}

/** Collapse a wire `kind` (plus role) onto the closed display union. */
function entryDisplay(kind: string, role: string | null): TranscriptDisplay {
  if (kind.includes('tool')) return 'tool'
  if (kind === 'thinking' || kind === 'reasoning' || kind === 'redacted-reasoning') return 'thinking'
  if (kind === 'send-message' || kind === 'agent-message' || kind === 'assistant-text') return 'assistant'
  if (kind === 'message' || kind === 'user-message') return role === 'user' ? 'user' : 'assistant'
  return 'event'
}

/** Normalize one transcript entry for the UI's closed render switch. */
export function trimEntry(en: any): TranscriptEntry {
  const kind = String(en?.kind ?? '')
  const role = typeof en?.role === 'string' ? en.role : null
  const display = entryDisplay(kind, role)
  const failed = en?.isError === true || en?.status === 'error' || en?.status === 'failed'
  return {
    id: String(en?.id ?? ''),
    kind,
    display,
    timestampMs: entryTimestamp(en),
    role,
    content: entryText(en ?? {}),
    authorId: en?.author?.id ?? null,
    authorName: en?.author?.name ?? null,
    isStreaming: en?.isStreaming === true,
    toolName: display === 'tool'
      ? String(en?.toolName ?? en?.name ?? en?.tool?.name ?? '工具')
      : null,
    toolStatus: display !== 'tool'
      ? null
      : failed ? 'error' : (kind === 'tool-call' || en?.isStreaming === true) ? 'running' : 'ok',
  }
}

/** `listAgents` returns a bare array (also tolerates `{agents:[...]}`). */
export function normalizeAgents(raw: any): AgentInfo[] {
  const list = Array.isArray(raw) ? raw : (raw?.agents ?? [])
  return (list as any[]).map(trimAgent).filter((a): a is AgentInfo => a !== null)
}

let nonceCounter = 0

/** Client nonce for idempotent create/send calls. */
export function nextNonce(): string {
  nonceCounter += 1
  return `dsh-bots-${Date.now().toString(36)}-${nonceCounter}`
}
