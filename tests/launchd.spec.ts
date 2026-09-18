/**
 * launchd reload regression tests.
 *
 * The 2026-09-18 outage: `applyModel` ran bootout → bootstrap back to back
 * through a helper that discarded stderr. A bootstrap landing while the
 * outgoing process still held the label fails with "Bootstrap failed: 5:
 * Input/output error" (reproduced 5/5 with a scratch job), so the engine ended
 * up UNLOADED — no RunAtLoad, no KeepAlive — and stayed silently down ~3.5 h.
 * These pin the repaired orchestration in `src/launchd.ts`: wait for the label
 * to be released before bootstrapping, retry, and surface every stderr.
 */
import { describe, expect, it } from 'vitest'
import { labelIsFree, realLaunchctl, reloadLaunchdJob, waitForLabelFree, type LaunchctlRunner } from '../src/launchd.js'

/** Instant fake sleep — keeps the polling semantics without real waiting. */
const noDelay = () => Promise.resolve()

/** A runner whose per-verb results come from a script, recording every call. */
function scriptedRunner(script: Partial<Record<string, { ok: boolean; stderr?: string }>>): { run: LaunchctlRunner; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    run: (args) => {
      calls.push(args.join(' '))
      const s = script[args[0]] ?? { ok: true }
      return { ok: s.ok, stderr: s.stderr ?? '' }
    },
  }
}

const OPTS = { uid: 501, label: 'com.sdk-bots.host', plistPath: '/tmp/host.plist' }

describe('waitForLabelFree', () => {
  it('returns true immediately when the label is already free', async () => {
    const { run } = scriptedRunner({ print: { ok: false, stderr: 'Could not find service "x" in domain for user gui: 501' } })
    expect(await waitForLabelFree('gui/501/x', run, noDelay, 100, 5)).toBe(true)
  })

  it('keeps polling until the label frees, then returns true', async () => {
    let prints = 0
    const run: LaunchctlRunner = (args) => {
      if (args[0] === 'print') { prints++; return { ok: prints < 3, stderr: '' } }
      return { ok: true, stderr: '' }
    }
    expect(await waitForLabelFree('gui/501/x', run, noDelay, 10_000, 0)).toBe(true)
    expect(prints).toBeGreaterThanOrEqual(3)
  })

  it('gives up (false) after the timeout when the label never frees', async () => {
    const { run } = scriptedRunner({ print: { ok: true, stderr: '' } })
    expect(await waitForLabelFree('gui/501/x', run, noDelay, 0, 0)).toBe(false)
  })
})

describe('reloadLaunchdJob', () => {
  it('THE RACE: waits for the label to be held→freed, so bootstrap succeeds on the first try', async () => {
    // Mirrors the real failure window: bootout returns while the outgoing
    // process still holds the label; only after it exits may bootstrap run.
    let prints = 0
    let bootstraps = 0
    const run: LaunchctlRunner = (args) => {
      const verb = args[0]
      if (verb === 'print') { prints++; return { ok: prints < 3, stderr: '' } }
      if (verb === 'bootout') return { ok: true, stderr: '' }
      if (verb === 'bootstrap') {
        bootstraps++
        return prints >= 3
          ? { ok: true, stderr: '' }
          : { ok: false, stderr: 'Bootstrap failed: 5: Input/output error' }
      }
      if (verb === 'kickstart') return { ok: true, stderr: '' }
      return { ok: true, stderr: '' }
    }
    const out = await reloadLaunchdJob({ ...OPTS, run, delay: noDelay })
    expect(out.reloaded).toBe(true)
    expect(out.restarted).toBe(true)
    expect(out.errors).toEqual([])
    expect(bootstraps).toBe(1)
  })

  it('a bootout of an unloaded job is an expected no-op, not an error', async () => {
    const notLoaded = { ok: false, stderr: 'Could not find service "com.sdk-bots.host" in domain for user gui: 501' }
    const { run, calls } = scriptedRunner({ print: notLoaded, bootout: notLoaded })
    const out = await reloadLaunchdJob({ ...OPTS, run, delay: noDelay })
    expect(out.reloaded).toBe(true)
    expect(out.errors).toEqual([])
    expect(calls.some((c) => c.startsWith('bootout'))).toBe(true)
  })

  it('retries the bootstrap and surfaces stderr when it keeps failing', async () => {
    const { run } = scriptedRunner({
      print: { ok: false, stderr: '' },
      bootstrap: { ok: false, stderr: 'Bootstrap failed: 5: Input/output error' },
    })
    const out = await reloadLaunchdJob({ ...OPTS, run, delay: noDelay, bootstrapAttempts: 3 })
    expect(out.reloaded).toBe(false)
    expect(out.restarted).toBe(false)
    expect(out.errors.filter((e) => e.startsWith('bootstrap'))).toHaveLength(3)
    expect(out.errors.join(' ')).toContain('Input/output error')
  })

  it('never kickstarts a job whose bootstrap failed', async () => {
    const { run, calls } = scriptedRunner({
      print: { ok: false, stderr: '' },
      bootstrap: { ok: false, stderr: 'Bootstrap failed: 5: Input/output error' },
    })
    const out = await reloadLaunchdJob({ ...OPTS, run, delay: noDelay, bootstrapAttempts: 2 })
    expect(out.restarted).toBe(false)
    expect(calls.some((c) => c.startsWith('kickstart'))).toBe(false)
  })

  it('reports a label that never frees instead of bootstrapping into the race', async () => {
    const { run, calls } = scriptedRunner({ print: { ok: true, stderr: '' } })
    const out = await reloadLaunchdJob({ ...OPTS, run, delay: noDelay, labelTimeoutMs: 0 })
    expect(out.reloaded).toBe(false)
    expect(out.errors.some((e) => e.includes('still held'))).toBe(true)
    expect(calls.some((c) => c.startsWith('bootstrap'))).toBe(false)
  })

  it('treats a bootout failure other than not-loaded as an error', async () => {
    const { run } = scriptedRunner({
      print: { ok: false, stderr: '' },
      bootout: { ok: false, stderr: 'Boot-out failed: 220: Invalid argument' },
    })
    const out = await reloadLaunchdJob({ ...OPTS, run, delay: noDelay })
    expect(out.errors.some((e) => e.startsWith('bootout:'))).toBe(true)
  })
})

describe('labelIsFree', () => {
  it('reads launchctl print failure as "free"', () => {
    const { run } = scriptedRunner({ print: { ok: false, stderr: 'Could not find service' } })
    expect(labelIsFree('gui/501/x', run)).toBe(true)
  })
  it('reads launchctl print success as "held"', () => {
    const { run } = scriptedRunner({ print: { ok: true, stderr: '' } })
    expect(labelIsFree('gui/501/x', run)).toBe(false)
  })
})

const darwinIt = process.platform === 'darwin' ? it : it.skip
describe('realLaunchctl (darwin smoke)', () => {
  darwinIt('parses a real not-loaded label without throwing', () => {
    const r = realLaunchctl(['print', 'gui/501/com.dshb.launchd-spec.nonexistent'])
    expect(r.ok).toBe(false)
    expect(r.stderr).toContain('Could not find service')
  })
})
