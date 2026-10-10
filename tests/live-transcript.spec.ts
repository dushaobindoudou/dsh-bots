/**
 * Client data-path guards (the browser suite exercises these end to end;
 * these pins keep the shape from regressing between browser runs):
 * live rows merge from the event ring instead of re-reading the tail,
 * history pages through the engine cursor, the ring drains on an adaptive
 * self-scheduled loop, drafts survive reloads, avatars respect a frame
 * budget, and a stale host half is announced.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = readFileSync(join(ROOT, 'src', 'client.ts'), 'utf8')
const HOST = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8')
const BAKE = readFileSync(join(ROOT, 'scripts', 'bake-version.mjs'), 'utf8')

describe('live transcript', () => {
  it('ships display rows on the event ring and merges them in place', () => {
    expect(HOST).toContain('data: { ...rest, view: trimEntry(entry) }')
    expect(CLIENT).toContain('function applyLive(payload: any): boolean')
    expect(CLIENT).toContain("if ((payload?.type === 'appended' || payload?.type === 'updated') && applyLive(payload)) continue")
    // Reconcile reads are short and single-flight; full reads only on gaps.
    expect(CLIENT).toContain('const limit = wantFull ? Math.min(500, Math.max(80, (current?.length ?? 0) + 20)) : 24')
    expect(CLIENT).toContain('if (box.inFlight) { box.again = true; return }')
  })

  it('pages older history through the engine beforeSeq cursor', () => {
    expect(HOST).toContain('...(Number.isFinite(beforeSeq) ? { beforeSeq } : {})')
    expect(HOST).toContain('nextBeforeSeq: typeof res?.nextBeforeSeq')
    expect(CLIENT).toContain("botsCall('transcriptTail', { id: p.agentId, limit: 80, beforeSeq: olderCursor })")
  })
})

describe('event ring cadence', () => {
  it('self-schedules (no overlapping drains) and tightens while events flow', () => {
    expect(CLIENT).not.toContain('setInterval(() => { void drain() }')
    expect(CLIENT).toContain('const RING_DRAIN_ACTIVE_MS = 250')
    expect(CLIENT).toContain('schedule(activeLeft > 0 ? RING_DRAIN_ACTIVE_MS : RING_DRAIN_MS, id)')
  })
})

describe('drafts', () => {
  it('persist to this browser, best effort', () => {
    expect(CLIENT).toContain("const DRAFTS_KEY = 'dsh-bots.drafts.v1'")
    expect(CLIENT).toMatch(/try \{ window\.localStorage\.setItem\(DRAFTS_KEY/)
  })
})

describe('avatar frame budget', () => {
  it('skips offscreen avatars and slows resting ones', () => {
    expect(CLIENT).toContain('new IntersectionObserver(')
    expect(CLIENT).toContain("if (mode === 'thinking' || mode === 'working' || mode === 'retrying') return true")
    expect(CLIENT).toContain('const AVATAR_STILL_BELOW = 24')
    expect(CLIENT).toContain('if (svg !== last) { last = svg; ref.current.innerHTML = svg }')
  })
})

describe('stale host notice', () => {
  it('bakes one host fingerprint into both halves and compares them', () => {
    expect(HOST).toContain("const HOST_BUILD = 'unbaked-host-build'")
    expect(HOST).toContain('hostBuild: HOST_BUILD')
    expect(CLIENT.match(/const EXPECTED_HOST_BUILD = /g)).toHaveLength(1)
    expect(CLIENT).toContain('if (p.wide === false || !hostIsStale(s.info)) return null')
    expect(CLIENT).toContain("{ name: 'sidebar.footer.action', id: 'dsh-bots.host-update'")
    expect(BAKE).toContain('expected exactly one ${label} sentinel')
  })
})
