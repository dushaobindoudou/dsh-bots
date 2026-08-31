/**
 * Dictionary guards.
 *
 * The client half is a self-contained IIFE loaded by the shell's module
 * loader, so it cannot be imported here — these read the source instead. That
 * is enough to catch the two ways translations rot: a key used in the UI that
 * no dictionary defines (renders as a bare key), and a key added to one
 * language but not the other (renders in the wrong language, silently, because
 * the locale runtime falls back to `en`).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'client.ts'),
  'utf8',
)

/** Keys of one `const <name>: Record<string, string> = { … }` literal. */
function dictionaryKeys(name: string): string[] {
  const start = SOURCE.indexOf(`const ${name}: Record<string, string> = {`)
  expect(start, `${name} dictionary not found`).toBeGreaterThan(-1)
  const body = SOURCE.slice(start, SOURCE.indexOf('\n      }', start))
  return [...body.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]).sort()
}

/** Every key passed to the `t()` seat anywhere in the client. */
function usedKeys(): string[] {
  return [...new Set([...SOURCE.matchAll(/\bt\('([^']+)'/g)].map((m) => m[1]))].sort()
}

describe('locale dictionaries', () => {
  const zh = dictionaryKeys('zh')
  const en = dictionaryKeys('en')

  it('defines a non-trivial zh dictionary', () => {
    expect(zh.length).toBeGreaterThan(40)
  })

  it('keeps zh and en on identical key sets', () => {
    expect(en, 'en is missing keys present in zh').toEqual(zh)
  })

  it('defines every key the UI asks for', () => {
    const undefinedKeys = usedKeys().filter((k) => !zh.includes(k))
    expect(undefinedKeys, `t() called with keys no dictionary defines: ${undefinedKeys.join(', ')}`).toEqual([])
  })

  it('has no unused dictionary entries', () => {
    const used = usedKeys()
    const orphans = zh.filter((k) => !used.includes(k))
    expect(orphans, `dictionary entries nothing renders: ${orphans.join(', ')}`).toEqual([])
  })

  it('uses matching interpolation placeholders in both languages', () => {
    const start = SOURCE.indexOf('const zh: Record<string, string> = {')
    const zhBody = SOURCE.slice(start, SOURCE.indexOf('\n      }', start))
    const enStart = SOURCE.indexOf('const en: Record<string, string> = {')
    const enBody = SOURCE.slice(enStart, SOURCE.indexOf('\n      }', enStart))
    const placeholders = (body: string) => {
      const out = new Map<string, string>()
      for (const m of body.matchAll(/^\s*'([^']+)':\s*'([^']*)'/gm)) {
        out.set(m[1], [...m[2].matchAll(/\{(\w+)\}/g)].map((p) => p[1]).sort().join(','))
      }
      return out
    }
    const zhP = placeholders(zhBody)
    const enP = placeholders(enBody)
    for (const [key, slots] of zhP) {
      // A placeholder dropped in translation renders a literal gap; an added
      // one renders `{n}` verbatim, since the runtime only substitutes what
      // the caller passed.
      expect(enP.get(key), `placeholders differ for "${key}"`).toBe(slots)
    }
  })

  it('registers the dictionaries and binds the namespace', () => {
    expect(SOURCE).toContain("locale.register(NS, { zh, en })")
    expect(SOURCE).toContain('boundT = locale.bind(NS)')
    // A language switch must reach strings held at module scope.
    expect(SOURCE).toContain('locale.subscribe(')
  })

  it('declares the locale namespace on every slot registration', () => {
    const registrations = [...SOURCE.matchAll(/\{ name: '([^']+)'[^}]*\}/g)]
      .filter((m) => m[0].includes("registrant: 'dsh-plugin-bots'"))
    expect(registrations.length).toBeGreaterThanOrEqual(3)
    for (const r of registrations) {
      expect(r[0], `${r[1]} must declare locale: NS`).toContain('locale: NS')
    }
  })
})
