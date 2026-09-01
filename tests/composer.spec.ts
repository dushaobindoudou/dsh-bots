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
    expect(SOURCE).toMatch(/imeRef\.current \|\| ev\.nativeEvent\?\.isComposing === true \|\| ev\.keyCode === 229/)
    // …and the guard has to precede the send binding, not follow it.
    const guard = SOURCE.indexOf('ev.keyCode === 229')
    const send = SOURCE.indexOf("ev.key === 'Enter' && !ev.shiftKey")
    expect(guard).toBeGreaterThan(-1)
    expect(send).toBeGreaterThan(guard)
  })

  it('keeps Enter to send and Shift+Enter to break the line', () => {
    expect(SOURCE).toContain("if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); void doSend() }")
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

  it('stamps user turns, bot replies and tool cards', () => {
    expect(SOURCE.match(/e\(MsgTime, \{ entry: en \}\)/g)?.length).toBe(3)
  })
})
