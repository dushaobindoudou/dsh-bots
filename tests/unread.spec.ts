/**
 * Unit tests for the plugin-owned unread model (`src/unread.ts`).
 *
 * The badge used to read the gateway's `unreadCount`, which is desktop-app
 * semantics (single active session, window focus, read-on-transcript-read)
 * and never accumulates on a headless local gateway — every agent sat at 0
 * while bots were chatting. These tests pin the replacement contract:
 * message-kind filtering, the persisted "读到哪" marker, replay-idempotent
 * bumps, tail rebases, and first-run seeding.
 */
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { SseRingBuffer } from '../src/sse.js'
import { UnreadStore, entryEpochMs, isMessageEntryKind } from '../src/unread.js'

const KINDS_THAT_COUNT = ['message', 'user-message', 'send-message', 'agent-message', 'assistant-text', 'user-attachment']
const KINDS_THAT_DO_NOT = ['tool-call', 'tool-result', 'thinking', 'event', 'automation-changed', '', undefined, null, 42]

describe('isMessageEntryKind', () => {
  it('counts every human-visible message kind', () => {
    for (const kind of KINDS_THAT_COUNT) expect(isMessageEntryKind(kind), String(kind)).toBe(true)
  })

  it('never counts tools, thinking, events, or junk', () => {
    for (const kind of KINDS_THAT_DO_NOT) expect(isMessageEntryKind(kind), String(kind)).toBe(false)
  })
})

describe('entryEpochMs', () => {
  it('normalizes ms, seconds, numeric strings and ISO', () => {
    expect(entryEpochMs(1_700_000_000_000)).toBe(1_700_000_000_000)
    expect(entryEpochMs(1_700_000_000)).toBe(1_700_000_000_000) // seconds stamp
    expect(entryEpochMs('1700000000000')).toBe(1_700_000_000_000)
    expect(entryEpochMs('2026-09-02T00:00:00Z')).toBe(Date.parse('2026-09-02T00:00:00Z'))
  })

  it('returns null for anything unusable', () => {
    expect(entryEpochMs('yesterday')).toBeNull()
    expect(entryEpochMs(0)).toBeNull()
    expect(entryEpochMs(-5)).toBeNull()
    expect(entryEpochMs(null)).toBeNull()
    expect(entryEpochMs(undefined)).toBeNull()
  })
})

describe('UnreadStore', () => {
  function fresh(now: () => number = Date.now): { store: UnreadStore; file: string } {
    const file = join(mkdtempSync(join(tmpdir(), 'dsh-bots-unread-')), 'dsh-bots-unread.json')
    return { store: new UnreadStore(file, now), file }
  }

  it('bumps per agent for message kinds only', () => {
    const { store } = fresh()
    const A = 'a-agent', B = 'b-agent'
    store.bump(A, { kind: 'send-message', timestampMs: 1_700_000_000_000 })
    store.bump(A, { kind: 'tool-call', timestampMs: 1_700_000_000_001 })
    store.bump(A, { kind: 'thinking', timestampMs: 1_700_000_000_002 })
    store.bump(B, { kind: 'message', timestampMs: 1_700_000_000_003 })
    store.bump(B, { kind: 'user-attachment', timestampMs: 1_700_000_000_004 })
    expect(store.unreadFor(A)).toBe(1)
    expect(store.unreadFor(B)).toBe(2)
    expect(store.counts()).toEqual({ 'a-agent': 1, 'b-agent': 2 })
  })

  it('ignores arrivals at or before the read marker (replay-idempotent)', () => {
    const { store } = fresh()
    const A = 'a-agent'
    store.markRead(A, 1_700_000_000_000)
    store.bump(A, { kind: 'message', timestampMs: 1_700_000_000_000 }) // already read
    store.bump(A, { kind: 'message', timestampMs: 1_699_999_999_999 }) // older history
    expect(store.unreadFor(A)).toBe(0)
    store.bump(A, { kind: 'send-message', timestampMs: 1_700_000_000_001 }) // genuinely new
    expect(store.unreadFor(A)).toBe(1)
  })

  it('falls back to arrival time when the entry has no timestamp', () => {
    let tick = 1_700_000_000_000
    const { store } = fresh(() => tick)
    const A = 'a-agent'
    store.markRead(A, tick)
    tick += 1_000
    store.bump(A, { kind: 'send-message' })
    expect(store.unreadFor(A)).toBe(1)
  })

  it('markRead zeroes the count and survives a restart via the marker file', () => {
    const { store, file } = fresh()
    const A = 'a-agent'
    store.bump(A, { kind: 'message', timestampMs: 1_700_000_000_500 })
    store.markRead(A, 1_700_000_000_600)
    expect(store.unreadFor(A)).toBe(0)
    expect(existsSync(file)).toBe(true)

    // A brand-new instance (host restart) restores the marker from disk.
    const revived = new UnreadStore(file)
    revived.bump(A, { kind: 'message', timestampMs: 1_700_000_000_550 }) // pre-marker replay
    expect(revived.unreadFor(A)).toBe(0)
    revived.bump(A, { kind: 'message', timestampMs: 1_700_000_000_700 }) // new traffic
    expect(revived.unreadFor(A)).toBe(1)
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    expect(saved.version).toBe(1)
    expect(saved.markers[A]).toBe(1_700_000_000_600)
  })

  it('rebases counts from a transcript tail after a restart', () => {
    const { store, file } = fresh()
    const A = 'a-agent'
    store.markRead(A, 1_700_000_000_000)
    const revived = new UnreadStore(file)
    revived.rebase(A, [
      { kind: 'message', timestampMs: 1_699_999_000_000 }, // old
      { kind: 'tool-call', timestampMs: 1_700_000_500_000 }, // not a message
      { kind: 'send-message', timestampMs: 1_700_001_000_000 }, // unread
      { kind: 'message', timestampMs: 1_700_002_000_000 }, // unread
      { kind: 'send-message' }, // no ts → not counted in a rebase
    ])
    expect(revived.unreadFor(A)).toBe(2)
  })

  it('seeds legacy history as read on first run, but not for later agents', () => {
    const { store, file } = fresh()
    const OLD = 'old-agent'
    // Fresh install: rebase seeds the marker at "now" — an upgrade must not
    // light up a wall of backlog badges.
    store.rebase(OLD, [{ kind: 'send-message', timestampMs: 1 }]) // ancient history
    expect(store.unreadFor(OLD)).toBe(0)

    // The seed persists: a revived store treats history as read too.
    const revived = new UnreadStore(file)
    revived.rebase(OLD, [{ kind: 'send-message', timestampMs: 1 }])
    expect(revived.unreadFor(OLD)).toBe(0)

    // But an agent created after the seed (no marker yet, install not fresh)
    // counts its transcript from the beginning.
    const NEW = 'new-agent'
    let tick = 9_000_000_000_000
    const later = new UnreadStore(file, () => tick)
    later.rebase(NEW, [{ kind: 'send-message', timestampMs: 8_999_999_000_000 }])
    expect(later.unreadFor(NEW)).toBe(1)
  })

  it('prunes state for deleted agents', () => {
    const { store, file } = fresh()
    store.bump('kept', { kind: 'message', timestampMs: 1_700_000_000_001 })
    store.bump('gone', { kind: 'message', timestampMs: 1_700_000_000_002 })
    store.markRead('gone', 1_700_000_000_003)
    const removed = store.prune(new Set(['kept']))
    expect(removed).toEqual(['gone'])
    expect(store.counts()).toEqual({ kept: 1 })
    const revived = new UnreadStore(file)
    revived.rebase('gone', [{ kind: 'message', timestampMs: 1_700_000_005_000 }])
    // No marker → genuinely never-read agent (post-prune re-creation).
    expect(revived.unreadFor('gone')).toBe(1)
  })
})

describe('SseRingBuffer onPush', () => {
  it('observes every pushed event with channel and data', () => {
    const seen: Array<[string, unknown]> = []
    const ring = new SseRingBuffer(10, (channel, data) => { seen.push([channel, data]) })
    ring.push('transcript', { type: 'appended', agentId: 'a' })
    ring.push('agents', { foo: 1 })
    expect(seen).toEqual([
      ['transcript', { type: 'appended', agentId: 'a' }],
      ['agents', { foo: 1 }],
    ])
    expect(ring.total).toBe(2)
  })

  it('keeps the ring alive when the observer throws', () => {
    const ring = new SseRingBuffer(10, () => { throw new Error('observer bug') })
    expect(() => ring.push('transcript', { x: 1 })).not.toThrow()
    expect(ring.eventsSince(-1)).toHaveLength(1)
  })
})
