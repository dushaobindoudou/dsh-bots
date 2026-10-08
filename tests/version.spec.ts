import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { satisfiesCaret } from '../src/version.js'

describe('satisfiesCaret', () => {
  it('matches the documented behavior of ^0.1.0-rc.6', () => {
    expect(satisfiesCaret('0.1.0-rc.3', '^0.1.0-rc.6')).toBe(false)
    expect(satisfiesCaret('0.1.0-rc.5', '^0.1.0-rc.6')).toBe(false)
    expect(satisfiesCaret('0.1.0-rc.6', '^0.1.0-rc.6')).toBe(true)
    expect(satisfiesCaret('0.1.0-rc.7', '^0.1.0-rc.6')).toBe(true)
    expect(satisfiesCaret('0.1.0-rc.10', '^0.1.0-rc.6')).toBe(true)
    expect(satisfiesCaret('0.1.0', '^0.1.0-rc.6')).toBe(true)
    expect(satisfiesCaret('0.0.1-rc.1', '^0.1.0-rc.6')).toBe(false)
    expect(satisfiesCaret('0.2.0', '^0.1.0-rc.6')).toBe(false)
    expect(satisfiesCaret('1.0.0', '^0.1.0-rc.6')).toBe(false)
  })

  it('handles stable caret ranges', () => {
    expect(satisfiesCaret('0.1.0', '^0.1.0')).toBe(true)
    expect(satisfiesCaret('0.1.5', '^0.1.0')).toBe(true)
    expect(satisfiesCaret('0.2.0', '^0.1.0')).toBe(false)
    expect(satisfiesCaret('0.1.0-rc.1', '^0.1.0')).toBe(false)
    expect(satisfiesCaret('1.9.9', '^1.2.3')).toBe(true)
    expect(satisfiesCaret('2.0.0', '^1.2.3')).toBe(false)
  })

  it('rejects malformed input', () => {
    expect(satisfiesCaret('not-a-version', '^0.1.0-rc.6')).toBe(false)
    expect(satisfiesCaret('0.1.0', '0.1.0-rc.6')).toBe(false)
    expect(satisfiesCaret('0.1.0', '~0.1.0')).toBe(false)
  })
})

describe('diag version observability (F12)', () => {
  // The diag line is the only forensic record when the shadow takeover
  // misbehaves; a version stamped "unresolved" (require.resolve cannot see
  // the plugin's own name inside the installed layout) makes every record
  // from that day unattributable. The plugin version must therefore come
  // from a manifest walk that names the plugin, and the peer probe keeps
  // its own resolution path with honest sentinels.
  const INDEX = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.ts'), 'utf8')

  it('stamps PLUGIN_VERSION from ownModuleVersion, not the peer resolver', () => {
    expect(INDEX).toContain('const PLUGIN_VERSION = ownModuleVersion()')
    expect(INDEX).not.toContain("resolvedModuleVersion('dsh-bots')")
  })

  it('resolves the version by climbing to the manifest that names the plugin', () => {
    expect(INDEX).toContain("pkg.name === 'dsh-bots'")
    expect(INDEX).toMatch(/for \(let depth = 0; depth < 4/)
    expect(INDEX).toContain("return 'unresolved'")
  })
})
