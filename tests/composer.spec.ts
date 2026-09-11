/**
 * Chat-surface guards.
 *
 * The client half is an IIFE the shell's module loader owns, so it cannot be
 * imported here — these read the source, the same way `locale.spec.ts` does.
 * They pin the handful of composer behaviours that are invisible until a real
 * person hits them: an IME candidate window committing a half-typed Chinese
 * word as a sent message, a growing draft trapped in a one-line peephole, and
 * Escape dismissing the mention menu *and* the whole conversation at once.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'client.ts'),
  'utf8',
)

describe('composer', () => {
  it('never runs the Enter binding while an IME is composing', () => {
    expect(SOURCE).toContain('onCompositionStart')
    expect(SOURCE).toContain('onCompositionEnd')
    // Both signals: `isComposing` where it exists, keyCode 229 where it does not.
    expect(SOURCE).toMatch(/ev\.nativeEvent\?\.isComposing === true/)
    expect(SOURCE).toMatch(/ev\.keyCode === 229/)
    // The guard is stronger than the bare boolean: the post-composition
    // 10ms window (Safari fires compositionend *after* the commit Enter) and
    // held-Enter auto-repeat must also never reach the send binding.
    expect(SOURCE).toMatch(/imeRef\.current\.active/)
    expect(SOURCE).toMatch(/imeRef\.current\.until/)
    expect(SOURCE).toMatch(/ev\.repeat === true/)
    // …and the guard has to precede the send binding, not follow it.
    const guard = SOURCE.indexOf('ev.keyCode === 229')
    const send = SOURCE.indexOf("ev.key === 'Enter' && !ev.shiftKey")
    expect(guard).toBeGreaterThan(-1)
    expect(send).toBeGreaterThan(guard)
  })

  it('keeps Enter to send and Shift+Enter to break the line', () => {
    expect(SOURCE).toContain("if (ev.key === 'Enter' && !ev.shiftKey) {")
    expect(SOURCE).toContain('void doSend()')
  })

  it('restores the unsent draft when a chat is reopened and clears it on send', () => {
    expect(SOURCE).toContain("setInput(draftMemory.get(p.agentId) ?? '')")
    expect(SOURCE).toContain('draftMemory.set(p.agentId, value)')
    expect(SOURCE).toContain('draftMemory.delete(p.agentId)')
  })

  it('grows the textarea with its content instead of scrolling it', () => {
    expect(SOURCE).toMatch(/el\.style\.height = 'auto'/)
    expect(SOURCE).toMatch(/el\.style\.height = String\(el\.scrollHeight\)/)
  })

  it('keeps the mention Escape out of the overlay-closing handler', () => {
    expect(SOURCE).toMatch(/ev\.preventDefault\(\); ev\.stopPropagation\(\); setMention\(null\)/)
  })
})

describe('message clocks', () => {
  it('formats from the plugin dictionary, not the browser locale', () => {
    for (const key of ['time.today', 'time.yesterday', 'time.date', 'time.dateFull']) {
      expect(SOURCE, `${key} must be rendered through t()`).toContain(`t('${key}'`)
    }
  })

  it('suppresses the clock on a streaming tail', () => {
    expect(SOURCE).toContain("if (ms === null || p.entry.isStreaming === true) return null")
  })

  it('carries the clock inside the hover action row, like the native row', () => {
    // The shipped MessageIconActions carries the clock and the actions in one
    // hover-revealed row; the only always-visible clock left is the image
    // attachment bubble (no text to copy, so no action row of its own).
    expect(SOURCE).toContain('e(MessageActions, { entry: en })')
    expect(SOURCE).toMatch(/className: 'dbs-actionTime' \}, e\(MsgTime, \{ entry: p\.entry \}\)/)
    expect(SOURCE).toMatch(/\.dbs-actions\{[^}]*opacity:0;transition:opacity 80ms/)
    expect(SOURCE).toMatch(/\.dbs-botRow:hover \.dbs-actions/)
    expect(SOURCE.match(/e\(MsgTime, \{ entry: en \}\)/g)?.length).toBe(1)
  })
})
