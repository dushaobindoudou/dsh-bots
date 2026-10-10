/**
 * launchd job orchestration for the sdk-bots engine (`com.sdk-bots.host`).
 *
 * Why this module exists: `applyModel` used to run `bootout` → `bootstrap`
 * back to back through a helper that discarded stderr. launchd's bootout
 * returns before the outgoing process has exited, and a bootstrap that lands
 * while the label is still held fails with "Bootstrap failed: 5: Input/output
 * error" (reproduced 5/5 with a scratch job). When that failure hit on
 * 2026-09-18, the engine ended up UNLOADED — no RunAtLoad, no KeepAlive — and
 * because both stderr and the `restarted:false` result were swallowed, the
 * gateway stayed silently down for ~3.5 h ("gateway.json not found"). This
 * module makes every step observable: wait for the label to be released,
 * retry the bootstrap, and return each stderr instead of dropping it.
 * @module dsh-bots/launchd
 */

import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The sdk-bots engine job this plugin owns (launchd on darwin). */
export const ENGINE_LAUNCHD_LABEL = 'com.sdk-bots.host'
/** The engine's LaunchAgent plist; also the source of the pinned port hint
 * (`SAND_HOST_PORT`) gateway discovery falls back to when gateway.json is
 * lost while the engine is still alive. */
export const ENGINE_PLIST = join(homedir(), 'Library', 'LaunchAgents', `${ENGINE_LAUNCHD_LABEL}.plist`)

/**
 * What reconnect should do about an unreachable engine, given whether the
 * launchd job is currently loaded. 2026-10-10: a live engine whose
 * gateway.json had been wiped stayed "未连接" forever because the old ladder
 * treated "job loaded" as "leave it alone" — loaded-but-dead and
 * loaded-but-hung engines need an in-place bounce, not a wait.
 */
export type RecoveryAction = 'none' | 'reload' | 'kickstart'

export function engineRecoveryPlan(engineReachable: boolean, jobLoaded: boolean): RecoveryAction {
  if (engineReachable) return 'none'
  return jobLoaded ? 'kickstart' : 'reload'
}

export interface LaunchctlResult {
  ok: boolean
  stderr: string
}

export type LaunchctlRunner = (args: string[]) => LaunchctlResult

export type Delay = (ms: number) => Promise<void>

export const realDelay: Delay = (ms) => new Promise<void>((resolve) => { setTimeout(resolve, ms) })

/** The real runner: spawnSync launchctl, keeping stderr instead of dropping it. */
export function realLaunchctl(args: string[]): LaunchctlResult {
  const r = spawnSync('launchctl', args, { encoding: 'utf8' })
  return { ok: r.status === 0, stderr: (r.stderr ?? '').trim() }
}

/** True when launchctl no longer has the label loaded ("Could not find service"). */
export function labelIsFree(target: string, run: LaunchctlRunner): boolean {
  return run(['print', target]).ok === false
}

/**
 * Poll until the outgoing process releases the label. bootout returns before
 * the old process exits; bootstrapping inside that window is the exact race
 * that unloaded the engine. Bounded by `timeoutMs` (poll every `stepMs`).
 */
export async function waitForLabelFree(
  target: string,
  run: LaunchctlRunner,
  delay: Delay,
  timeoutMs = 8000,
  stepMs = 200,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (labelIsFree(target, run) === false) {
    if (Date.now() >= deadline) return false
    await delay(stepMs)
  }
  return true
}

export interface ReloadOutcome {
  /** bootstrap succeeded — the (re)edited job definition is loaded again. */
  reloaded: boolean
  /** kickstart succeeded — the freshly loaded job was told to run. */
  restarted: boolean
  /** Every captured failure, in order. Empty on a clean reload. */
  errors: string[]
}

export interface ReloadOptions {
  uid: number
  label: string
  plistPath: string
  run: LaunchctlRunner
  /** Injectable sleep (tests pass an instant fake); defaults to real timeouts. */
  delay?: Delay
  /** How long to wait for the label to be released. */
  labelTimeoutMs?: number
  /** bootstrap attempts once the label is free. */
  bootstrapAttempts?: number
}

/**
 * bootout → wait for the label to be free → bootstrap (retried) → kickstart.
 *
 * A bootout of an unloaded job is an expected no-op ("Could not find service")
 * and is not reported as an error. Never throws: callers receive per-step
 * results plus every captured stderr so a failed reload can actually be shown
 * to the user instead of leaving the engine unloaded in silence.
 */
export async function reloadLaunchdJob(opts: ReloadOptions): Promise<ReloadOutcome> {
  const run = opts.run
  const delay = opts.delay ?? realDelay
  const labelTimeoutMs = opts.labelTimeoutMs ?? 8000
  const attempts = opts.bootstrapAttempts ?? 3
  const target = `gui/${opts.uid}/${opts.label}`
  const errors: string[] = []

  const bootout = run(['bootout', target])
  if (bootout.ok === false && /could not find service/i.test(bootout.stderr) === false) {
    errors.push(`bootout: ${bootout.stderr}`)
  }

  let reloaded = false
  if (await waitForLabelFree(target, run, delay, labelTimeoutMs) === false) {
    errors.push(`label ${target} still held after ${labelTimeoutMs}ms`)
  } else {
    for (let attempt = 1; attempt <= attempts && reloaded === false; attempt++) {
      if (attempt > 1) await delay(300)
      const r = run(['bootstrap', `gui/${opts.uid}`, opts.plistPath])
      reloaded = r.ok
      if (r.ok === false) errors.push(`bootstrap (attempt ${attempt}/${attempts}): ${r.stderr}`)
    }
  }

  let restarted = false
  if (reloaded) {
    const k = run(['kickstart', target])
    restarted = k.ok
    if (k.ok === false) errors.push(`kickstart: ${k.stderr}`)
  }
  return { reloaded, restarted, errors }
}
