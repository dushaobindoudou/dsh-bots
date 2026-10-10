/**
 * File preview host contract: bot-written paths resolve the way bots write
 * them (workspace-relative, `/workspace/<slug>` virtual, absolute), reads
 * stay inside the bots' data roots, and nothing ever hands a bot-written
 * file to the OS opener (that would execute `.command`/`.app` output).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { BotsRemote } from '../src/index.js'

const HOST = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.ts'), 'utf8')
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function host(): { remote: any; data: string } {
  const data = join(tmpdir(), 'dsh-preview-' + Math.random().toString(36).slice(2))
  dirs.push(data)
  mkdirSync(join(data, 'box-workspace', 'AI股票交易台', 'risk'), { recursive: true })
  // gateway.json makes the configured dir the effective one.
  writeFileSync(join(data, 'gateway.json'), JSON.stringify({ port: 1, pid: null }))
  // The preview methods only touch `cfg`; skip the Remote service wiring.
  const remote = Object.create(BotsRemote.prototype)
  remote.cfg = { dataDir: data }
  return { remote, data }
}

describe('file preview host', () => {
  it('resolves workspace-relative paths into the bot workspace that has them', async () => {
    const { remote, data } = host()
    const file = join(data, 'box-workspace', 'AI股票交易台', 'risk', 'opinion.md')
    writeFileSync(file, '# 风险意见\n')
    const page = await remote.readText({ path: 'risk/opinion.md' })
    expect(page.path.endsWith(join('AI股票交易台', 'risk', 'opinion.md'))).toBe(true)
    expect(page).toMatchObject({ text: '# 风险意见\n', eof: true, offset: 0 })
  })

  it('prefers the most recently written match when several workspaces have the path', async () => {
    const { remote, data } = host()
    mkdirSync(join(data, 'box-workspace', 'old', 'risk'), { recursive: true })
    const older = join(data, 'box-workspace', 'old', 'risk', 'opinion.md')
    writeFileSync(older, 'old')
    utimesSync(older, new Date(2000, 0, 1), new Date(2000, 0, 1))
    writeFileSync(join(data, 'box-workspace', 'AI股票交易台', 'risk', 'opinion.md'), 'new')
    expect((await remote.readText({ path: './risk/opinion.md' })).text).toBe('new')
  })

  it('maps the /workspace/<slug> virtual root the bots see', async () => {
    const { remote, data } = host()
    writeFileSync(join(data, 'box-workspace', 'AI股票交易台', 'PLAN.md'), 'plan')
    expect((await remote.readText({ path: '/workspace/AI股票交易台/PLAN.md' })).text).toBe('plan')
  })

  it('refuses paths outside the bots data roots, including traversal', async () => {
    const { remote } = host()
    await expect(remote.readText({ path: '/etc/hosts' })).rejects.toThrow(/outside the bots data dir/)
    await expect(remote.readText({ path: '../../../../etc/hosts' })).rejects.toThrow(/outside the bots data dir/)
    await expect(remote.readText({ path: '/workspace/../../etc/hosts' })).rejects.toThrow()
  })

  it('pages text on character boundaries and flags binaries', async () => {
    const { remote, data } = host()
    // 3-byte glyphs straddling the 256KB page edge must never split.
    const big = join(data, 'box-workspace', 'big.txt')
    writeFileSync(big, 'a' + '汉'.repeat(100_000))
    const first = await remote.readText({ path: big })
    expect(first.eof).toBe(false)
    const second = await remote.readText({ path: big, offset: first.nextOffset })
    expect(first.text + second.text).toBe('a' + '汉'.repeat(100_000))
    expect(first.text.includes('�') || second.text.includes('�')).toBe(false)
    const bin = join(data, 'box-workspace', 'blob.bin')
    writeFileSync(bin, Buffer.from([0x50, 0x4b, 0x00, 0x01]))
    await expect(remote.readText({ path: bin })).rejects.toThrow(/not-text/)
  })

  it('serves preview bytes only for renderable types', async () => {
    const { remote, data } = host()
    const pdf = join(data, 'box-workspace', 'r.pdf')
    writeFileSync(pdf, '%PDF-1.4')
    expect(await remote.readBytes({ path: pdf })).toMatchObject({ mime: 'application/pdf', sizeBytes: 8 })
    const app = join(data, 'box-workspace', 'run.command')
    writeFileSync(app, '#!/bin/sh\n')
    await expect(remote.readBytes({ path: app })).rejects.toThrow(/unsupported-preview/)
  })

  it('never passes a bot-written file to the OS opener', () => {
    // revealFile shows the location (`open -R` / the parent directory);
    // the old openFile ran `open <file>`, which executes .command/.app.
    expect(HOST).not.toContain("'openFile'")
    expect(HOST).toContain("spawn('open', ['-R', resolved]")
    expect(HOST).toContain("spawn('xdg-open', [dirname(resolved)]")
  })
})
