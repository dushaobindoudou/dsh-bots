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
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DELEGATED_KIT_KEYS } from '../src/shared.js'

const RENDERER = join(
  homedir(), '.dsh', 'profiles', 'node_modules',
  '@deepseek-ai', 'dsh-client-ui-renderer', 'lib', 'client.js',
)

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

const available = existsSync(RENDERER)
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
  const source = available ? readFileSync(RENDERER, 'utf8') : ''

  it('accounts for every prop the shell assembles', () => {
    const missing = rendererKitKeys(source).filter((k) => DELEGATED_KIT_KEYS[k] === undefined)
    expect(
      missing,
      `dsh's renderer now assembles ${missing.join(', ')}; extend DELEGATED_KIT_KEYS in src/shared.ts `
      + 'and handle each one in synthesizeProps (src/client.ts) before shipping against this dsh.',
    ).toEqual([])
  })

  it('still keeps the shipped workspace browser behind a child slot', () => {
    // If the shipped browser ever stops declaring children, the recursive
    // renderSlot becomes dead weight and the delegation can be simplified.
    const browser = join(
      homedir(), '.dsh', 'profiles', 'node_modules',
      '@deepseek-ai', 'dsh-client-ui-workspace', 'lib', 'client.js',
    )
    if (!existsSync(browser)) return
    const text = readFileSync(browser, 'utf8')
    expect(text).toContain('sidebar.workspaces.directoryFlow')
  })
})
