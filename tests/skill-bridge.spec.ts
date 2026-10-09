import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  discoverDshSkills, readBridgeCache, slugifySkillId, syncSkillsBridge,
} from '../src/skill-bridge.js'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function fixture(): { home: string; sandRoot: string } {
  const home = join(tmpdir(), 'dsh-bridge-home-' + Math.random().toString(36).slice(2))
  dirs.push(home)
  mkdirSync(join(home, '.dsh', 'skills', 'finance'), { recursive: true })
  writeFileSync(join(home, '.dsh', 'skills', 'finance', 'SKILL.md'), '---\nname: finance\ndescription: 金融场景入口\n---\n\n正文')
  mkdirSync(join(home, '.dsh', 'skills', 'internal'), { recursive: true })
  writeFileSync(join(home, '.dsh', 'skills', 'internal', 'SKILL.md'), '---\nname: internal\ndescription: harness 专属\ndisable-model-invocation: true\n---\n\nbot 调不了')
  mkdirSync(join(home, '.dsh', 'skills', 'empty-dir'), { recursive: true })
  mkdirSync(join(home, '.agents', 'skills'), { recursive: true })
  writeFileSync(join(home, '.agents', 'skills', 'note.md'), '---\nname: note\ndescription: 整理笔记\n---\n正文')
  writeFileSync(join(home, '.dsh', 'skills', '.system-x'), 'x')
  const sandRoot = join(home, 'sand')
  return { home, sandRoot }
}

describe('dsh skill bridge', () => {
  it('discovers bundles and flat files including skills requiring explicit user invocation', () => {
    const { home } = fixture()
    const refs = discoverDshSkills(home)
    expect(refs.map((r) => r.id)).toEqual(['dsh-finance', 'dsh-internal', 'dsh-note'])
    expect(refs[0]).toMatchObject({ name: 'finance', description: '金融场景入口' })
    expect(refs[0].filePath).toMatch(/SKILL\.md$/)
    expect(readFileSync(refs[1].filePath, 'utf8')).toContain('disable-model-invocation: true')
    expect(refs[2].filePath.endsWith('note.md')).toBe(true)
  })

  it('slugifies exotic names into the engine id grammar', () => {
    expect(slugifySkillId('周报 Weekly Report!')).toBe('weekly-report')
    expect(slugifySkillId('')).toBe('skill')
    expect('dsh-' + slugifySkillId('录音 师')).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  })

  it('first sync bridges everything; explicit sets and reconcile keep the user in charge', () => {
    const { home, sandRoot } = fixture()
    const first = syncSkillsBridge(home, sandRoot, '0.0.0-test')
    expect(first).toEqual({ discovered: 3, bridged: 3, firstRun: true })

    // Explicit exclusions stay excluded while new installations are shared.
    const again = syncSkillsBridge(home, sandRoot, '0.0.0-test', { enabled: ['dsh-finance'] })
    expect(again).toMatchObject({ bridged: 1, firstRun: false })
    expect(readBridgeCache(join(sandRoot, 'plugin-skills', 'cache.json'))?.ids).toEqual(['dsh-finance'])

    // Vanished files are pruned on the next reconcile.
    rmSync(join(home, '.dsh', 'skills', 'finance'), { recursive: true, force: true })
    const reconciled = syncSkillsBridge(home, sandRoot, '0.0.0-test')
    expect(reconciled).toMatchObject({ discovered: 2, bridged: 0, firstRun: false })
  })

  it('shares newly installed skills, follows symlink bundles and honors root precedence', () => {
    const { home, sandRoot } = fixture()
    syncSkillsBridge(home, sandRoot, 'test', { enabled: ['dsh-finance'] })
    const bundle = join(home, 'bundle')
    mkdirSync(bundle)
    writeFileSync(join(bundle, 'SKILL.md'), '---\nname: installed\ndescription: >-\n  read data\n  reliably\n---\nInstructions')
    symlinkSync(bundle, join(home, '.agents', 'skills', 'installed'))
    mkdirSync(join(home, '.codex', 'skills'), { recursive: true })
    writeFileSync(join(home, '.codex', 'skills', 'finance.md'), '---\nname: finance\ndescription: duplicate\n---\nwrong precedence')
    const refs = discoverDshSkills(home)
    expect(refs.filter(r => r.name === 'finance')).toHaveLength(1)
    expect(refs.find(r => r.name === 'installed')?.description).toBe('read data reliably')
    syncSkillsBridge(home, sandRoot, 'test')
    expect(readBridgeCache(join(sandRoot, 'plugin-skills', 'cache.json'))?.ids).toEqual(['dsh-finance', 'dsh-installed'])
  })

  it('does not migrate formerly undiscovered user-only skills as exclusions', () => {
    const { home, sandRoot } = fixture()
    const cachePath = join(sandRoot, 'plugin-skills', 'cache.json')
    mkdirSync(join(sandRoot, 'plugin-skills'), { recursive: true })
    writeFileSync(cachePath, JSON.stringify({ fetchedAt: 1, skills: [{ id: 'dsh-finance', pluginId: 'dsh-bots' }], currentUserId: null, authBlocked: [] }))
    syncSkillsBridge(home, sandRoot, 'test')
    expect(readBridgeCache(cachePath)?.ids).toEqual(['dsh-finance', 'dsh-internal'])
  })

  it('preserves skill records and authentication owned by other plugins', () => {
    const { home, sandRoot } = fixture()
    const cachePath = join(sandRoot, 'plugin-skills', 'cache.json')
    mkdirSync(join(sandRoot, 'plugin-skills'), { recursive: true })
    const foreign = { id: 'other-skill', pluginId: 'other', name: 'other', filePath: '/other/SKILL.md' }
    writeFileSync(cachePath, JSON.stringify({ fetchedAt: 1, currentUserId: 42, authBlocked: [{ pluginId: 'private' }], skills: [foreign] }))
    syncSkillsBridge(home, sandRoot, 'test')
    const cache = JSON.parse(readFileSync(cachePath, 'utf8'))
    expect(cache.skills).toContainEqual(foreign)
    expect(cache.currentUserId).toBe(42)
    expect(cache.authBlocked).toEqual([{ pluginId: 'private' }])
  })

  it('writes a cache the engine reader accepts (shape parity with plugin-skills-cache)', () => {
    const { home, sandRoot } = fixture()
    syncSkillsBridge(home, sandRoot, '9.9.9')
    const cachePath = join(sandRoot, 'plugin-skills', 'cache.json')
    expect(existsSync(cachePath)).toBe(true)
    expect(existsSync(cachePath + '.tmp')).toBe(false)
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as any
    expect(Number.isFinite(parsed.fetchedAt)).toBe(true)
    expect(parsed.currentUserId).toBeNull()
    expect(Array.isArray(parsed.authBlocked)).toBe(true)
    const row = parsed.skills[0]
    expect(row).toMatchObject({
      id: 'dsh-finance', pluginId: 'dsh-bots', pluginName: 'dsh-bots',
      name: 'finance', description: '金融场景入口', pluginVersion: '9.9.9',
    })
    // Live pointer: the engine reads THIS path, not a copy.
    expect(row.filePath.startsWith(join(home, '.dsh', 'skills'))).toBe(true)
    expect(existsSync(row.filePath)).toBe(true)
  })

  it('treats a corrupt cache as first run rather than dying', () => {
    const { home, sandRoot } = fixture()
    mkdirSync(join(sandRoot, 'plugin-skills'), { recursive: true })
    writeFileSync(join(sandRoot, 'plugin-skills', 'cache.json'), '{broken')
    expect(syncSkillsBridge(home, sandRoot, '0.0.0-test').bridged).toBe(3)
  })
})
