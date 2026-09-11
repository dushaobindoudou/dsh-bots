/**
 * Upgrade guard for the `sidebar.workspaces` shadow.
 *
 * Shadowing a `single` slot is supported by dsh ("register at a different
 * priority to shadow it (lowest renders)"), but the shadow owner inherits a
 * duty: it must re-render the entry it covers the way the shell would, prop
 * assembly included. That assembly lives in the shell, so it can drift.
 *
 * This test reads the INSTALLED renderer and fails when it assembles a prop
 * our delegation does not account for — turning a future dsh upgrade into a
 * red test instead of a region that silently renders nothing (which is exactly
 * how the directory-picker flow was lost when `renderSlot` was stubbed out).
 *
 * It skips cleanly on machines without a dsh profile, so CI stays green.
 */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DELEGATED_KIT_KEYS } from '../src/shared.js'

/**
 * Resolve the renderer/runner pair the RUNNING dsh web actually serves.
 *
 * The kit is assembled in TWO places: `dsh-client-ui-renderer` (layered
 * `kit["…"]`/root-literal props) and `dsh-cordis-client-runner` (the
 * `standardProps: ["name: Type", …]` manifest). Reading only the renderer —
 * or only the static legacy profile copy — missed the 2026-09-10 kit growth
 * (`usePanelInfo`), so the guard stayed green through a live crash. Prefer
 * the copy nested in the dsh CLI the `dsh` binary resolves to; fall back to
 * the legacy profile tree.
 */
function dshPackageRoots(): string[] {
  const roots: string[] = []
  try {
    const bin = execFileSync('sh', ['-c', 'command -v dsh'], { encoding: 'utf8' }).trim()
    if (bin !== '') {
      // …/bin/dsh -> realpath -> …/@deepseek-ai/dsh/<entry>; the package dir
      // nests its own node_modules with the client-ui packages.
      const real = realpathSync(bin)
      roots.push(join(dirname(dirname(real)), 'node_modules', '@deepseek-ai'))
    }
  } catch { /* no dsh on PATH */ }
  roots.push(join(homedir(), '.dsh', 'profiles', 'node_modules', '@deepseek-ai'))
  return roots.filter((root) => existsSync(root))
}

const PKG_ROOTS = dshPackageRoots()

function pkgFile(pkg: string, file: string[]): string | null {
  for (const root of PKG_ROOTS) {
    const p = join(root, pkg, ...file)
    if (existsSync(p)) return p
  }
  return null
}

const RENDERER = pkgFile('dsh-client-ui-renderer', ['lib', 'client.js'])
const RUNNER = pkgFile('dsh-cordis-client-runner', ['lib', 'client.js'])

/** Prop names the shell's renderer assigns onto a slot component's kit. */
function rendererKitKeys(source: string): string[] {
  const keys = new Set<string>()
  for (const m of source.matchAll(/(?:kit|standard)\["([A-Za-z][A-Za-z0-9]*)"\]\s*=/g)) keys.add(m[1])
  // Root-scope standard props are an object literal, not indexed assignment.
  const root = /root:\s*\{([^}]*)\}/.exec(source)
  if (root !== null) {
    for (const m of root[1].matchAll(/([A-Za-z][A-Za-z0-9]*)\s*:/g)) keys.add(m[1])
  }
  return [...keys].sort()
}

/** Standard-prop names declared by the runner's `standardProps` manifest. */
function runnerKitKeys(source: string): string[] {
  const keys = new Set<string>()
  const manifest = /standardProps:\s*\[(.*?)\]/s.exec(source)
  if (manifest !== null) {
    for (const m of manifest[1].matchAll(/"([A-Za-z][A-Za-z0-9]*):\s/g)) keys.add(m[1])
  }
  return [...keys].sort()
}

const available = RENDERER !== null
const describeIfInstalled = available ? describe : describe.skip

describe('delegation contract', () => {
  it('documents a disposition for every key it lists', () => {
    for (const [key, disposition] of Object.entries(DELEGATED_KIT_KEYS)) {
      expect(['synthesized', 'session-only', 'guarded'], `${key} disposition`).toContain(disposition)
    }
  })

  it('synthesizes the root-scope standard props', () => {
    // sidebar.workspaces is declared `{kind:"single", scope:"root"}`, so these
    // two are the whole standard kit; the session-only pair must NOT be faked.
    expect(DELEGATED_KIT_KEYS.useSessions).toBe('synthesized')
    expect(DELEGATED_KIT_KEYS.useWorkspaces).toBe('synthesized')
    expect(DELEGATED_KIT_KEYS.sessionId).toBe('session-only')
  })

  it('synthesizes renderSlot, the prop whose stub blanked the directory flow', () => {
    expect(DELEGATED_KIT_KEYS.renderSlot).toBe('synthesized')
  })
})

describeIfInstalled('delegation contract against the installed dsh renderer', () => {
  const source = RENDERER !== null ? readFileSync(RENDERER, 'utf8') : ''
  const runnerSource = RUNNER !== null ? readFileSync(RUNNER, 'utf8') : ''

  it('accounts for every prop the shell assembles', () => {
    const assembled = [...new Set([...rendererKitKeys(source), ...runnerKitKeys(runnerSource)])].sort()
    const missing = assembled.filter((k) => DELEGATED_KIT_KEYS[k] === undefined)
    expect(
      missing,
      `dsh's shell now assembles ${missing.join(', ')}; extend DELEGATED_KIT_KEYS in src/shared.ts `
      + 'and handle each one in synthesizeProps (src/client.ts) before shipping against this dsh.',
    ).toEqual([])
  })

  it('reads the renderer the running dsh serves, not a stale copy', () => {
    // The 09-10 blind spot: the legacy profile copy predates the CLI upgrade,
    // so the guard validated yesterday's kit. The workspace package this
    // resolution found must know `usePanelInfo` (first key of that growth).
    const workspace = pkgFile('dsh-client-ui-workspace', ['lib', 'client.js'])
    if (workspace === null) return
    expect(readFileSync(workspace, 'utf8')).toContain('usePanelInfo')
  })

  it('still keeps the shipped workspace browser behind a child slot', () => {
    // If the shipped browser ever stops declaring children, the recursive
    // renderSlot becomes dead weight and the delegation can be simplified.
    const browser = pkgFile('dsh-client-ui-workspace', ['lib', 'client.js'])
    if (browser === null) return
    const text = readFileSync(browser, 'utf8')
    expect(text).toContain('sidebar.workspaces.directoryFlow')
  })
})
