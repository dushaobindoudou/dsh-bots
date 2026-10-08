/**
 * Theme-token guards.
 *
 * The plugin follows the shell's light/dark system entirely through `--dsw-*`
 * variables. The 2026-09-18 audit checked every variable this plugin uses
 * against the shell's real theme source (dsh-client-ui-theme's embedded CSS:
 * light on `body{...}`, dark on `body[data-ds-dark-theme]{...}`, invariants
 * defined once) and found three phantoms that silently fell back to
 * hardcoded colors in dark mode. These tests keep them out.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'client.ts'),
  'utf8',
)

describe('theme tokens', () => {
  it('uses no phantom dsw variables (2026-09-18 audit)', () => {
    for (const phantom of ['--dsw-font-family-mono', '--dsw-alias-fill-l1']) {
      expect(SOURCE.includes(phantom), `dead token in CSS: ${phantom}`).toBe(false)
    }
    // dsh 0.2 ships the shorthand as well as its per-property composites.
    expect(SOURCE).toContain('var(--dsw-font-markdown-code-block-small)')
  })

  it('takes the mono stack from the shell (--ds-font-family-code)', () => {
    // Note the --ds- (not --dsw-) namespace: that is what the shell's own
    // code-block typography composites resolve to.
    expect(SOURCE).toContain('var(--ds-font-family-code,')
  })

  it('keeps every var() fallback mode-safe or absent', () => {
    // A var() without a fallback inherits the shell value, which is always
    // theme-correct; a fallback must therefore stay neutral in dark mode.
    // rgba(0,0,0,x) fills behind text are the one audited exception (they
    // ride on tokens that exist in both modes).
    const bare = [...SOURCE.matchAll(/var\((--dsw-[a-z0-9-]+)\)/g)].map((m) => m[1])
    const KNOWN_SAFE = new Set([
      '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary', '--dsw-alias-label-caption',
      '--dsw-alias-state-error-primary', '--dsw-alias-state-success-primary',
      '--dsw-alias-border-l2', '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1',
      '--dsw-alias-bg-layer-2', '--dsw-alias-markdown-code-block', '--dsw-specific-bubble',
      '--dsw-static-deepseek-500', '--dsw-static-deepseek-200', '--dsw-alias-state-business-primary',
      '--dsw-alias-interactive-bg-hover', '--dsw-specific-input-major', '--dsw-specific-menu',
      '--dsw-alias-border-l1', '--dsw-alias-label-primary',
      // Mode-invariant or dual-mode tokens verified in the 2026-09-18 audit:
      '--dsw-shadow-lv2', '--dsw-font-family', '--dsw-alias-border-l3',
      '--dsw-alias-brand-primary', '--dsw-alias-interactive-bg-hover-solid',
      '--dsw-alias-border-l4',
      '--dsw-font-markdown-code-block-small',
      // The --dsw-radius-* scale does not exist in 0.2.0-rc.2 (native CSS
      // modules hardcode their radii); a bare radius var() must never return.
    ])
    expect(bare.filter((v) => v.startsWith('--dsw-radius-'))).toEqual([])
    const offenders = bare.filter((v) => !KNOWN_SAFE.has(v))
    expect(offenders, `bare var() without fallback — verify it exists in both shell modes: ${offenders.join(', ')}`).toEqual([])
  })
})
