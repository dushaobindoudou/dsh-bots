/**
 * SSE plumbing for the host half — pure ring + parser (unit-tested) and a
 * native `fetch` listener that keeps the ring fed from the sdk-bots gateway
 * `/events` endpoint. The web client has no network, so this is the only live
 * event path; it replays through `bots.eventsSince(seq)`.
 *
 * The wire uses `Accept-Encoding: identity` to sidestep gzip/deflate handling
 * in the host fetch layer (the gateway also supports `?token=` for the old
 * browser path, but we always send the `authorization` header).
 * @module dsh-plugin-bots/sse
 */

import type { EventsSinceResult, SseEvent, SseState } from './shared.js'

export type { EventsSinceResult, SseEvent, SseState }

/** Incremental SSE wire parser: feed string chunks, receive frames. */
export class SseParser {
  private buffer = ''
  private event = ''
  private dataLines: string[] = []

  constructor(private readonly onEvent: (event: string, data: string) => void) {}

  push(chunk: string): void {
    this.buffer += chunk
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx)
      this.buffer = this.buffer.slice(idx + 1)
      this.feedLine(line)
    }
  }

  private feedLine(line: string): void {
    if (line.endsWith('\r')) line = line.slice(0, -1)
    if (line === '') {
      const data = this.dataLines.join('\n')
      const event = this.event !== '' ? this.event : 'message'
      if (data !== '' || (event !== 'message' && this.dataLines.length > 0)) {
        this.onEvent(event, data)
      }
      this.event = ''
      this.dataLines = []
      return
    }
    // Comment / heartbeat line (`: ping`); ignore.
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') this.event = value
    else if (field === 'data') this.dataLines.push(value)
    // `id` / `retry` are intentionally ignored: seq is assigned locally.
  }
}

/** Bounded, monotonic ring of normalized events with O(log n) `eventsSince`. */
export class SseRingBuffer {
  private readonly capacity: number
  private entries: SseEvent[] = []
  private nextSeq = 0

  constructor(capacity = 3000) {
    this.capacity = Math.max(1, Math.floor(capacity))
  }

  /** Append one event; returns its assigned seq. */
  push(channel: string, data: unknown): number {
    const seq = this.nextSeq
    this.nextSeq += 1
    if (this.entries.length >= this.capacity) this.entries.shift()
    this.entries.push({ seq, channel, data })
    return seq
  }

  /** Replay events strictly after `seq`, or everything when the seq fell off. */
  eventsSince(seq: number): SseEvent[] {
    if (this.entries.length === 0) return []
    const oldest = this.entries[0]!.seq
    if (seq < oldest - 1 || Number.isNaN(seq)) return this.entries.slice()
    let lo = 0
    let hi = this.entries.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((this.entries[mid] as SseEvent).seq <= seq) lo = mid + 1
      else hi = mid
    }
    return this.entries.slice(lo)
  }

  get size(): number { return this.entries.length }
  get total(): number { return this.nextSeq }
}

function toState(ring: SseRingBuffer, live: { running: boolean; ok: boolean; lastError: string | null; connectedAt: string | null; droppedAt: string | null }): SseState {
  return {
    running: live.running,
    ok: live.ok,
    lastError: live.lastError,
    connectedAt: live.connectedAt,
    droppedAt: live.droppedAt,
    buffered: ring.size,
    total: ring.total,
  }
}

/**
 * Long-lived `/events` listener. Re-resolves discovery on every connect so a
 * restarted sdk-bots host is picked up automatically; reconnects are silent
 * and bounded. Deliberately never throws — errors surface via `state()`.
 */
export class GatewaySseClient {
  private readonly ring: SseRingBuffer
  private readonly resolveBase: () => { url: string; token: string | null } | null
  private readonly reconnectBaseMs: number
  private readonly channels?: string[]

  private ac: AbortController | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = true
  private ok = false
  private lastError: string | null = null
  private connectedAt: string | null = null
  private droppedAt: string | null = null
  private attempt = 0

  constructor(opts: {
    ring?: SseRingBuffer
    resolveBase: () => { url: string; token: string | null } | null
    reconnectBaseMs?: number
    /** Optional `channels` subscription subset, e.g. `transcript,agents`. */
    channels?: string[]
  }) {
    this.ring = opts.ring ?? new SseRingBuffer()
    this.resolveBase = opts.resolveBase
    this.reconnectBaseMs = opts.reconnectBaseMs ?? 2000
    this.channels = opts.channels
  }

  get buffer(): SseRingBuffer { return this.ring }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.attempt = 0
    void this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null }
    this.ac?.abort()
    this.ac = null
    this.ok = false
    this.droppedAt = this.connectedAt !== null ? new Date().toISOString() : null
  }

  state(): SseState {
    return toState(this.ring, {
      running: !this.stopped,
      ok: this.ok,
      lastError: this.lastError,
      connectedAt: this.connectedAt,
      droppedAt: this.droppedAt,
    })
  }

  eventsSince(seq: number): EventsSinceResult {
    return { events: this.ring.eventsSince(seq), nextSeq: this.ring.total, state: this.state() }
  }

  private async connect(): Promise<void> {
    if (this.stopped) return
    const base = this.resolveBase()
    if (base === null) {
      this.lastError = 'no-gateway-json'
      this.schedule()
      return
    }
    this.ac = new AbortController()
    let endpoint = `${base.url}/events`
    if (this.channels !== undefined && this.channels.length > 0) {
      endpoint += `?channels=${encodeURIComponent(this.channels.join(','))}`
    }
    const headers: Record<string, string> = { accept: 'text/event-stream', 'accept-encoding': 'identity' }
    if (base.token !== null) headers['authorization'] = `Bearer ${base.token}`

    const parser = new SseParser((event, data) => {
      let parsed: unknown = data
      try { parsed = JSON.parse(data) } catch { /* keep raw string */ }
      this.ring.push(event, parsed)
    })

    try {
      const res = await fetch(endpoint, { headers, signal: this.ac.signal })
      if (this.stopped) return
      if (!res.ok || res.body === null) {
        // Non-2xx or no body → not an SSE stream; treat as a hard connection error.
        this.ok = false
        this.lastError = `health-http-${res.status}`
        this.droppedAt = new Date().toISOString()
        this.schedule()
        return
      }
      this.ok = true
      this.lastError = null
      this.connectedAt = new Date().toISOString()
      this.droppedAt = null

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        parser.push(decoder.decode(value, { stream: true }))
      }
      this.ok = false
      this.droppedAt = new Date().toISOString()
    } catch (err) {
      if (this.stopped) return
      this.ok = false
      this.lastError = String((err as Error)?.message ?? err)
      this.droppedAt = new Date().toISOString()
    }
    this.schedule()
  }

  private schedule(): void {
    if (this.stopped) return
    this.attempt += 1
    const delay = Math.min(this.reconnectBaseMs * this.attempt, 15000)
    this.timer = setTimeout(() => { this.timer = null; void this.connect() }, delay)
  }
}
