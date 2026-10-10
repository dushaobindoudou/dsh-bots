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

  it('first sync shares nothing: discovered skills wait for the user', () => {
    const { home, sandRoot } = fixture()
    const first = syncSkillsBridge(home, sandRoot, '0.0.0-test')
    expect(first).toMatchObject({ discovered: 3, bridged: 0, pending: 3, firstRun: true })
    expect(first.rows.map((r) => r.status)).toEqual(['pending', 'pending', 'pending'])
    expect(first.rows[0].sha256).toMatch(/^[0-9a-f]{64}$/)

    // An explicit decision shares the picked ids and declines the rest.
    const again = syncSkillsBridge(home, sandRoot, '0.0.0-test', { enabled: ['dsh-finance'] })
    expect(again).toMatchObject({ bridged: 1, pending: 0, firstRun: false })
    expect(again.rows.map((r) => [r.id, r.status])).toEqual([
      ['dsh-finance', 'shared'], ['dsh-internal', 'declined'], ['dsh-note', 'declined'],
    ])
    expect(readBridgeCache(join(sandRoot, 'plugin-skills', 'cache.json'))?.ids).toEqual(['dsh-finance'])

    // Vanished files are pruned on the next reconcile.
    rmSync(join(home, '.dsh', 'skills', 'finance'), { recursive: true, force: true })
    const reconciled = syncSkillsBridge(home, sandRoot, '0.0.0-test')
    expect(reconciled).toMatchObject({ discovered: 2, bridged: 0, firstRun: false })
  })

  it('newly installed skills stay pending until shared, and edits after sharing are flagged', () => {
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
    const after = syncSkillsBridge(home, sandRoot, 'test')
    expect(after.rows.find((r) => r.id === 'dsh-installed')?.status).toBe('pending')
    expect(readBridgeCache(join(sandRoot, 'plugin-skills', 'cache.json'))?.ids).toEqual(['dsh-finance'])

    // Editing a shared skill keeps it shared but surfaces the change until
    // the user re-confirms it.
    writeFileSync(join(home, '.dsh', 'skills', 'finance', 'SKILL.md'), '---\nname: finance\ndescription: 金融场景入口\n---\n\n改过的正文')
    const edited = syncSkillsBridge(home, sandRoot, 'test')
    expect(edited.rows.find((r) => r.id === 'dsh-finance')).toMatchObject({ status: 'shared', changed: true })
    const confirmed = syncSkillsBridge(home, sandRoot, 'test', { enabled: ['dsh-finance'] })
    expect(confirmed.rows.find((r) => r.id === 'dsh-finance')?.changed).toBe(false)
  })

  it('migrates v1 exclusions without unsharing anything', () => {
    const { home, sandRoot } = fixture()
    mkdirSync(sandRoot, { recursive: true })
    writeFileSync(join(sandRoot, 'dsh-bots-skill-bridge.json'), JSON.stringify({ version: 1, excluded: ['dsh-internal'] }))
    const result = syncSkillsBridge(home, sandRoot, 'test')
    expect(result.rows.map((r) => [r.id, r.status])).toEqual([
      ['dsh-finance', 'shared'], ['dsh-internal', 'declined'], ['dsh-note', 'shared'],
    ])
    expect(JSON.parse(readFileSync(join(sandRoot, 'dsh-bots-skill-bridge.json'), 'utf8')).version).toBe(2)
  })

  it('keeps the v1 exclusion field accurate so an older host shares nothing new', () => {
    // An older host reads only `excluded`; a v2 file without it read as
    // "nothing excluded" and that host shared every discovered skill.
    const { home, sandRoot } = fixture()
    syncSkillsBridge(home, sandRoot, 'test', { enabled: ['dsh-finance'] })
    const prefs = JSON.parse(readFileSync(join(sandRoot, 'dsh-bots-skill-bridge.json'), 'utf8'))
    expect(prefs.excluded).toEqual(['dsh-internal', 'dsh-note'])
    // Pending skills are mirrored as excluded too.
    mkdirSync(join(home, '.dsh', 'skills', 'fresh'), { recursive: true })
    writeFileSync(join(home, '.dsh', 'skills', 'fresh', 'SKILL.md'), '---\nname: fresh\ndescription: new\n---\nbody')
    syncSkillsBridge(home, sandRoot, 'test')
    expect(JSON.parse(readFileSync(join(sandRoot, 'dsh-bots-skill-bridge.json'), 'utf8')).excluded).toContain('dsh-fresh')
  })

  it('keeps a pre-prefs bridge exactly as the engine had it', () => {
    const { home, sandRoot } = fixture()
    const cachePath = join(sandRoot, 'plugin-skills', 'cache.json')
    mkdirSync(join(sandRoot, 'plugin-skills'), { recursive: true })
    writeFileSync(cachePath, JSON.stringify({ fetchedAt: 1, skills: [{ id: 'dsh-finance', pluginId: 'dsh-bots' }], currentUserId: null, authBlocked: [] }))
    const result = syncSkillsBridge(home, sandRoot, 'test')
    expect(readBridgeCache(cachePath)?.ids).toEqual(['dsh-finance'])
    expect(result.pending).toBe(2)
  })

  it('shares skills bundled with the plugin by default', () => {
    const { home, sandRoot } = fixture()
    const bundled = join(home, 'plugin-skills-root')
    mkdirSync(join(bundled, 'finance-kit'), { recursive: true })
    writeFileSync(join(bundled, 'finance-kit', 'SKILL.md'), '---\nname: finance-kit\ndescription: bundled\n---\nbody')
    const result = syncSkillsBridge(home, sandRoot, 'test', { additionalRoots: [bundled] })
    expect(result.rows.find((r) => r.id === 'dsh-finance-kit')).toMatchObject({ status: 'shared', bundled: true })
    expect(readBridgeCache(join(sandRoot, 'plugin-skills', 'cache.json'))?.ids).toEqual(['dsh-finance-kit'])
  })

  it('gives non-ASCII skill directories a stable path-derived id', () => {
    const { home } = fixture()
    mkdirSync(join(home, '.dsh', 'skills', '周报'), { recursive: true })
    writeFileSync(join(home, '.dsh', 'skills', '周报', 'SKILL.md'), '---\nname: 周报\ndescription: 写周报\n---\nbody')
    const before = discoverDshSkills(home).find((r) => r.name === '周报')?.id
    expect(before).toMatch(/^dsh-skill-[0-9a-f]{8}$/)
    mkdirSync(join(home, '.dsh', 'skills', '日报'), { recursive: true })
    writeFileSync(join(home, '.dsh', 'skills', '日报', 'SKILL.md'), '---\nname: 日报\ndescription: 写日报\n---\nbody')
    expect(discoverDshSkills(home).find((r) => r.name === '周报')?.id).toBe(before)
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
    syncSkillsBridge(home, sandRoot, '9.9.9', { enabled: ['dsh-finance'] })
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
    expect(syncSkillsBridge(home, sandRoot, '0.0.0-test')).toMatchObject({ bridged: 0, pending: 3, firstRun: true })
  })
})
