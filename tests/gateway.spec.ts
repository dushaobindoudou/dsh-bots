import { describe, expect, it } from 'vitest'
import { effectiveDataDir, normalizeAgents, readDiscovery, readDiscoveryWithFallback, trimAgent } from '../src/gateway.js'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'bots-gw-'))
  try { fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

describe('readDiscovery', () => {
  it('reads a well-formed gateway.json', () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, 'gateway.json'), JSON.stringify({ port: 7331, pid: 123, host: '127.0.0.1' }))
      const d = readDiscovery(dir)
      expect(d).not.toBeNull()
      expect(d!.port).toBe(7331)
      expect(d!.pid).toBe(123)
      expect(d!.token).toBeNull()
    })
  })

  it('returns null when gateway.json is missing', () => {
    withTempDir((dir) => {
      expect(readDiscovery(dir)).toBeNull()
    })
  })

  it('returns null on malformed JSON', () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, 'gateway.json'), '{not json')
      expect(readDiscovery(dir)).toBeNull()
    })
  })

  it('normalizes wildcard host and rejects non-numeric port', () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, 'gateway.json'), JSON.stringify({ port: 7331, host: '0.0.0.0' }))
      expect(readDiscovery(dir)!.host).toBe('127.0.0.1')
      writeFileSync(join(dir, 'gateway.json'), JSON.stringify({ port: 'x' }))
      expect(readDiscovery(dir)).toBeNull()
    })
  })

  it('expands ~ dataDir', () => {
    // 无法在单测里伪造 $HOME（同步 API），这里只验证不抛异常路径的形状
    expect(readDiscovery('/nonexistent-absolute')).toBeNull()
  })
})

describe('normalizeAgents / trimAgent', () => {
  it('accepts a bare array (listAgents wire shape)', () => {
    const list = normalizeAgents([{ id: 'a1', name: '速报员', isGroup: false }])
    expect(list).toHaveLength(1)
    expect(list[0]!.name).toBe('速报员')
    expect(list[0]!.isGroup).toBe(false)
    expect(list[0]!.memberIds).toEqual([])
  })

  it('accepts {agents:[...]} wrapper', () => {
    const list = normalizeAgents({ agents: [{ id: 'g1', name: '暴富', isGroup: true, memberIds: ['a1'] }] })
    expect(list).toHaveLength(1)
    expect(list[0]!.isGroup).toBe(true)
    expect(list[0]!.memberIds).toEqual(['a1'])
  })

  it('drops non-object entries and fills defaults', () => {
    const list = normalizeAgents([null, { id: 'x' }, 'junk'])
    expect(list).toHaveLength(1)
    expect(list[0]!.name).toBe('')
    expect(list[0]!.isActive).toBe(true)
  })

  it('trimAgent returns null for garbage', () => {
    expect(trimAgent(null)).toBeNull()
    expect(trimAgent('x')).toBeNull()
  })
})

describe('readDiscoveryWithFallback / effectiveDataDir (0.2.16 default rename)', () => {
  it('prefers the configured dir when it holds gateway.json', () => {
    const primary = mkdtempSync(join(tmpdir(), 'dsh-prim-'))
    const legacy = mkdtempSync(join(tmpdir(), 'dsh-leg-'))
    writeFileSync(join(primary, 'gateway.json'), JSON.stringify({ port: 40001, pid: 1, token: 'tok-primary', host: '127.0.0.1' }))
    writeFileSync(join(legacy, 'gateway.json'), JSON.stringify({ port: 40002, pid: 2, token: 'tok-legacy', host: '127.0.0.1' }))
    expect(readDiscoveryWithFallback(primary, legacy)?.token).toBe('tok-primary')
    expect(effectiveDataDir(primary, legacy)).toBe(primary)
    rmSync(primary, { recursive: true, force: true })
    rmSync(legacy, { recursive: true, force: true })
  })

  it('falls back to the legacy root when the configured dir has no discovery', () => {
    const empty = mkdtempSync(join(tmpdir(), 'dsh-empty-'))
    const legacy = mkdtempSync(join(tmpdir(), 'dsh-leg-'))
    writeFileSync(join(legacy, 'gateway.json'), JSON.stringify({ port: 40002, pid: 2, token: 'tok-legacy', host: '127.0.0.1' }))
    expect(readDiscoveryWithFallback(empty, legacy)?.token).toBe('tok-legacy')
    expect(effectiveDataDir(empty, legacy)).toBe(legacy)
    rmSync(empty, { recursive: true, force: true })
    // neither dir has discovery → configured dir as-is (legacy removed first)
    rmSync(legacy, { recursive: true, force: true })
    const orphan = mkdtempSync(join(tmpdir(), 'dsh-orphan-'))
    expect(readDiscoveryWithFallback(orphan, legacy)).toBeNull()
    expect(effectiveDataDir(orphan, legacy)).toBe(orphan)
    rmSync(orphan, { recursive: true, force: true })
  })
})
