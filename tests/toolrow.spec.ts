/**
 * Content-area guards: tool rows, thinking rows and durations rebuilt on the
 * native ToolRow/ReasoningRow anatomy (one-line disclosure, variant glyph,
 * sweep-while-running, ioCard body, native duration labels).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = readFileSync(join(ROOT, 'src', 'client.ts'), 'utf8')
const GATEWAY = readFileSync(join(ROOT, 'src', 'gateway.ts'), 'utf8')

describe('tool row anatomy', () => {
  it('maps tool families onto the shipped variant glyphs', () => {
    // Same table as the native VARIANT_ICONS: bash → terminal-ish api glyph,
    // read → browse, write/edit → edit, search → search, rest → sparkle.
    expect(CLIENT).toMatch(/variant: 'bash', re: \/\^\(Shell\|Bash.*\/i, icon: 'IconApiOutline14'/)
    expect(CLIENT).toMatch(/variant: 'read'.*icon: 'IconBrowseOutline16'/)
    expect(CLIENT).toMatch(/variant: 'write'.*icon: 'IconEditOutline16'/)
    expect(CLIENT).toMatch(/variant: 'search'.*icon: 'IconSearchOutline16'/)
    expect(CLIENT).toMatch(/return \{ variant: 'others', icon: 'IconSparkle16' \}/)
  })

  it('uses the native row skeleton: glyph · name · dot · summary · duration · chevron', () => {
    expect(CLIENT).toContain("className: 'dbs-toolRowLine'")
    expect(CLIENT).toContain("className: 'dbs-toolSep'")
    expect(CLIENT).toContain("className: 'dbs-toolSummary'")
    expect(CLIENT).toContain("className: 'dbs-toolDuration'")
    expect(CLIENT).toContain("className: 'dbs-toolChevron'")
  })

  it('sweeps the row while running, and honours reduced motion', () => {
    expect(CLIENT).toMatch(/'data-state': running \? 'running' : failed \? 'error' : 'ok'/)
    expect(CLIENT).toContain('animation:2.6s ease-out infinite dbs-row-sweep')
    expect(CLIENT).toContain('@media (prefers-reduced-motion:reduce)')
  })

  it('expands into an ioCard-style body, not a bare pre block', () => {
    expect(CLIENT).toMatch(/\.dbs-toolBody\{margin:4px 0 4px 22px;.*border-radius:12px/)
    expect(CLIENT).toMatch(/max-height:260px;overflow-y:auto/)
  })
})

describe('duration labels', () => {
  it('formats like the native formatDurationMs', () => {
    expect(CLIENT).toMatch(/ms < 1e3\) return `\$\{Math\.round\(ms\)\}ms`/)
    expect(CLIENT).toMatch(/toFixed\(ms < 1e4 \? 2 : 1\)/)
  })
})

describe('tool run merging', () => {
  it('pairs each call with its result into one row carrying the duration', () => {
    expect(CLIENT).toContain('function mergeToolRuns')
    expect(CLIENT).toMatch(/toolOutput: String\(en\.content \?\? ''\)/)
    expect(CLIENT).toMatch(/Math\.max\(0, en\.timestampMs - call\.timestampMs\)/)
  })

  it('drops raw SendMessage calls the gateway already shows as messages', () => {
    expect(CLIENT).toMatch(/en\.toolName === 'SendMessage' \|\| en\.toolName === 'send_message'\) continue/)
  })

  it('renders never-settled calls as running rows', () => {
    expect(CLIENT).toContain('// Calls that never settled still render, as running rows.')
  })
})

describe('thinking row', () => {
  it('follows the native ReasoningRow: think glyph, tail-follow summary, expandable body', () => {
    expect(CLIENT).toContain("Ico('IconThinkOutline14', { size: 14 })")
    expect(CLIENT).toContain("'data-follow-end': running || undefined")
    expect(CLIENT).toContain('const summary = running ? (lines[lines.length - 1] ?? \'\') : (lines[0] ?? \'\')')
    expect(CLIENT).toContain("className: 'dbs-thinkBody'")
  })
})

describe('summary projection', () => {
  it('carries the engine-derived tool summary to the row', () => {
    expect(GATEWAY).toMatch(/typeof en\?\.summary === 'string' && en\.summary\.trim\(\) !== '' \? en\.summary : null/)
  })
})
