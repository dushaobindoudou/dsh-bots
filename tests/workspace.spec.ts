import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listAgentWorkspaces, readAgentWorkspace, setAgentWorkspace, validateVirtualRoot } from '../src/workspace.js'

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'bots-jail-'))
  try { fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

function seedAgent(dir: string, id: string, settings: Record<string, unknown> | null): void {
  const agentDir = join(dir, 'agents', id)
  mkdirSync(agentDir, { recursive: true })
  if (settings !== null) writeFileSync(join(agentDir, 'settings.json'), JSON.stringify(settings))
}

describe('readAgentWorkspace', () => {
  it('reads workspaceRoot and allowPaths from settings.json', () => {
    withTempDir((dir) => {
      seedAgent(dir, 'a1', { notifyOnAgentUpdates: true, workspaceRoot: '/workspace/录音师', workspaceAllowPaths: ['/abs/shared'] })
      const cfg = readAgentWorkspace(dir, 'a1')
      expect(cfg).not.toBeNull()
      expect(cfg!.workspaceRoot).toBe('/workspace/录音师')
      expect(cfg!.allowPaths).toEqual(['/abs/shared'])
    })
  })

  it('returns unjailed config when settings.json lacks workspaceRoot', () => {
    withTempDir((dir) => {
      seedAgent(dir, 'a1', { notifyOnAgentUpdates: true })
      const cfg = readAgentWorkspace(dir, 'a1')
      expect(cfg).toEqual({ agentId: 'a1', workspaceRoot: null, allowPaths: [] })
    })
  })

  it('returns null for malformed ids and unknown agents', () => {
    withTempDir((dir) => {
      seedAgent(dir, 'a1', { workspaceRoot: '/workspace/x' })
      expect(readAgentWorkspace(dir, '../escape')).toBeNull()
      expect(readAgentWorkspace(dir, 'does/not/exist')).toBeNull()
      expect(readAgentWorkspace(dir, 'ghost')).toBeNull()
    })
  })

  it('mirrors the engine live-production config shape (录音师 precedent)', () => {
    withTempDir((dir) => {
      seedAgent(dir, 'b1', { workspaceRoot: '/workspace/录音师', workspaceAllowPaths: ['/Users/x/.sdk-bots/box-workspace/剧组共享'] })
      expect(readAgentWorkspace(dir, 'b1')!.workspaceRoot).toBe('/workspace/录音师')
    })
  })
})

describe('listAgentWorkspaces', () => {
  it('lists every agent dir; missing settings.json counts as unjailed', () => {
    withTempDir((dir) => {
      seedAgent(dir, 'a2', { workspaceRoot: '/workspace/速报员' })
      seedAgent(dir, 'a1', null)
      const list = listAgentWorkspaces(dir)
      expect(list).toHaveLength(2)
      expect(list[0]!.agentId).toBe('a1')
      expect(list[0]!.workspaceRoot).toBeNull()
      expect(list[1]!.workspaceRoot).toBe('/workspace/速报员')
    })
  })

  it('returns [] when the agents dir is absent', () => {
    withTempDir((dir) => {
      expect(listAgentWorkspaces(dir)).toEqual([])
    })
  })
})

describe('setAgentWorkspace', () => {
  it('jails an agent with a valid virtual root and preserves other keys', () => {
    withTempDir((dir) => {
      seedAgent(dir, 'a1', { notifyOnAgentUpdates: true, theme: 'dark' })
      const cfg = setAgentWorkspace(dir, 'a1', { workspaceRoot: '/workspace/画师', allowPaths: ['/abs/a'] })
      expect(cfg.workspaceRoot).toBe('/workspace/画师')
      const raw = JSON.parse(readFileSync(join(dir, 'agents', 'a1', 'settings.json'), 'utf8'))
      expect(raw.notifyOnAgentUpdates).toBe(true)
      expect(raw.theme).toBe('dark')
      expect(raw.workspaceRoot).toBe('/workspace/画师')
      expect(raw.workspaceAllowPaths).toEqual(['/abs/a'])
    })
  })

  it('removes the jail with null without touching allowPaths', () => {
    withTempDir((dir) => {
      seedAgent(dir, 'a1', { workspaceRoot: '/workspace/x', workspaceAllowPaths: ['/abs/a'] })
      const cfg = setAgentWorkspace(dir, 'a1', { workspaceRoot: null })
      expect(cfg.workspaceRoot).toBeNull()
      expect(cfg.allowPaths).toEqual(['/abs/a'])
      const raw = JSON.parse(readFileSync(join(dir, 'agents', 'a1', 'settings.json'), 'utf8'))
      expect(raw.workspaceRoot).toBeUndefined()
    })
  })

  it('creates the agent dir/settings.json for a brand-new bot', () => {
    withTempDir((dir) => {
      const cfg = setAgentWorkspace(dir, 'new-bot_1', { workspaceRoot: '/workspace/NewBot' })
      expect(cfg.workspaceRoot).toBe('/workspace/NewBot')
      expect(existsSync(join(dir, 'agents', 'new-bot_1', 'settings.json'))).toBe(true)
    })
  })

  it('rejects malformed ids, slugs and allowPaths (fail-closed mirror)', () => {
    withTempDir((dir) => {
      expect(() => setAgentWorkspace(dir, '../bad', { workspaceRoot: '/workspace/x' })).toThrow()
      expect(() => setAgentWorkspace(dir, 'a1', { workspaceRoot: '/etc/passwd' })).toThrow()
      expect(() => setAgentWorkspace(dir, 'a1', { workspaceRoot: '/workspace/../escape' })).toThrow()
      expect(() => setAgentWorkspace(dir, 'a1', { workspaceRoot: '/workspace/a/b' })).toThrow()
      expect(() => setAgentWorkspace(dir, 'a1', { workspaceRoot: '/workspace/' })).toThrow()
      expect(() => setAgentWorkspace(dir, 'a1', { allowPaths: 42 as unknown as string[] })).toThrow()
    })
  })
})

describe('validateVirtualRoot', () => {
  it('accepts unicode-letter slugs like the engine SLUG_PATTERN', () => {
    expect(validateVirtualRoot('/workspace/录音师')).toBe('/workspace/录音师')
    expect(validateVirtualRoot('/workspace/aB1._-')).toBe('/workspace/aB1._-')
  })

  it('rejects traversal, nested paths, empty and leading-separator slugs', () => {
    expect(() => validateVirtualRoot('/workspace')).toThrow()
    expect(() => validateVirtualRoot('/workspace/')).toThrow()
    expect(() => validateVirtualRoot('/workspace/a/b')).toThrow()
    expect(() => validateVirtualRoot('/workspace/..')).toThrow()
    expect(() => validateVirtualRoot('/workspace/.hidden')).toThrow()
    expect(() => validateVirtualRoot('relative')).toThrow()
  })
})
