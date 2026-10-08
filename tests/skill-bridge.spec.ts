import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  it('discovers directory bundles and flat files, top level only, honoring dsh flags', () => {
    const { home } = fixture()
    const refs = discoverDshSkills(home)
    expect(refs.map((r) => r.id)).toEqual(['dsh-finance', 'dsh-note'])
    expect(refs[0]).toMatchObject({ name: 'finance', description: '金融场景入口' })
    expect(refs[0].filePath).toMatch(/SKILL\.md$/)
    expect(refs[1].filePath.endsWith('note.md')).toBe(true)
  })

  it('slugifies exotic names into the engine id grammar', () => {
    expect(slugifySkillId('周报 Weekly Report!')).toBe('weekly-report')
    expect(slugifySkillId('')).toBe('skill')
    expect('dsh-' + slugifySkillId('录音 师')).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  })

  it('first sync bridges everything; explicit sets and reconcile keep the user in charge', () => {
    const { home, sandRoot } = fixture()
    const first = syncSkillsBridge(home, sandRoot, '0.0.0-test')
    expect(first).toEqual({ discovered: 2, bridged: 2, firstRun: true })

    // Trim to one; a newly discovered skill must NOT creep back.
    const again = syncSkillsBridge(home, sandRoot, '0.0.0-test', { enabled: ['dsh-finance'] })
    expect(again).toMatchObject({ bridged: 1, firstRun: false })
    expect(readBridgeCache(join(sandRoot, 'plugin-skills', 'cache.json'))?.ids).toEqual(['dsh-finance'])

    // Vanished files are pruned on the next reconcile.
    rmSync(join(home, '.dsh', 'skills', 'finance'), { recursive: true, force: true })
    const reconciled = syncSkillsBridge(home, sandRoot, '0.0.0-test')
    expect(reconciled).toMatchObject({ discovered: 1, bridged: 0, firstRun: false })
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
    expect(syncSkillsBridge(home, sandRoot, '0.0.0-test').bridged).toBe(2)
  })
})
