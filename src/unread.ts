/**
 * Per-agent unread tracking for the sidebar badge.
 *
 * Why not the gateway's `unreadCount`? The sdk-bots host models unread state
 * for the Grok desktop app: arrivals only count on the single `activeSession`,
 * a focused window marks everything read instantly, and any transcript READ
 * (`openAgentBounded` → `markAgentViewed`) clears the marker — which our own
 * tail polling trips constantly. On a headless local gateway that model never
 * accumulates (every agent observed at `unreadCount: 0` despite activity).
 *
 * So the plugin owns the model instead, at the one layer that is always
 * watching: the host half's SSE ring. Rules:
 *
 *   - A "message" is a human-visible transcript kind (user prompt, bot reply,
 *     attachment) — never tool calls, thinking, or system events.
 *   - Each agent has a persisted marker `lastReadAtMs` ("读到哪了") in
 *     `<dataDir>/dsh-bots-unread.json`; opening the conversation advances it.
 *   - Live arrivals with `timestampMs > marker` bump the count; anything at or
 *     before the marker is already-read history and is ignored (this is what
 *     makes snapshot replays on SSE reconnect idempotent).
 *   - After a restart the in-memory counts are gone but the markers survive,
 *     so a rebase from transcript tails reconstructs the counts exactly.
 *   - First run (no marker file yet) treats all existing history as read —
 *     an upgrade must not light up 30 badges of backlog.
 * @module dsh-bots/unread
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Wire `kind`s that represent a message a human would want to see. */
const MESSAGE_KINDS: ReadonlySet<string> = new Set([
  'message',
  'user-message',
  'send-message',
  'agent-message',
  'assistant-text',
  'user-attachment',
])

/** True when a transcript entry kind should raise the unread badge. */
export function isMessageEntryKind(kind: unknown): boolean {
  return typeof kind === 'string' && MESSAGE_KINDS.has(kind)
}

/** Seconds/milliseconds/ISO → epoch ms; null when unreadable. */
export function entryEpochMs(raw: unknown): number | null {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return null
    return Math.round(raw < 1e11 ? raw * 1000 : raw)
  }
  if (typeof raw !== 'string' || raw === '') return null
  if (/^\d+$/.test(raw)) return entryEpochMs(Number(raw))
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : null
}

/** Minimal shape the store needs from a wire transcript entry. */
export interface UnreadEntry {
  kind?: unknown
  timestampMs?: unknown
}

/** On-disk shape. Versioned so future migrations can branch. */
interface UnreadFile {
  version: 1
  markers: Record<string, number>
}

/**
 * Unread counts + persisted read markers, one instance per plugin host.
 * All mutations are crash-safe: markers flush to disk synchronously (a few
 * hundred bytes), counts are reconstructible so they stay in memory.
 */
export class UnreadStore {
  private markers = new Map<string, number>()
  private countBy = new Map<string, number>()
  private loaded = false
  /** True when no marker file existed at first load (seed-legacy mode). */
  private freshInstall = false

  constructor(
    private readonly filePath: string,
    private readonly now: () => number = Date.now,
  ) {}

  private ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true
    try {
      if (existsSync(this.filePath)) {
        const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as UnreadFile | null
        if (raw !== null && typeof raw === 'object' && raw.version === 1 && raw.markers !== null && typeof raw.markers === 'object') {
          for (const [id, at] of Object.entries(raw.markers)) {
            if (typeof at === 'number' && Number.isFinite(at) && at > 0) this.markers.set(id, at)
          }
        }
      } else {
        // First run after the feature (or after manually clearing state):
        // existing history counts as read, only new traffic raises badges.
        this.freshInstall = true
      }
    } catch {
      // A corrupt file must not brick the badge; treat as fresh.
      this.freshInstall = true
    }
  }

  private persist(): void {
    try {
      const markers: Record<string, number> = {}
      for (const [id, at] of this.markers) markers[id] = at
      const body: UnreadFile = { version: 1, markers }
      mkdirSync(dirname(this.filePath), { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(body))
    } catch {
      // Best effort: counts still work in memory; markers rebuild lazily.
    }
  }

  /** Snapshot of all live counts, keyed by agent id. */
  counts(): Record<string, number> {
    this.ensureLoaded()
    const out: Record<string, number> = {}
    for (const [id, n] of this.countBy) {
      if (n > 0) out[id] = n
    }
    return out
  }

  /** Current unread count for one agent (0 when none). */
  unreadFor(agentId: string): number {
    this.ensureLoaded()
    return this.countBy.get(agentId) ?? 0
  }

  /**
   * One live transcript arrival. Entries at or before the read marker are
   * already-read history (snapshot replays) and are ignored.
   */
  bump(agentId: string, entry: UnreadEntry | null | undefined): void {
    if (typeof agentId !== 'string' || agentId === '' || !isMessageEntryKind(entry?.kind)) return
    this.ensureLoaded()
    const ts = entryEpochMs(entry?.timestampMs) ?? this.now()
    if (ts <= (this.markers.get(agentId) ?? 0)) return
    this.countBy.set(agentId, (this.countBy.get(agentId) ?? 0) + 1)
  }

  /**
   * The user read the conversation: zero the count and advance the marker
   * ("上次读到哪" = now, or the explicit position when given).
   */
  markRead(agentId: string, atMs?: number): void {
    if (typeof agentId !== 'string' || agentId === '') return
    this.ensureLoaded()
    const at = Math.max(atMs ?? this.now(), this.markers.get(agentId) ?? 0)
    this.markers.set(agentId, at)
    this.countBy.set(agentId, 0)
    this.persist()
  }

  /**
   * Recompute one agent's count from a transcript tail (reconnect/boot heal).
   * An agent never seen before on a fresh install is seeded as read-up-to-now;
   * an agent without a marker on a normal boot is genuinely never-read.
   */
  rebase(agentId: string, entries: ReadonlyArray<UnreadEntry | null | undefined>): void {
    if (typeof agentId !== 'string' || agentId === '') return
    this.ensureLoaded()
    if (this.freshInstall && !this.markers.has(agentId)) {
      this.markers.set(agentId, this.now())
      this.countBy.set(agentId, 0)
      this.persist()
      return
    }
    const marker = this.markers.get(agentId) ?? 0
    let n = 0
    for (const entry of entries) {
      if (!isMessageEntryKind(entry?.kind)) continue
      const ts = entryEpochMs(entry?.timestampMs)
      if (ts !== null && ts > marker) n += 1
    }
    this.countBy.set(agentId, n)
  }

  /** Drop state for agents that no longer exist; returns the removed ids. */
  prune(knownIds: ReadonlySet<string>): string[] {
    this.ensureLoaded()
    const removed: string[] = []
    for (const id of [...this.markers.keys()]) {
      if (!knownIds.has(id)) {
        this.markers.delete(id)
        removed.push(id)
      }
    }
    for (const id of [...this.countBy.keys()]) {
      if (!knownIds.has(id)) this.countBy.delete(id)
    }
    if (removed.length > 0) this.persist()
    return removed
  }
}
