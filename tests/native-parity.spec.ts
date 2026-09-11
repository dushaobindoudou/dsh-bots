/**
 * Native-parity guards for the two surfaces the workbench draws itself: the
 * composer (vs the shipped InputBar) and the message stream (vs MessageItem /
 * AssistantMarkdown / ChatView).
 *
 * Every value pinned here was read out of the shipped CSS modules — when a dsh
 * upgrade moves the native metric, this file is where the drift shows up.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const CLIENT = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'client.ts'),
  'utf8',
)

describe('composer parity (native InputBar)', () => {
  it('draws the stroke from the elevation system, not a border', () => {
    // InputBar.card: border:0 + --dsw-elevation-stroke-color + elevation-soft.
    expect(CLIENT).toMatch(/\.dbs-composerCard\{[^}]*--dsw-elevation-stroke-color:var\(--dsw-alias-border-l2\)/)
    expect(CLIENT).toMatch(/\.dbs-composerCard\{[^}]*box-shadow:var\(--dsw-elevation-soft,/)
    expect(CLIENT).toMatch(/\.dbs-composerCard\{[^}]*border:0/)
    expect(CLIENT).not.toMatch(/\.dbs-composerCard\{[^}]*border:1px solid/)
  })

  it('uses the shipped card metrics (8px top padding, 12px trailing gap)', () => {
    expect(CLIENT).toMatch(/\.dbs-composerCard\{[^}]*padding-top:8px/)
    expect(CLIENT).toMatch(/\.dbs-composerTrailing\{[^}]*gap:12px/)
    expect(CLIENT).toMatch(/\.dbs-composer\{padding:0 var\(--dsh-composer-side-clearance\) 8px/)
  })

  it('sizes the input like the native one (36px, 4px 8px 0 14px)', () => {
    expect(CLIENT).toMatch(/\.dbs-composerInput\{[^}]*min-height:36px/)
    expect(CLIENT).toMatch(/\.dbs-composerInput\{[^}]*padding:4px 8px 0 14px/)
    expect(CLIENT).toMatch(/caret-color:var\(--dsw-alias-state-business-primary\)/)
    expect(CLIENT).toMatch(/\.dbs-composerInput\{[^}]*font-size:inherit/)
  })

  it('follows the shell content font variables instead of hardcoding px', () => {
    expect(CLIENT).toMatch(/\.dbs-composerCard\{[^}]*font-size:var\(--dsh-content-font-size,14px\)/)
    expect(CLIENT).not.toMatch(/\.dbs-composerInput\{[^}]*font-size:16px/)
    expect(CLIENT).not.toMatch(/\.dbs-botRow\{[^}]*font-size:16px/)
    expect(CLIENT).not.toMatch(/\.dbs-bubble\{[^}]*font-size:16px/)
  })

  it('renders the attach affordance as the native round add button', () => {
    expect(CLIENT).toMatch(/\.dbs-attachBtn\{[^}]*width:28px;height:28px/)
    expect(CLIENT).toMatch(/\.dbs-attachBtn\{[^}]*background:var\(--dsw-specific-selector/)
    expect(CLIENT).toMatch(/\.dbs-attachBtn:hover:not\(:disabled\)\{background:var\(--dsw-alias-interactive-bg-hover-solid\)/)
  })

  it('keeps the send button on the native hover token and -2px lift', () => {
    expect(CLIENT).toMatch(/\.dbs-send\{[^}]*transform:translateY\(-2px\)/)
    expect(CLIENT).toMatch(/\.dbs-send:hover:not\(:disabled\)\{background:var\(--dsw-alias-button-info-hover/)
  })
})

describe('message stream parity (native MessageItem / ChatView)', () => {
  it('types user bubbles at the native 14px/22px scale', () => {
    expect(CLIENT).toMatch(/\.dbs-bubble\{[^}]*font-size:var\(--dsh-content-font-size,14px\)/)
    expect(CLIENT).toMatch(/\.dbs-bubble\{[^}]*line-height:calc\(22px \+ var\(--dsh-content-font-delta,0px\)\)/)
    expect(CLIENT).toMatch(/\.dbs-bubble\{[^}]*white-space:pre-wrap/)
  })

  it('caps the user stack at 70.2% of the content column like native', () => {
    expect(CLIENT).toMatch(/max-width:min\(calc\(var\(--dsh-chat-content-width,748px\) \* \.702\),82%\)/)
  })

  it('types assistant output at the native 14px/24px scale', () => {
    expect(CLIENT).toMatch(/\.dbs-botRow\{[^}]*font-size:var\(--dsh-content-font-size,14px\)/)
    expect(CLIENT).toMatch(/\.dbs-botRow\{[^}]*line-height:calc\(24px \+ var\(--dsh-content-font-delta,0px\)\)/)
  })

  it('keeps attribution quiet: secondary type, no coloured bold header', () => {
    expect(CLIENT).toMatch(/\.dbs-author\{[^}]*font-size:var\(--dsh-content-font-size-secondary,13px\)/)
    expect(CLIENT).toMatch(/\.dbs-authorName\{font-weight:500\}/)
    expect(CLIENT).not.toContain('authorColor')
  })

  it('uses the native code-block tokens for markdown', () => {
    expect(CLIENT).toMatch(/\.dbs-md code\{[^}]*var\(--dsw-alias-markdown-code-block/)
    expect(CLIENT).toMatch(/\.dbs-md pre\{[^}]*var\(--dsw-alias-markdown-code-block/)
    expect(CLIENT).toMatch(/\.dbs-md pre\{[^}]*font:var\(--dsw-font-markdown-code-block-small/)
  })

  it('makes the scroll container a query container for responsive tables', () => {
    expect(CLIENT).toMatch(/\.dbs-scroll\{[^}]*container-type:inline-size/)
  })

  it('styles the jump button as the native floating control', () => {
    expect(CLIENT).toMatch(/\.dbs-jump\{[^}]*background:var\(--dsw-alias-button-floating-fill/)
    expect(CLIENT).toMatch(/\.dbs-jump\{[^}]*box-shadow:var\(--dsw-elevation-panel/)
    expect(CLIENT).toMatch(/\.dbs-jump\{[^}]*width:34px;height:34px/)
  })

  it('shows the running turn with the native shimmer plus an elapsed clock', () => {
    expect(CLIENT).toContain("className: 'dbs-turnStatus'")
    expect(CLIENT).toContain("className: 'dbs-turnStatusClock'")
    expect(CLIENT).toMatch(/animation:1\.8s linear infinite dbsTurnShimmer/)
    expect(CLIENT).toMatch(/dbs-turnStatusClock' \}, formatDurationMs\(elapsedMs\)/)
    expect(CLIENT).toMatch(/setInterval\(\(\) => setElapsedMs\(Date\.now\(\) - started\), 1000\)/)
    expect(CLIENT).toMatch(/@media \(prefers-reduced-motion:reduce\)\{\.dbs-turnStatus\{/)
  })
})

describe('attachment rail parity (native ComposerAttachments)', () => {
  it('uses 64px rounded-16 thumbnails in a rail', () => {
    expect(CLIENT).toMatch(/\.dbs-pendingImgThumb\{[^}]*border-radius:16px;width:64px;height:64px/)
    expect(CLIENT).toMatch(/\.dbs-pendingImgs\{[^}]*gap:10px/)
    expect(CLIENT).toMatch(/\.dbs-pendingImgs\{[^}]*padding:2px 10px 0/)
  })

  it('hides the remove control until hover, always visible on touch', () => {
    expect(CLIENT).toMatch(/\.dbs-pendingImgX\{[^}]*opacity:0/)
    expect(CLIENT).toMatch(/\.dbs-pendingImg:hover \.dbs-pendingImgX,\.dbs-pendingImgX:focus-visible\{opacity:1\}/)
    expect(CLIENT).toMatch(/@media \(pointer:coarse\)\{\.dbs-pendingImgX\{opacity:1\}\}/)
    expect(CLIENT).toMatch(/background:var\(--dsw-alias-button-contrast-fill/)
  })
})

describe('trigger menu parity (native MenuView)', () => {
  it('uses the menu surface, elevation stroke and 20px radius', () => {
    expect(CLIENT).toMatch(/\.dbs-mention\{[^}]*background:var\(--dsw-specific-menu/)
    expect(CLIENT).toMatch(/\.dbs-mention\{[^}]*box-shadow:var\(--dsw-elevation-prominent/)
    expect(CLIENT).toMatch(/\.dbs-mention\{[^}]*border-radius:20px/)
    expect(CLIENT).toMatch(/\.dbs-mention\{[^}]*max-height:320px/)
    expect(CLIENT).toMatch(/\.dbs-mention\{[^}]*bottom:calc\(100% \+ 4px\);left:0;right:0/)
  })

  it('sizes rows and columns like the native item', () => {
    expect(CLIENT).toMatch(/\.dbs-mentionRow\{[^}]*min-height:40px/)
    expect(CLIENT).toMatch(/\.dbs-mentionRow\{[^}]*border-radius:10px/)
    expect(CLIENT).toMatch(/\.dbs-mentionRow\{[^}]*font-size:14px;line-height:22px/)
    expect(CLIENT).toMatch(/\.dbs-mentionName\{[^}]*max-width:40%/)
    expect(CLIENT).toMatch(/\.dbs-mentionDesc\{[^}]*color:var\(--dsw-alias-label-tertiary\)/)
  })

  it('advertises the keyboard drill on the active row only', () => {
    expect(CLIENT).toMatch(/\.dbs-mentionHint\{[^}]*display:none/)
    expect(CLIENT).toMatch(/\.dbs-mentionRow\[data-active="true"\] \.dbs-mentionHint\{display:inline-flex\}/)
    expect(CLIENT).toContain("className: 'dbs-mentionHint' }, 'Tab'")
  })

  it('keeps the keyboard-selected row in view', () => {
    expect(CLIENT).toMatch(/className: 'dbs-mentionViewport', ref: mentionRef/)
    expect(CLIENT).toMatch(/querySelector\('\[data-active="true"\]'\)/)
    expect(CLIENT).toMatch(/scrollIntoView\(\{ block: 'nearest' \}\)/)
    expect(CLIENT).toMatch(/\}, \[mention\?\.index, mention\?\.query, mentionHits\.length\]\)/)
  })
})

describe('file-change parity (native diff card)', () => {
  it('derives a diff stat from unified-diff output', () => {
    expect(CLIENT).toContain('function parseDiffStat')
    expect(CLIENT).toMatch(/line\.startsWith\('@@'\)/)
    expect(CLIENT).toMatch(/line\.startsWith\('\+'\)\) added \+= 1/)
  })

  it('renders the native +N -M suffix and per-line tinting', () => {
    expect(CLIENT).toMatch(/className: 'dbs-diffStat' \}, `\+\$\{stat\.added\} -\$\{stat\.removed\}`/)
    expect(CLIENT).toMatch(/\.dbs-diffStat\{[^}]*font-family:var\(--ds-font-family-code/)
    expect(CLIENT).toMatch(/\.dbs-diffLine\[data-kind="add"\]\{background:color-mix\(in srgb,var\(--dsw-alias-state-success-primary\)/)
    expect(CLIENT).toMatch(/\.dbs-diffLine\[data-kind="del"\]\{background:color-mix\(in srgb,var\(--dsw-alias-state-error-primary\)/)
  })
})

describe('message action parity (native MessageIconActions)', () => {
  it('reveals a 28px round icon row on hover only', () => {
    expect(CLIENT).toMatch(/\.dbs-actions\{[^}]*height:calc\(28px \+ var\(--dsh-content-font-delta,0px\)\)/)
    expect(CLIENT).toMatch(/\.dbs-actions\{[^}]*opacity:0;transition:opacity 80ms/)
    expect(CLIENT).toMatch(/\.dbs-action\{[^}]*border-radius:28px/)
    expect(CLIENT).toMatch(/\.dbs-action:hover\{background:var\(--dsw-alias-interactive-bg-hover\)/)
    expect(CLIENT).toMatch(/\.dbs-action svg\{width:calc\(15px \+ var\(--dsh-content-font-delta,0px\)\)/)
  })

  it('copies through the shell writer with a one-second confirmation', () => {
    expect(CLIENT).toMatch(/const write = NATIVE\.writeClipboard/)
    expect(CLIENT).toMatch(/navigator\.clipboard/)
    expect(CLIENT).toMatch(/setTimeout\(\(\) => \{ timer\.current = null; setCopied\(false\) \}, 1000\)/)
    expect(CLIENT).toContain("Ico(copied ? 'IconCheckOutline16' : 'IconCopyOutline16', { size: 15 })")
  })
})

describe('composer growth and stream scrolling (regressions)', () => {
  it('keeps exactly one scroller, so the stick-to-bottom ref is the real one', () => {
    // A second `overflow` on the inner column silently stranded the ref'd
    // element: scrollTo ran, nothing moved, and the stream never followed.
    expect(CLIENT).toMatch(/\.dbs-scroll\{[^}]*flex:0 0 auto/)
    expect(CLIENT).not.toMatch(/\.dbs-scroll\{[^}]*overflow/)
    expect(CLIENT).toMatch(/\.dbs-scrollBody\{[^}]*overflow:hidden auto/)
  })

  it('grows the input with its content instead of pinning one row', () => {
    // Chrome 123+ sizes the box itself; the JS measurement is the fallback.
    expect(CLIENT).toMatch(/\.dbs-composerInput\{[^}]*field-sizing:content/)
    expect(CLIENT).toMatch(/\.dbs-composerInput\{[^}]*max-height:var\(--dsh-composer-text-max-height,220px\)/)
    expect(CLIENT).toMatch(/\.dbs-composerScroll\{[^}]*max-height:var\(--dsh-composer-text-max-height,220px\)/)
    expect(CLIENT).toMatch(/cssApi\.supports\('field-sizing', 'content'\)/)
  })

  it('puts the attach control in a LEFT tools group with the native paperclip', () => {
    expect(CLIENT).toMatch(/\.dbs-composerTools\{[^}]*display:flex;gap:12px/)
    expect(CLIENT).toMatch(/\.dbs-composerTrailing\{[^}]*margin-left:auto/)
    expect(CLIENT).toMatch(/e\('div', \{ className: 'dbs-composerTools' \},/)
    expect(CLIENT).toMatch(/Ico\('IconPaperclipOutline16', \{ size: 14 \}\) \?\? e\(PaperclipGlyph, null\)/)
    expect(CLIENT).not.toMatch(/nat\('Icon[A-Za-z0-9]+'/)
    // The attach button must not sit in the trailing (send) group any more.
    expect(CLIENT).not.toMatch(/dbs-composerTrailing[\s\S]{0,200}dbs-attachBtn/)
  })

  it('pins the reader to the tail again when they send', () => {
    expect(CLIENT).toMatch(/stickRef\.current = true\n\s*setShowJump\(false\)/)
  })
})

describe('turn rail (native TurnNavigatorRail)', () => {
  it('anchors every entry and marks where turns begin', () => {
    expect(CLIENT).toMatch(/className: 'dbs-flowItem'/)
    expect(CLIENT).toMatch(/'data-eid': en\.id !== '' \? en\.id : String\(i\)/)
    expect(CLIENT).toMatch(/'data-turn-start': turnStart \? 'true' : undefined/)
    expect(CLIENT).toMatch(/const turnStart = en\.display === 'user' \|\| en\.display === 'attachment'/)
  })

  it('draws right-edge ticks, the active one primary and wider', () => {
    expect(CLIENT).toMatch(/\.dbs-rail\{[^}]*right:6px;width:28px/)
    expect(CLIENT).toMatch(/\.dbs-railMark\{[^}]*right:0;width:20px;height:10px/)
    expect(CLIENT).toMatch(/\.dbs-railMark:before\{[^}]*width:12px;height:2px/)
    expect(CLIENT).toMatch(/\.dbs-railMark\[data-active="true"\]:before\{background:var\(--dsw-alias-label-primary\);width:20px\}/)
    expect(CLIENT).toMatch(/\.dbs-railMark\[data-busy="true"\]:before\{animation:1s ease-in-out infinite dbsRailBusy\}/)
  })

  it('measures tick positions from the real anchors and follows the reading position', () => {
    expect(CLIENT).toMatch(/querySelectorAll\('\[data-turn-start="true"\]'\)/)
    expect(CLIENT).toMatch(/ratio: Math\.max\(0, Math\.min\(1, \(n\.getBoundingClientRect\(\)\.top - box\.top \+ body\.scrollTop\) \/ total\)\)/)
    expect(CLIENT).toMatch(/setActiveTurn\(\(prev: string \| null\) => \(prev === current \? prev : current\)\)/)
  })

  it('jumps to a turn on click, releasing the tail stick', () => {
    expect(CLIENT).toMatch(/function goToTurn\(id: string\)/)
    expect(CLIENT).toMatch(/stickRef\.current = false\n\s*node\.scrollIntoView\(\{ block: 'start' \}\)/)
    expect(CLIENT).toMatch(/turnMarks\.length > 1\n\s*\? e\(TurnRail, \{ marks: turnMarks, activeId: activeTurn, busy: composing, onGo: goToTurn \}\)/)
  })
})

describe('plugin-facing theme contract', () => {
  it('never leaves a shell-internal token without a fallback', () => {
    // Only a curated token set is guaranteed to plugins; elevation/static
    // tokens are shell-internal, so an unguarded var() would silently drop
    // the declaration (and the effect it carries).
    expect(CLIENT).not.toMatch(/var\(--dsw-elevation-[a-z-]+\)/)
    expect(CLIENT).not.toMatch(/var\(--dsw-static-[a-z0-9-]+\)/)
    expect(CLIENT).not.toMatch(/var\(--dsw-specific-[a-z-]+\)/)
    expect(CLIENT).toMatch(/var\(--dsw-elevation-soft,0 2px 8px rgba\(0,0,0,\.08\)\)/)
    expect(CLIENT).toMatch(/var\(--dsw-static-deepseek-500,var\(--dsw-alias-brand-primary\)\)/)
  })
})

describe('sidebar section headers (native workspace list)', () => {
  it('gives the nav exactly one right inset, not two', () => {
    // .dbs-nav carries the counter-margin that reproduces the native list
    // inset; the body's own padding-right stacked a second inset on top and
    // pulled every row and header 12px short of the right edge.
    expect(CLIENT).toMatch(/\.dbs-nav\{[^}]*margin-right:var\(--dsh-sidebar-inline-padding,12px\)/)
    expect(CLIENT).toMatch(/\.dbs-botsBody\{[^}]*overflow-y:auto/)
    expect(CLIENT).not.toMatch(/\.dbs-botsBody\{[^}]*padding-right/)
  })

  it('draws the header with the native geometry, including the -4px bleed', () => {
    // Native sectionHeader: height 36, radius 12, padding-left 4, gap 4, and
    // margin-right -4 so the header runs past the list rows' edge.
    expect(CLIENT).toMatch(/\.dbs-secHead\{[^}]*border-radius:12px;height:36px;margin-right:-4px/)
    expect(CLIENT).toMatch(/style: \{ padding: '0 4px', display: 'flex', alignItems: 'center', gap: 4 \}/)
    expect(CLIENT).not.toMatch(/padding: '0 8px 0 4px'/)
  })
})

describe('dialogs and entry menus (current surface spec)', () => {
  it('masks with the theme token and blur, not a flat rgba', () => {
    expect(CLIENT).toMatch(/\.dbs-modalBackdrop\{[^}]*background:var\(--dsw-alias-bg-mask-1,/)
    expect(CLIENT).toMatch(/\.dbs-modalBackdrop\{[^}]*backdrop-filter:var\(--dsw-mask-blur,/)
  })

  it('draws the panel as a raised layer-2 surface with no border', () => {
    expect(CLIENT).toMatch(/\.dbs-modalCard\{[^}]*background:var\(--dsw-alias-bg-layer-2,/)
    expect(CLIENT).toMatch(/\.dbs-modalCard\{[^}]*border:0;border-radius:20px/)
    expect(CLIENT).toMatch(/\.dbs-modalCard\{[^}]*box-shadow:var\(--dsw-elevation-prominent,/)
    expect(CLIENT).toMatch(/\.dbs-modalCard\{[^}]*width:min\(440px,calc\(100vw - 48px\)\)/)
    expect(CLIENT).toMatch(/\.dbs-modalCard\{[^}]*max-height:calc\(100vh - 48px\)/)
    expect(CLIENT).toMatch(/\.dbs-modalCard\.dbs-modalNarrow\{width:min\(360px,calc\(100vw - 48px\)\)/)
    expect(CLIENT).not.toMatch(/\.dbs-modalCard\{[^}]*border:1px solid/)
  })

  it('uses the native surface title and footer rhythm', () => {
    expect(CLIENT).toMatch(/\.dbs-modalTitle\{font-size:16px;line-height:22px;font-weight:500/)
    expect(CLIENT).toMatch(/\.dbs-modalFooter\{[^}]*gap:12px/)
  })

  it('renders entry menus on the menu surface with native rows', () => {
    expect(CLIENT).toMatch(/\.dbs-secMenu\{[^}]*background:var\(--dsw-specific-menu,/)
    expect(CLIENT).toMatch(/\.dbs-secMenu\{[^}]*border:0;border-radius:20px/)
    expect(CLIENT).toMatch(/\.dbs-secMenu\{[^}]*box-shadow:var\(--dsw-elevation-prominent,/)
    expect(CLIENT).toMatch(/\.dbs-secMenuItem\{[^}]*min-height:40px/)
    expect(CLIENT).toMatch(/\.dbs-secMenuItem\{[^}]*border-radius:10px/)
    expect(CLIENT).toMatch(/\.dbs-secMenuItem\{[^}]*font-size:14px;line-height:22px/)
  })

  it('keeps shell-internal dialog tokens behind fallbacks', () => {
    expect(CLIENT).toMatch(/var\(--dsw-alias-bg-mask-1,var\(--dsw-alias-bg-overlay,/)
    expect(CLIENT).toMatch(/var\(--dsw-elevation-prominent,var\(--dsw-shadow-lv3,/)
  })
})

describe('layout following (sidebar fold)', () => {
  it('follows the animated grid instead of sampling its start value', () => {
    // The frame CSS transitions `grid-template-columns`, so the inline style
    // (and the mutation observer) fires ONCE at the start while the computed
    // value keeps moving. Reading only there pinned the panel to the pre-fold
    // width and it never followed the collapsing sidebar.
    expect(CLIENT).toMatch(/const sample = \(\): void => \{\n\s*const cols = apply\(\)/)
    expect(CLIENT).toMatch(/if \(cols !== lastCols\) \{ lastCols = cols; raf = requestAnimationFrame\(sample\) \}/)
    expect(CLIENT).toMatch(/raf = requestAnimationFrame\(sample\)/)
    expect(CLIENT).toMatch(/frame\.addEventListener\('transitionend', kick\)/)
    expect(CLIENT).toMatch(/window\.addEventListener\('resize', kick\)/)
    expect(CLIENT).toMatch(/cancelAnimationFrame\(raf\)/)
  })

  it('watches the fold attributes the layout actually writes', () => {
    // `data-details-collapsed` does not exist (the right column's track is the
    // only "details" seat); the real flags are these.
    expect(CLIENT).toContain("attributeFilter: ['style', 'data-sidebar-collapsed', 'data-rightbar-collapsed', 'data-rightbar-fullscreen', 'data-dragging']")
    expect(CLIENT).not.toContain("'data-details-collapsed'")
  })

  it('renders the rail control on the native rail button spec', () => {
    expect(CLIENT).toMatch(/\.dbs-railBtn\{[^}]*width:28px;height:28px/)
    expect(CLIENT).toMatch(/\.dbs-railBtn\{[^}]*border-radius:50%/)
    expect(CLIENT).toMatch(/\.dbs-railBtn\{[^}]*color:var\(--dsw-alias-label-secondary\)/)
    expect(CLIENT).toMatch(/\.dbs-railBtn:hover\{background:var\(--dsw-alias-interactive-bg-hover\)\}/)
  })

  it('keeps both fold states rendering a real surface', () => {
    // wide → our accordion; rail → the shipped browser's icon column + our control.
    expect(CLIENT).toMatch(/const wide = p\.wide !== false/)
    expect(CLIENT).toMatch(/if \(!wide\) \{/)
    expect(CLIENT).toMatch(/e\(DelegatedBrowser, \{ \.\.\.p, wide: false \}\)/)
    expect(CLIENT).toMatch(/e\(DelegatedBrowser, \{ \.\.\.p, wide \}\)/)
  })
})
