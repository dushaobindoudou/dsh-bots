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
import { readFileSync, statSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import type { AgentInfo, GatewayInfo, TranscriptDisplay, TranscriptEntry } from './shared.js'
import { AVATAR_DATA_URL_MAX } from './shared.js'
import { ENGINE_PLIST } from './launchd.js'

export interface Discovery {
  port: number
  pid: number | null
  token: string | null
  host: string
}

const TOKEN_RE = /^[A-Za-z0-9._~+-]+$/

/** New default root (0.2.16). The gateway may still live at the legacy root
 * until the engine's SAND_DATA_ROOT migrates — every discovery consumer tries
 * the configured dir first, then the legacy one. */
export const LEGACY_DATA_DIR = '~/.sdk-bots'

/**
 * A directory the engine actually runs in: it keeps its box workspace (and
 * agents/) in its data root. Holding a gateway.json alone proves nothing —
 * 2026-10-10: with the real discovery file wiped, a self-healed copy landed in
 * the empty configured dir, which then won every lookup; file previews
 * resolved under a box-workspace that does not exist (ENOENT), and unread,
 * skill sharing and per-bot settings went where the engine never reads them.
 */
function isEngineRoot(dir: string): boolean {
  try { return statSync(join(expandHome(dir), 'box-workspace')).isDirectory() } catch { return false }
}

/** Candidate data dirs, best first: one holding the engine's data before one
 * that merely holds discovery; the configured dir wins ties. */
function dataDirCandidates(dataDir: string, legacyDir: string): string[] {
  const dirs = expandHome(dataDir) === expandHome(legacyDir) ? [dataDir] : [dataDir, legacyDir]
  return [...dirs.filter(isEngineRoot), ...dirs.filter((dir) => !isEngineRoot(dir))]
}

/**
 * Discovery that follows the gateway to wherever it actually lives: the
 * engine's data root first, then the configured dir, then the legacy root.
 * Returns null when none has one (the gateway is simply down).
 */
export function readDiscoveryWithFallback(dataDir: string, legacyDir: string = LEGACY_DATA_DIR): Discovery | null {
  for (const dir of dataDirCandidates(dataDir, legacyDir)) {
    const found = readDiscovery(dir)
    if (found !== null) return found
  }
  return null
}

/**
 * The directory where the engine's data (agents/, box-workspace/, swarm/)
 * actually lives right now: an engine root with discovery; else an engine
 * root whose discovery was lost (the data did not move with the file); else
 * whichever dir has discovery; else the configured dir. All state-adjacent
 * consumers (unread ledger, workspace ops, media allowlist, diag, the
 * discovery self-heal) resolve through this so they stay with the real data.
 */
export function effectiveDataDir(dataDir: string, legacyDir: string = LEGACY_DATA_DIR): string {
  const dirs = dataDirCandidates(dataDir, legacyDir)
  const root = dirs.find((dir) => isEngineRoot(dir) && readDiscovery(dir) !== null)
    ?? dirs.find(isEngineRoot)
    ?? dirs.find((dir) => readDiscovery(dir) !== null)
    ?? dataDir
  return expandHome(root)
}

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

/** GET /health within the discovery budget; null when unreachable, with the
 * HTTP status preserved so failure reasons keep their old granularity. */
async function probeHealth(host: string, port: number): Promise<{ status: number; body: any } | null> {
  try {
    const res = await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(5000) })
    let body: any = null
    try { body = await res.json() as any } catch { /* non-JSON body still carries the status */ }
    return { status: res.status, body }
  } catch {
    return null
  }
}

/**
 * The port the engine gateway is pinned to via its LaunchAgent plist env
 * (`SAND_HOST_PORT`). The engine writes gateway.json only after it binds, so
 * this pin is exactly where a live engine listens — the probe target when
 * the discovery file has been lost (2026-10-10: a previous engine instance's
 * late `clearGatewayDiscovery` wiped it after the next boot had already
 * bound) while the engine itself is still alive.
 */
export function readPinnedGatewayPort(plistPath: string = ENGINE_PLIST): number | null {
  let xml: string
  try {
    xml = readFileSync(plistPath, 'utf8')
  } catch {
    return null
  }
  const m = /<key>SAND_HOST_PORT<\/key>\s*<string>(\d+)<\/string>/.exec(xml)
  const port = m === null ? Number.NaN : Number(m[1])
  return Number.isInteger(port) && port > 0 ? port : null
}

interface HintedDiscovery {
  d: Discovery
  health: any
}

/** The pinned-port probe result, memoized briefly so a burst of RPCs in the
 * broken window does not become a burst of /health probes. Invalidated by
 * the self-heal write (the file fast-path takes over) or by expiry. */
let hintCache: { dataDir: string; hinted: HintedDiscovery; until: number } | null = null
const HINT_TTL_MS = 10_000

/** Test seam: drop the memoized pinned-port probe result. */
export function clearGatewayHintCache(): void {
  hintCache = null
}

async function hintDiscovery(dataDir: string, plistPath: string, onDisk: Discovery | null): Promise<HintedDiscovery | null> {
  if (hintCache !== null && hintCache.dataDir === expandHome(dataDir) && Date.now() < hintCache.until) {
    return hintCache.hinted
  }
  const port = readPinnedGatewayPort(plistPath)
  if (port === null) return null
  const probe = await probeHealth('127.0.0.1', port)
  if (probe === null || probe.status !== 200 || !Number.isInteger(probe.body?.pid)) return null
  // The on-disk record was actually right (engine reachable at its port and
  // pid) — the caller's original error stands; do not paper over it.
  if (onDisk !== null && onDisk.port === port && (onDisk.pid === null || onDisk.pid === probe.body.pid)) return null
  const envToken = process.env['SAND_GATEWAY_TOKEN']
  const d: Discovery = {
    port,
    pid: probe.body.pid,
    token: envToken !== undefined && TOKEN_RE.test(envToken) ? envToken : null,
    host: '127.0.0.1',
  }
  const hinted = { d, health: probe.body }
  hintCache = { dataDir: expandHome(dataDir), hinted, until: Date.now() + HINT_TTL_MS }
  return hinted
}

/** Materialize a working gateway.json for a live engine whose record was
 * lost, so every later read (and every other discovery consumer) takes the
 * cheap file path. Writes only when the on-disk state disagrees with the
 * probed engine — the engine overwrites the file on its next boot, and any
 * later pid change re-heals through the same probe. Best-effort: a failure
 * leaves the in-process synthesized discovery serving. */
async function healDiscoveryFile(dataDir: string, d: Discovery, startedAt: number | null): Promise<void> {
  try {
    const current = readDiscoveryWithFallback(dataDir)
    if (current !== null && current.port === d.port && (d.pid === null || current.pid === d.pid)) return
    // Into the engine's own data root — never an empty configured dir,
    // which would then pose as the data dir for every other consumer.
    const file = join(effectiveDataDir(dataDir), 'gateway.json')
    const payload = JSON.stringify({
      port: d.port,
      pid: d.pid,
      ...(startedAt === null ? {} : { startedAt }),
      scheme: 'http',
      host: d.host,
    }, null, 2)
    const tmp = `${file}.${process.pid}.heal-tmp`
    await writeFile(tmp, payload, 'utf8')
    await rename(tmp, file)
  } catch { /* best effort */ }
}

/**
 * Discovery with a lifeline: gateway.json first (validated against a live
 * /health), then a probe of the plist-pinned port for a live engine whose
 * discovery file was lost. Returns null only when neither path finds an
 * engine — otherwise the synthesized record heals the file on its way out.
 */
export async function resolveGateway(dataDir: string, plistPath: string = ENGINE_PLIST): Promise<Discovery | null> {
  const onDisk = readDiscoveryWithFallback(dataDir)
  if (onDisk !== null) {
    const probe = await probeHealth(onDisk.host, onDisk.port)
    if (probe !== null && probe.status === 200 && (onDisk.pid === null || probe.body?.pid === onDisk.pid)) {
      return onDisk
    }
  }
  const hinted = await hintDiscovery(dataDir, plistPath, onDisk)
  if (hinted === null) return onDisk
  await healDiscoveryFile(dataDir, hinted.d, typeof hinted.health?.startedAt === 'number' ? hinted.health.startedAt : null)
  return hinted.d
}

function buildGatewayInfo(d: Discovery, health: any): GatewayInfo {
  return {
    ok: true,
    baseUrl: `http://${d.host}:${d.port}`,
    port: d.port,
    pid: d.pid,
    hasToken: d.token !== null,
    health: {
      pid: health !== null && health !== undefined ? health.pid : null,
      isBusy: Boolean(health?.isBusy),
      activeAgentId: health?.activeAgentId ?? null,
      startedAt: health?.startedAt ?? null,
    },
  }
}

/** Discovery + `/health` probe with pid match validation — and, since the
 * 2026-10-10 discovery-wipe outage, a pinned-port fallback: a lost
 * gateway.json no longer reads as "engine down" while `/health` still
 * answers on the port the plist pins. */
export async function discover(dataDir: string, plistPath: string = ENGINE_PLIST): Promise<GatewayInfo> {
  const d = readDiscoveryWithFallback(dataDir)
  if (d !== null) {
    const baseUrl = `http://${d.host}:${d.port}`
    const probe = await probeHealth(d.host, d.port)
    if (probe !== null && probe.status === 200 && (d.pid === null || probe.body?.pid === d.pid)) {
      return buildGatewayInfo(d, probe.body)
    }
    const hinted = await hintDiscovery(dataDir, plistPath, d)
    if (hinted !== null) {
      await healDiscoveryFile(dataDir, hinted.d, typeof hinted.health?.startedAt === 'number' ? hinted.health.startedAt : null)
      return buildGatewayInfo(hinted.d, hinted.health)
    }
    if (probe === null) return { ok: false, reason: 'health-failed', baseUrl, port: d.port, pid: d.pid }
    if (probe.status !== 200) return { ok: false, reason: `health-http-${probe.status}`, baseUrl, port: d.port, pid: d.pid }
    return { ok: false, reason: 'stale-gateway-json', baseUrl, port: d.port, pid: d.pid }
  }
  const hinted = await hintDiscovery(dataDir, plistPath, null)
  if (hinted !== null) {
    await healDiscoveryFile(dataDir, hinted.d, typeof hinted.health?.startedAt === 'number' ? hinted.health.startedAt : null)
    return buildGatewayInfo(hinted.d, hinted.health)
  }
  return { ok: false, reason: 'no-gateway-json' }
}

/** POST one `/api/<method>` command; unwraps `{result}` and throws on errors. */
async function postToGateway<T>(d: Discovery, method: string, args: Record<string, unknown>): Promise<T> {
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

/** POST one `/api/<method>` command — through the same lifeline as
 * `discover`: without gateway.json the pinned-port probe answers, and a
 * record that went stale under a running engine (the wipe, or an engine
 * restart the file did not follow) retries once against the live engine. */
export async function callGateway<T>(dataDir: string, method: string, args: Record<string, unknown> = {}, plistPath: string = ENGINE_PLIST): Promise<T> {
  const onDisk = readDiscoveryWithFallback(dataDir)
  if (onDisk === null) {
    const hinted = await hintDiscovery(dataDir, plistPath, null)
    if (hinted === null) throw new Error('gateway.json not found — sdk-bots host 是否在运行？')
    await healDiscoveryFile(dataDir, hinted.d, typeof hinted.health?.startedAt === 'number' ? hinted.health.startedAt : null)
    return postToGateway<T>(hinted.d, method, args)
  }
  try {
    return await postToGateway<T>(onDisk, method, args)
  } catch (err) {
    const hinted = await hintDiscovery(dataDir, plistPath, onDisk)
    if (hinted === null) throw err
    await healDiscoveryFile(dataDir, hinted.d, typeof hinted.health?.startedAt === 'number' ? hinted.health.startedAt : null)
    return postToGateway<T>(hinted.d, method, args)
  }
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
    runStartedAt: Number.isFinite(a.runStartedAt) && a.runStartedAt > 0 ? a.runStartedAt : null,
    isRetrying: a.isRetrying === true,
    currentActivity: a.currentActivity != null && typeof a.currentActivity === 'object' ? {
      kind: typeof a.currentActivity.kind === 'string' ? a.currentActivity.kind.slice(0, 40) : undefined,
      tool: typeof a.currentActivity.tool === 'string' ? a.currentActivity.tool.slice(0, 80) : undefined,
      detail: typeof a.currentActivity.detail === 'string' ? a.currentActivity.detail.slice(0, 200) : undefined,
    } : null,
    isActive: a.isActive !== false,
    lastMessagePreview: typeof a.lastMessagePreview === 'string' ? a.lastMessagePreview : null,
    updatedAt: a.updatedAt ?? null,
    isComposingMessage: Boolean(a.isComposingMessage),
    hasUnread: Boolean(a.hasUnread),
    unreadCount: Number.isFinite(a.unreadCount) ? Number(a.unreadCount) : 0,
    isHiddenFromSidebar: Boolean(a.isHiddenFromSidebar),
    awaitingUserResponse: typeof a.awaitingUserResponse === 'string' ? a.awaitingUserResponse
      : a.awaitingUserResponse != null && typeof a.awaitingUserResponse === 'object'
        ? String(a.awaitingUserResponse.reason ?? 'waiting-for-user').slice(0, 500) : null,
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
  if (kind === 'user-attachment') return 'attachment'
  if (kind.includes('tool')) return 'tool'
  if (kind === 'thinking' || kind === 'reasoning' || kind === 'redacted-reasoning') return 'thinking'
  if (kind === 'send-message' || kind === 'agent-message' || kind === 'assistant-text') return 'assistant'
  if (kind === 'message' || kind === 'user-message') return role === 'user' ? 'user' : 'assistant'
  return 'event'
}

/** First integer field of an entry, or null (attachments carry dimensions). */
function entryDim(...candidates: unknown[]): number | null {
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) return Math.round(c)
  }
  return null
}

/** Normalize one transcript entry for the UI's closed render switch. */
export function trimEntry(en: any): TranscriptEntry {
  const kind = String(en?.kind ?? '')
  const role = typeof en?.role === 'string' ? en.role : null
  const display = entryDisplay(kind, role)
  const failed = en?.isError === true || en?.status === 'error' || en?.status === 'failed'
  const isAttachment = display === 'attachment'
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
    // Gateway `user-attachment` entries keep the file on disk and reference
    // it by path; the client renders them through the same readImage pipe
    // bot-written inline images already use (allowlist stays the boundary).
    filePath: isAttachment ? (typeof en?.file_path === 'string' && en.file_path !== '' ? en.file_path : null) : null,
    fileName: isAttachment && typeof en?.file_name === 'string' && en.file_name !== '' ? en.file_name : null,
    width: isAttachment ? entryDim(en?.width) : null,
    height: isAttachment ? entryDim(en?.height) : null,
    byteSize: isAttachment ? entryDim(en?.byteSize) : null,
    toolName: display === 'tool'
      ? String(en?.toolName ?? en?.name ?? en?.tool?.name ?? '工具')
      : null,
    // The engine derives a row summary for tool calls (the shell command,
    // the file path, the search query) — exactly what the native tool row
    // shows after the name, so carry it through instead of re-deriving.
    toolSummary: display === 'tool'
      ? (typeof en?.summary === 'string' && en.summary.trim() !== '' ? en.summary : null)
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
