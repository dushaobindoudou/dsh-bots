/**
 * Document preview routing. The browser suite drives the full flow against
 * a simulated shell; these guard the contract pieces: bare file paths become
 * the native renderer's own file-mention chips, and a click opens the file in
 * a pane docked beside the bot conversation — never by switching the screen
 * to a borrowed dsh Session (user report: previewing a bot's .md jumped to an
 * ordinary conversation).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = readFileSync(join(ROOT, 'src', 'client.ts'), 'utf8')
const HOST = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8')

/** Evaluate the client's linkifier with the client's own path regexes. */
function linkifier(): (text: string) => string {
  const constant = (name: string): RegExp => {
    const m = new RegExp(`const ${name} = (\\/.+\\/[a-z]*)\\n`).exec(CLIENT)
    expect(m, name).not.toBeNull()
    const literal = m![1]
    const at = literal.lastIndexOf('/')
    return new RegExp(literal.slice(1, at), literal.slice(at + 1))
  }
  const start = CLIENT.indexOf('      function linkifyFilePaths(text: string): string {')
  const end = CLIENT.indexOf('\n      }\n', start) + '\n      }\n'.length
  const body = CLIENT.slice(start, end).replace(/: string/g, '').replace(/: number/g, '')
  // eslint-disable-next-line no-new-func
  return new Function('MEDIA_PATH_RE', 'MEDIA_IMG_RE', 'MEDIA_FILE_RE', body + '\nreturn linkifyFilePaths')(
    constant('MEDIA_PATH_RE'), constant('MEDIA_IMG_RE'), constant('MEDIA_FILE_RE'),
  )
}

describe('bare paths become native file mentions', () => {
  const linkify = linkifier()
  it('wraps a bare path so the native renderer chips it', () => {
    expect(linkify('风控放行：见 risk/09999_risk_opinion_20261009.md（有条件放行）。'))
      .toBe('风控放行：见 `risk/09999_risk_opinion_20261009.md`（有条件放行）。')
  })
  it('leaves code, links, URLs and images alone', () => {
    expect(linkify('已有 `risk/a.md` 不动')).toBe('已有 `risk/a.md` 不动')
    expect(linkify('```\ncat risk/a.md\n```\n后面 macro/b.md')).toBe('```\ncat risk/a.md\n```\n后面 `macro/b.md`')
    expect(linkify('[报告](risk/c.md) 与 https://x.com/a/b.md')).toBe('[报告](risk/c.md) 与 https://x.com/a/b.md')
    expect(linkify('图 out/shot.png 不包')).toBe('图 out/shot.png 不包')
  })
  it('feeds the native renderer the linkified text', () => {
    expect(CLIENT).toContain('text: linkifyFilePaths(String(p.text ?? \'\')),')
    expect(CLIENT).toContain("open: () => { openFilePreview(path) }")
  })
})

describe('document preview stays in the bot conversation', () => {
  it('never borrows a dsh Session or the shell right sidebar', () => {
    expect(CLIENT).not.toContain("shellService('sidebarRight')")
    expect(CLIENT).not.toContain('dsh-resource://file/session/')
    expect(CLIENT).not.toContain('openSession(')
    expect(CLIENT).not.toContain('selectPanel(null)')
  })

  it('docks the preview beside the chat in the workbench row', () => {
    expect(CLIENT).toContain("patch({ previewPath: path, previewExpanded: false })")
    expect(CLIENT).toMatch(/e\('div', \{ className: 'dbs-workbench' \},\n\s*e\(ChatView, /)
    expect(CLIENT).toMatch(/\.dbs-previewPane\{[^}]*flex:0 0 clamp\(360px,46%,760px\)/)
    // The native right-sidebar document preview's header geometry.
    expect(CLIENT).toMatch(/\.dbs-previewPane \.dbs-previewHead\{height:38px;[^}]*padding:0 6px 0 16px/)
    // Narrow columns (and the expand toggle) cover the chat instead.
    expect(CLIENT).toContain('@container dbs-workbench (max-width:820px){.dbs-previewPane{position:absolute;inset:0;border-left:0}}')
  })

  it('belongs to the conversation that mentioned the file', () => {
    expect(CLIENT).toContain('const leaving = state.chatAgentId !== id ? { previewPath: null, previewExpanded: false } : {}')
  })

  it('resolves bot paths on the host through the preview allowlist', () => {
    expect(HOST).toContain('async resolvePath(request: { path?: string } | null): Promise<{ path: string; isFile: boolean }>')
    expect(HOST).toContain("'readImage', 'readText', 'readBytes', 'resolvePath', 'revealFile'")
  })
})
