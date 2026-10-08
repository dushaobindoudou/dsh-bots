/**
 * dsh-bots — client half (web), formal-plugin runtime.
 *
 * Rendered by the dsh web shell through the standard slot system with full
 * browser DOM access. Two rules keep the surface native rather than
 * native-looking:
 *
 *  1. Components come from `@deepseek-ai/dsh-client-ui-primitives`, which the
 *     shell publishes in its static module map alongside `react`. Buttons,
 *     inputs, icons, state dots and the markdown renderer are therefore the
 *     shipped ones, not reimplementations. Every lookup degrades to a local
 *     fallback so a primitives reshuffle can never blank the plugin.
 *  2. Our own CSS uses stable `dbs-` class names carrying the *values* read
 *     out of the shipped stylesheets (row heights, radii, the composer var
 *     family), expressed through dsh theme variables. No hashed class name is
 *     borrowed, so a dsh rebuild cannot break the visuals.
 *
 * Sidebar integration: the left-nav workspace region (`sidebar.workspaces` is
 * a single slot) is shadowed at a low priority — an officially supported move,
 * the shell's own error text reads "register at a different priority to shadow
 * it (lowest renders)" — and re-rendered as a two-group collapsible nav:
 *   - 「工作区」 — delegates the ORIGINAL shipped workspace browser, with its
 *                 child slots and its rail branch intact (see DelegatedBrowser).
 *   - 「Bots」   — our bot/group tree; clicking opens the chat.
 *
 * Chat lives in the native `main` panel, selected through ctx.layout.
 * Only dialogs use `shell.overlay`; the host owns all column geometry.
 *
 * Live data: the host keeps an SSE ring fed from the sdk-bots `/events`
 * channel. ONE bus drains it here and fans channels out to subscribers; no
 * component owns the cursor and no component polls the gateway directly.
 * @module dsh-bots/client
 */

;(() => {
  const loader = (window as any).__ModuleLoader__
  if (loader === undefined) return
  loader.load({
    id: 'dsh-bots',
    factory: (require: (id: string) => any) => {
      const module = { exports: {} as any }
      const exports = module.exports
      const React: any = require('react')
      const e = React.createElement

      /**
       * Shipped primitives. Present in the shell's static module registry
       * next to `react`; the guard keeps a missing/renamed package from
       * taking the plugin down with it.
       */
      let NATIVE: any = {}
      try { NATIVE = require('@deepseek-ai/dsh-client-ui-primitives') ?? {} } catch { NATIVE = {} }

      /** Render a shipped icon by export name, or nothing if it is gone. */
      function Ico(name: string, props?: any): any {
        const currentName = name.replace(/14$/, 'Regular').replace(/16$/, 'Medium')
        const C = NATIVE[currentName] ?? NATIVE[name]
        return C === undefined ? null : e(C, props ?? {})
      }

      /**
       * The shipped composer's send glyph. It is not a named primitive —
       * the official chatbar draws this SVG inline — so we replicate the
       * path byte-exact from the shipped bundle (arrow-up, currentColor).
       */
      function SendUpIcon(): any {
        return e('svg', { viewBox: '0 0 16 16', width: '16', height: '16', 'aria-hidden': true },
          e('path', {
            d: 'M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z',
            fill: 'currentColor',
          }))
      }
      /**
       * The official chatbar morphs send into a stop square while a run is
       * active (§12-29); replicate that glyph byte-simple — a rounded rect,
       * currentColor — so the stop affordance reads native.
       */
      function StopSquareIcon(): any {
        return e('svg', { viewBox: '0 0 16 16', width: '16', height: '16', 'aria-hidden': true },
          e('rect', { x: 3, y: 3, width: 10, height: 10, rx: 3, fill: 'currentColor' }))
      }
      /** Paperclip glyph — the native composer's attach control draws
       * IconPaperclipOutline16; this stands in only if that export is gone. */
      function PaperclipGlyph(): any {
        return e('svg', { viewBox: '0 0 16 16', width: '15', height: '15', 'aria-hidden': true },
          e('path', {
            d: 'M10.6 4.2 5.4 9.4a1.6 1.6 0 0 0 2.3 2.3l5.2-5.2a3.1 3.1 0 0 0-4.4-4.4L3.3 7.3a4.6 4.6 0 0 0 6.5 6.5l4.1-4.1',
            fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4',
            'stroke-linecap': 'round', 'stroke-linejoin': 'round',
          }))
      }

      /** Shipped component by export name, or a local stand-in. */
      function nat(name: string, fallback: any): any {
        return NATIVE[name] ?? fallback
      }

      // ---- Fallback stand-ins (only used if a primitive export disappears) ----
      function FallbackButton(p: any) {
        const { variant, size, icon, children, ...rest } = p
        return e('button', { type: 'button', ...rest }, icon ?? null, children)
      }
      function FallbackInput(p: any) {
        const { icon, ...rest } = p
        return e('input', rest)
      }
      function FallbackText(p: any) {
        return e('div', { className: 'dbs-plain' }, ...inlineFileChips(String(p.text ?? '')))
      }

      /**
       * Local markdown renderer for the (observed-in-the-wild) case where the
       * shell's static module map serves the primitives package without
       * MarkdownText: block-level fenced code / headings / hr / blockquote /
       * lists / paragraphs, inline bold / italic / code / links. Built from
       * createElement only — no HTML string ever crosses in. Streaming-safe:
       * an unterminated fence renders as a code block running to the tail.
       */
      /**
       * Inline image preview. `![alt](url)` and bare image URLs render as a
       * clickable thumbnail (click opens the full image in a new tab); a
       * failed load degrades to the browser's broken-image box inside the
       * same link, so the URL is never lost. Extension-based detection plus
       * an allowlist for extension-less media hosts the crew actually posts
       * (Pollinations MCP tool results).
       */
      const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?[^)\s]*)?$/i
      const IMG_HOSTS = new Set(['media.pollinations.ai', 'image.pollinations.ai'])
      function isImageUrl(url: string): boolean {
        if (IMG_EXT.test(url)) return true
        try { return IMG_HOSTS.has(new URL(url).hostname) } catch { return false }
      }
      function imgLink(src: string, alt: string): any {
        return e('a', { href: src, target: '_blank', rel: 'noreferrer', className: 'dbs-imglink' },
          e('img', { src, alt: alt !== '' ? alt : src, loading: 'lazy' }))
      }

      function mdInline(text: string): any[] {
        const out: any[] = []
        let buf = ''
        let i = 0
        const push = () => { if (buf !== '') { out.push(buf); buf = '' } }
        while (i < text.length) {
          const rest = text.slice(i)
          let m: RegExpExecArray | null
          if (rest.startsWith('`') && (m = /^`([^`\n]+)`/.exec(rest)) !== null) {
            push(); out.push(e('code', null, m[1])); i += m[0].length; continue
          }
          if (rest.startsWith('**') && (m = /^\*\*([\s\S]+?)\*\*/.exec(rest)) !== null) {
            push(); out.push(e('strong', null, mdInline(m[1]))); i += m[0].length; continue
          }
          if (rest.startsWith('*') && (m = /^\*([^*\n]+)\*/.exec(rest)) !== null) {
            push(); out.push(e('em', null, mdInline(m[1]))); i += m[0].length; continue
          }
          MEDIA_FILE_AT_RE.lastIndex = 0
          if ((m = MEDIA_FILE_AT_RE.exec(rest)) !== null) {
            const p = m[0].replace(/[.,;:!?、。，；：！？）)】\]>}]+$/, '')
            if (p.length >= 4 && !p.startsWith('//') && !MEDIA_IMG_RE.test(p) && MEDIA_FILE_RE.test(p)) {
              out.push(e(FileChip, { key: p, path: p })); i += p.length; continue
            }
          }
          if ((m = /^!\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)\)/.exec(rest)) !== null) {
            push(); out.push(imgLink(m[2], m[1])); i += m[0].length; continue
          }
          if ((m = /^\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/.exec(rest)) !== null) {
            push(); out.push(e('a', { href: m[2], target: '_blank', rel: 'noreferrer' }, m[1])); i += m[0].length; continue
          }
          if ((m = /^(https?:\/\/[^\s<>()[\]{}'"]+)/.exec(rest)) !== null) {
            push()
            if (isImageUrl(m[1])) { out.push(imgLink(m[1], m[1])); i += m[0].length; continue }
            out.push(e('a', { href: m[1], target: '_blank', rel: 'noreferrer' }, m[1])); i += m[0].length; continue
          }
          buf += text[i]; i += 1
        }
        push()
        return out
      }

      function mdBlocks(text: string): any[] {
        const lines = text.split('\n')
        const out: any[] = []
        let i = 0
        let para: string[] = []
        const flushPara = () => { if (para.length > 0) { out.push(e('p', null, mdInline(para.join('\n')))); para = [] } }
        while (i < lines.length) {
          const line = lines[i]
          const fence = /^\s*```(\w*)\s*$/.exec(line)
          if (fence !== null) {
            flushPara()
            const body: string[] = []
            i += 1
            while (i < lines.length && /^\s*```\s*$/.test(lines[i]) === false) { body.push(lines[i]); i += 1 }
            i += 1 // consume the closing fence; at EOF the block just ends open
            out.push(e('pre', null, e('code', fence[1] !== '' ? { 'data-lang': fence[1] } : null, body.join('\n'))))
            continue
          }
          const h = /^(#{1,4})\s+(.*)$/.exec(line)
          if (h !== null) { flushPara(); out.push(e('h' + String(h[1].length), null, mdInline(h[2]))); i += 1; continue }
          if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { flushPara(); out.push(e('hr', null)); i += 1; continue }
          const q = /^>\s?(.*)$/.exec(line)
          if (q !== null) {
            flushPara()
            const body = [q[1]]
            i += 1
            for (; i < lines.length; i += 1) { const m2 = /^>\s?(.*)$/.exec(lines[i]); if (m2 === null) break; body.push(m2[1]) }
            out.push(e('blockquote', null, e('p', null, mdInline(body.join('\n')))))
            continue
          }
          const isUl = /^\s*[-*+]\s+/.test(line)
          const isOl = /^\s*\d+[.)]\s+/.test(line)
          if (isUl || isOl) {
            flushPara()
            const items: any[] = []
            for (; i < lines.length; i += 1) {
              const m2 = isUl ? /^\s*[-*+]\s+(.*)$/.exec(lines[i]) : /^\s*\d+[.)]\s+(.*)$/.exec(lines[i])
              if (m2 === null) break
              items.push(e('li', null, mdInline(m2[1])))
            }
            out.push(e(isUl ? 'ul' : 'ol', null, items))
            continue
          }
          if (line.trim() === '') { flushPara(); i += 1; continue }
          para.push(line); i += 1
        }
        flushPara()
        return out
      }

      function MarkdownFallback(p: any) {
        return e('div', { className: 'dbs-md' }, mdBlocks(String(p.text ?? '')))
      }

      const Button = nat('Button', FallbackButton)
      const Input = nat('Input', FallbackInput)
      // Inline file chips must interleave elements inside the rendered text —
      // only our own renderers can do that, so the native text components are
      // bypassed for message bodies (the fallbacks cover the same markdown).
      const MarkdownText = MarkdownFallback
      const MessageText = FallbackText
      const StateDot = NATIVE.StateDot ?? null

      // ---- CSS: own stable class names, values mirrored from the shell ----
      const CSS = `
/* The native regionArea bleeds right by --dsh-sidebar-inline-padding
   (margin-right: -12px, ui-sidebar.js) for its own scroll model; our rows
   don't follow that bleed, so pull the nav back inside the padded column —
   verified in the live page: removing the parent's margin-right reads
   "normal", this counter-margin is the same geometry from our side. */
.dbs-nav{flex:1;min-height:0;display:flex;flex-direction:column;gap:2px;font-family:var(--dsw-font-family,inherit);margin-right:var(--dsh-sidebar-inline-padding,12px)}
.dbs-navGroup{display:flex;flex-direction:column;min-height:0}
.dbs-navGroup[data-open="true"]{flex:1 1 auto}
.dbs-navGroup[data-open="false"]{flex:none}
.dbs-navBody{display:flex;flex-direction:column;min-height:0;flex:1}
.dbs-botsBody{overflow-y:auto;scrollbar-gutter:stable;overflow-x:hidden}
.dbs-navBodyErr{padding:6px 12px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
/* Hover actions RESERVE their space (visibility/opacity swap, not
   display:none): a display toggle let the appearing buttons stretch the
   row on hover and shrink it on leave — width/height jitter the user read
   as flicker. Fixed 30px row + always-laid-out actions = zero geometry
   change; the same trick the native headerActions uses (max-width/opacity). */
.dbs-secHead{position:relative;cursor:pointer;border-radius:12px;height:36px;margin-right:-4px}
/* Section spacing follows the open state: a collapsed header must read as a
   plain row in the same list (the native collapsed groups sit 2px apart), so
   the air below a header and before the next one only exists when the body
   above is actually showing rows. The old unconditional 4px+10px made two
   collapsed headers float 14px apart. */
.dbs-secGroup+.dbs-secGroup{margin-top:2px}
.dbs-secGroup[data-open="true"]+.dbs-secGroup{margin-top:8px}
.dbs-secGroup[data-open="true"] .dbs-secHead{margin-bottom:4px}
.dbs-secHead:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dbs-secHead .dbs-rowActions{display:inline-flex;visibility:hidden;opacity:0;pointer-events:none;transition:opacity .12s ease-out}
.dbs-secHead:hover .dbs-rowActions,.dbs-secHead:focus-within .dbs-rowActions,.dbs-secHead[data-menu="true"] .dbs-rowActions{visibility:visible;opacity:1;pointer-events:auto}
.dbs-secMenu{position:absolute;top:100%;right:0;z-index:40;min-width:min(220px,100%);background:var(--dsw-specific-menu,var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-2)));--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);border:0;border-radius:20px;padding:4px;box-shadow:var(--dsw-elevation-prominent,var(--dsw-shadow-lv2));animation:dbs-modal-in .14s ease-out;overflow:hidden}
.dbs-secMenuItem{display:flex;align-items:center;gap:8px;width:100%;min-height:40px;padding:8px 10px;border-radius:10px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);cursor:pointer;background:none;border:none;text-align:left}
.dbs-secMenuItem:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dbs-prow,.dbs-srow{cursor:pointer;user-select:none;color:var(--dsw-alias-label-primary);border-radius:8px;align-items:center;gap:6px;padding:0 8px;display:flex;box-sizing:border-box}
/* Native mirror (dsh-client-ui-sidebar/workspace): header-class rows outdent
   their label 4px (pl:4 → x=16 from the window edge) while list rows keep
   pl:8 (→ x=20, identical to the native sessionRow). */
.dbs-prow{padding-left:4px}
.dbs-prow:hover,.dbs-srow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dbs-srow.dbs-selected{background:var(--dsw-alias-interactive-bg-hover)}
.dbs-prow{height:34px}
.dbs-srow{height:32px;gap:0}
.dbs-slot{width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;display:inline-flex}
.dbs-chevron{color:var(--dsw-alias-label-caption);display:inline-flex}
.dbs-arrow{transition:transform .15s var(--ds-ease-in-out)}
.dbs-arrowOpen{transform:rotate(90deg)}
.dbs-title{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:14px;line-height:20px;overflow:hidden;flex:1;margin:0 6px 0 4px}
.dbs-prow .dbs-title{font-weight:500}
.dbs-time{color:var(--dsw-alias-label-tertiary);flex:none;font-size:12px;line-height:20px}
.dbs-meta{text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px;overflow:hidden}
.dbs-rowActions{flex:none;align-items:center;gap:12px;display:none}
.dbs-prow:hover .dbs-rowActions,.dbs-srow:hover .dbs-rowActions{display:inline-flex}
.dbs-prow:hover .dbs-hideOnHover,.dbs-srow:hover .dbs-hideOnHover{display:none}
.dbs-avatar{width:20px;height:20px;border-radius:6px;flex:none;display:grid;place-items:center;font-size:11px;line-height:1;font-weight:600;color:#fff;overflow:hidden;user-select:none}
.dbs-avatar.dbs-group{border-radius:999px}
.dbs-avatar img{width:100%;height:100%;object-fit:cover;display:block}
.dbs-avatarRound{border-radius:999px}
.dbs-badge{min-width:16px;height:16px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-state-business-primary,#1a6dff);color:#fff;font-size:11px;line-height:16px;text-align:center;flex:none;font-variant-numeric:tabular-nums}
.dbs-rowPin{color:var(--dsw-alias-label-tertiary);flex:none;display:inline-flex;margin:0 2px 0 0}
.dbs-pinMenuIco{display:inline-flex;flex:none;width:14px;height:14px;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary)}
.dbs-unhideAll{margin-top:8px;align-self:flex-start;padding:4px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px;cursor:pointer}
.dbs-btn{padding:4px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));background:none;color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px;cursor:pointer}
.dbs-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.dbs-btn:disabled{opacity:.5;cursor:default}
.dbs-unhideAll:hover{background:var(--dsw-alias-interactive-bg-hover)}
/* Native rail icon button (bhn1Oq_iconButton): 28px, fully round, label-secondary. */
.dbs-railBtn{corner-shape:round;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:50%;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0;flex:none}
.dbs-railBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dbs-railBtn[data-active="true"]{color:var(--dsw-alias-state-business-primary)}
.dbs-rail{display:flex;flex-direction:column;align-items:center;gap:8px;margin:4px 0 8px}
.dbs-railWrap{display:flex;flex-direction:column;min-height:0;flex:1;gap:2px}
.dbs-form{display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:8px;margin:2px 0;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.2))}
.dbs-formRow{display:flex;gap:6px;align-items:center}
.dbs-members{display:flex;flex-direction:column;gap:2px;max-height:150px;overflow-y:auto}
.dbs-member{display:flex;align-items:center;gap:8px;font-size:14px;line-height:22px;padding:8px 10px;border-radius:10px;color:var(--dsw-alias-label-primary);cursor:pointer}
.dbs-member:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dbs-member.checked{color:var(--dsw-alias-state-business-primary,#1a6dff)}
.dbs-error{margin:4px 8px;padding:5px 9px;border-radius:8px;font-size:12px;line-height:18px;cursor:pointer;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-error-primary,#f85149)}


.dbs-goalTabs{display:flex;gap:2px;border-radius:10px;padding:3px;background:var(--dsw-alias-interactive-bg-hover)}
.dbs-goalTabs button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:4px 10px;border-radius:8px;font:inherit;cursor:pointer}
.dbs-goalTabs button[aria-pressed=true]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.dbs-goalPanel{flex:1;min-height:0;overflow:auto;padding:24px 20px;color:var(--dsw-alias-label-primary)}
.dbs-goalContent{max-width:748px;margin:0 auto;display:flex;flex-direction:column;gap:20px}
.dbs-goalHeader{display:flex;align-items:center;gap:12px;justify-content:space-between}
.dbs-goalHeader h2{font-size:18px;line-height:26px;margin:0;font-weight:600}
.dbs-goalCard{padding:20px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;display:flex;flex-direction:column;gap:14px}
.dbs-goalCard h3{font-size:16px;line-height:24px;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.dbs-goalStatus{font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.dbs-goalCriteria{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px}
.dbs-goalCriteria li{display:flex;gap:8px;align-items:baseline;line-height:22px;overflow-wrap:anywhere}
.dbs-goalCriteria li span:first-child{flex:none;color:var(--dsw-alias-label-secondary)}
.dbs-goalActions{display:flex;flex-wrap:wrap;gap:8px}
.dbs-goalForm{display:flex;flex-direction:column;gap:14px}
.dbs-goalForm label{display:flex;flex-direction:column;gap:6px;font-size:13px;line-height:20px}
.dbs-goalForm textarea{box-sizing:border-box;width:100%;resize:vertical;min-height:80px;padding:10px 12px;font:inherit;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-specific-input-major,var(--dsw-alias-bg-base))}
.dbs-goalPanel :is(button,textarea,select,summary):focus-visible,.dbs-goalTabs button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:3px}
.dbs-goalPanel summary{cursor:pointer;font-size:13px;line-height:22px}
.dbs-goalPanel details pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:13px;line-height:22px;max-height:320px;overflow:auto}
.dbs-goalRun{padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px;line-height:20px;overflow-wrap:anywhere}
@media(max-width:600px){.dbs-goalPanel{padding:16px 12px}.dbs-goalCard{padding:14px}.dbs-goalHeader{align-items:flex-start}}

.dbs-chatview{position:relative;flex:1;min-height:0;pointer-events:auto;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);font-family:var(--dsw-font-family,inherit);z-index:2;--dsh-chat-content-width:var(--dsh-chat-user-width,clamp(680px,calc(var(--dsh-conversation-column-width,0px)*.64),920px));--dsh-composer-card-max-width:calc(var(--dsh-chat-content-width) + 32px);--dsh-composer-side-clearance:16px;--dsh-composer-dock-inset:8px;--dsh-composer-text-max-height:336px;min-width:0}
/* Not a standalone block: shrink to the chips/images, hug the text end in
   bot rows and the bubble's right edge in user messages. */
.dbs-mediaRefs{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;align-items:center;width:fit-content;max-width:100%}
.dbs-bubble .dbs-mediaRefs{margin-left:auto}
.dbs-mediaImg{max-width:280px;max-height:210px;border-radius:10px;cursor:zoom-in;display:block;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08))}
.dbs-mediaLoading{width:28px;height:20px;display:inline-flex;align-items:center;color:var(--dsw-alias-label-tertiary);animation:dbsSpin .8s linear infinite}
.dbs-fileChip{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);cursor:pointer;max-width:100%;user-select:none;vertical-align:middle;margin:0 1px}
.dbs-fileChip:hover{color:var(--dsw-alias-label-primary)}
.dbs-fileChipName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px}
.dbs-setLabel{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary);margin:8px 0 4px}
.dbs-select{height:28px;min-width:200px;padding:0 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-1,#fff));color:var(--dsw-alias-label-primary);font-size:13px;line-height:28px;outline:none}
.dbs-chatbar{flex:none;display:flex;align-items:center;gap:8px;height:44px;padding:0 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08))}
.dbs-chatbarName{font-size:14px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.dbs-scrollBody{scrollbar-gutter:stable;flex-direction:column;flex:1;min-height:0;display:flex;overflow:hidden auto}
/* NO overflow here: the scrollBody above is the one and only scroller, so the
   ref it carries is the element scrollTo/stick-to-bottom actually move. */
.dbs-scroll{min-height:0;padding:16px calc(var(--dsh-composer-side-clearance) + 16px);flex:0 0 auto;container-type:inline-size}
.dbs-flowItem{min-width:0}
.dbs-column{max-width:var(--dsh-chat-content-width);flex-direction:column;gap:16px;width:100%;margin:0 auto;display:flex}
.dbs-userRow{flex-direction:column;align-items:flex-end;gap:6px;display:flex}
/* Native user bubble geometry: 70.2% of the content column (or 82%, whichever
 * is narrower), 14px/22px content type, wrapping instead of overflowing. */
.dbs-userStack{flex-direction:column;align-items:flex-end;gap:8px;min-width:0;max-width:min(calc(var(--dsh-chat-content-width,748px) * .702),82%);display:flex}
.dbs-bubble{background:var(--dsw-specific-bubble,var(--dsw-alias-bg-layer-2,rgba(0,0,0,.05)));max-width:100%;color:var(--dsw-alias-label-primary);border-radius:22px;padding:10px 16px;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));white-space:pre-wrap;word-break:break-word;box-sizing:border-box}
/* Image messages: the picture floats without the text bubble chrome, the
 * way native IMs render an attached screenshot (rounded, self-sized). */
.dbs-bubble.dbs-bubbleImg{padding:0;background:transparent;border-radius:14px}
.dbs-bubbleImg .dbs-mediaImg{max-width:min(280px,62vw);max-height:260px;margin-left:auto}
/* Composer attach affordance + pending strip. */
.dbs-attachBtn{corner-shape:round;background:var(--dsw-specific-selector,var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06)));width:28px;height:28px;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;border-radius:999px;flex:none;place-items:center;display:grid;padding:0}
.dbs-attachBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}
.dbs-attachBtn:disabled{opacity:.5;cursor:default}
/* Composer attachment rail, matching the shipped ComposerAttachments:
   64px rounded-16 thumbnails in a scroll rail, the remove control a round
   contrast-fill button that stays hidden until the item is hovered. */
.dbs-pendingImgs{display:flex;align-items:stretch;gap:10px;min-width:0;padding:2px 10px 0;margin-bottom:-6px;overflow:auto hidden;scrollbar-width:none}
.dbs-pendingImgs::-webkit-scrollbar{display:none}
.dbs-pendingImg{position:relative;flex:none;width:64px;height:64px}
.dbs-pendingImgThumb{border:.5px solid var(--dsw-alias-border-l2-darkmode-thin,rgba(0,0,0,.12));background:var(--dsw-alias-interactive-bg-hover);border-radius:16px;width:64px;height:64px;padding:0;overflow:hidden}
.dbs-pendingImgThumb img{object-fit:cover;width:100%;height:100%;display:block}
.dbs-pendingImgX{z-index:1;font-size:12px;line-height:1;corner-shape:round;background:var(--dsw-alias-button-contrast-fill,rgba(0,0,0,.6));width:18px;height:18px;color:var(--dsw-alias-label-primary-inverted,#fff);cursor:pointer;opacity:0;border:none;border-radius:50%;place-items:center;padding:0;transition:opacity .2s ease-in-out;display:grid;position:absolute;top:4px;right:4px}
.dbs-pendingImg:hover .dbs-pendingImgX,.dbs-pendingImgX:focus-visible{opacity:1}
@media (pointer:coarse){.dbs-pendingImgX{opacity:1}}
@media (prefers-reduced-motion:reduce){.dbs-pendingImgX{transition:none}}
/* Assistant output follows the native flow: content font variables, no bubble
 * chrome, and the author line kept as quiet as a native system row so the
 * name reads as attribution, not as a chat header. */
.dbs-botRow{color:var(--dsw-alias-label-primary);flex-direction:column;font-size:var(--dsh-content-font-size,14px);line-height:calc(24px + var(--dsh-content-font-delta,0px));display:flex;align-items:flex-start;gap:4px;width:100%;box-sizing:border-box}
.dbs-author{font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(18px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:6px;font-weight:500;margin-bottom:2px;flex-wrap:wrap}
.dbs-authorName{font-weight:500}
.dbs-md{min-width:0}
.dbs-md p{margin:0 0 8px}
.dbs-md p:last-child{margin-bottom:0}
.dbs-md h1,.dbs-md h2,.dbs-md h3,.dbs-md h4{margin:12px 0 6px;line-height:1.35;font-weight:600}
.dbs-md h1{font-size:20px}.dbs-md h2{font-size:18px}.dbs-md h3{font-size:16px}.dbs-md h4{font-size:15px}
.dbs-md ul,.dbs-md ol{margin:0 0 8px;padding-left:22px}
.dbs-md li{margin:2px 0}
.dbs-md code{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:.9em;background:var(--dsw-alias-markdown-code-block,var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06)));border-radius:6px;padding:1px 5px}
.dbs-md pre{margin:0 0 10px;background:var(--dsw-alias-markdown-code-block,var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06)));border:0;border-radius:12px;padding:12px 14px;overflow-x:auto;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:var(--dsw-font-markdown-code-block-small-font-size,11px);line-height:var(--dsw-font-markdown-code-block-small-line-height,16px)}
.dbs-md .dbs-imglink{display:inline-block;max-width:min(320px,100%);border-radius:10px;overflow:hidden;margin:4px 0;box-shadow:0 1px 4px rgba(0,0,0,.25);cursor:zoom-in}
.dbs-md .dbs-imglink img{display:block;width:100%;height:auto}
.dbs-md pre code{background:transparent;padding:0;font-size:1em}
.dbs-md blockquote{margin:0 0 8px;padding:2px 0 2px 10px;border-left:3px solid var(--dsw-alias-border-l2,rgba(0,0,0,.2));color:var(--dsw-alias-label-secondary)}
.dbs-md a{color:var(--dsw-alias-state-business-primary,#1a6dff)}
.dbs-md hr{border:none;border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.15));margin:10px 0}
.dbs-plain{white-space:pre-wrap;word-break:break-word}
/* Tool + thinking rows rebuilt on the native ToolRow/ReasoningRow anatomy:
 * one 24px line — 16px leading glyph, tool name, 2×2 dot separator,
 * tertiary 13px summary, duration chip — with the shipped sweep highlight
 * while running and an ioCard-style expandable body. */
.dbs-toolRow,.dbs-thinkRow{flex-direction:column;display:flex;min-width:0}
.dbs-toolRowLine{position:relative;display:flex;align-items:center;overflow:hidden;min-width:0;line-height:24px;border-radius:6px}
.dbs-toolRowLine[role="button"]{cursor:pointer}
.dbs-toolRowLine[role="button"]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04))}
.dbs-toolRow[data-state="running"] .dbs-toolRowLine:after,.dbs-thinkRow[data-state="running"] .dbs-toolRowLine:after{content:"";position:absolute;top:0;bottom:0;left:0;width:300px;background:linear-gradient(90deg,transparent 0%,color-mix(in srgb,var(--dsw-alias-bg-base) 60%,transparent) 55%,transparent 100%);pointer-events:none;animation:2.6s ease-out infinite dbs-row-sweep}
@keyframes dbs-row-sweep{0%{left:-300px}90%,to{left:100%}}
@media (prefers-reduced-motion:reduce){.dbs-toolRow[data-state="running"] .dbs-toolRowLine:after,.dbs-thinkRow[data-state="running"] .dbs-toolRowLine:after{animation:none}}
.dbs-toolLead{flex:none;display:flex;align-items:center;color:var(--dsw-alias-label-secondary)}
.dbs-toolRow[data-state="error"] .dbs-toolLead,.dbs-toolRow[data-state="error"] .dbs-toolSummary{color:var(--dsw-alias-state-error-primary)}
.dbs-toolTitle{font-weight:400;flex:none}
.dbs-toolSep{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 8px}
.dbs-toolSummary{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:var(--dsh-content-font-size-secondary,13px);line-height:24px;color:var(--dsw-alias-label-tertiary);flex:auto;overflow:hidden}
.dbs-toolSummary[data-follow-end]{justify-content:flex-end;display:flex;text-overflow:clip;flex:none;width:max-content;min-width:100%;overflow:visible;text-align:start}
.dbs-toolDuration{font-family:var(--ds-font-family-code,monospace);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);color:var(--dsw-alias-label-caption);flex:none;margin-left:10px;transform:translateY(.5px);font-variant-numeric:tabular-nums}
.dbs-toolChevron{flex:none;display:flex;align-items:center;color:var(--dsw-alias-label-secondary);margin-left:4px}
.dbs-toolBody{margin:4px 0 4px 4px;border:.5px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));background:var(--dsw-alias-markdown-code-block,var(--dsw-specific-bubble,var(--dsw-alias-bg-layer-2,rgba(0,0,0,.05))));border-radius:12px;padding:12px 16px;font:var(--dsw-font-markdown-code-block-small);max-height:260px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary)}
.dbs-thinkBody{padding:4px 0 4px calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:pre-wrap;word-break:break-word}
.dbs-thinkRow .dbs-toolRowLine{border:0;background:none;color:var(--dsw-alias-label-tertiary);font:inherit;padding:0;cursor:pointer;text-align:left;width:100%}
.dbs-thinkRow .dbs-toolRowLine:hover{color:var(--dsw-alias-label-secondary)}
.dbs-thinkRow .dbs-toolLead{color:inherit}
/* The reasoning row keeps the native ReasoningRow metrics: a 20px secondary
   summary line (not the tool row's 24px), with the chevron always shown. */
.dbs-thinkRow .dbs-toolSummary{line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}
.dbs-thinkRow .dbs-toolChevron{opacity:1}
/* File-change (diff) body: hunk headers stay quiet, added/removed lines get
   the semantic state tints the tool row already uses for ok/error. */
.dbs-diffStat{font-family:var(--ds-font-family-code,monospace);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);color:var(--dsw-alias-label-caption);flex:none;margin-left:10px;transform:translateY(.5px);font-variant-numeric:tabular-nums}
.dbs-diff{font-family:var(--ds-font-family-code,monospace);font-size:12px;line-height:18px;white-space:pre;overflow-x:auto;padding:2px 0}
.dbs-diffLine{display:block;padding:0 6px;border-radius:3px}
.dbs-diffLine[data-kind="add"]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);color:var(--dsw-alias-state-success-primary)}
.dbs-diffLine[data-kind="del"]{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary)}
.dbs-diffLine[data-kind="meta"]{color:var(--dsw-alias-label-tertiary)}
.dbs-diffLine[data-kind="ctx"]{color:var(--dsw-alias-label-secondary)}
/* Message actions: the shipped MessageIconActions — a 28px round icon row
   that stays invisible until the message is hovered or focused. */
.dbs-actions{height:calc(28px + var(--dsh-content-font-delta,0px));align-items:center;gap:8px;display:flex;opacity:0;transition:opacity 80ms}
.dbs-botRow:hover .dbs-actions,.dbs-botRow:focus-within .dbs-actions,.dbs-userRow:hover .dbs-actions,.dbs-userRow:focus-within .dbs-actions{opacity:1}
@media (hover:none){.dbs-actions{opacity:1}}
.dbs-action{width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:28px;justify-content:center;align-items:center;padding:6px;display:inline-flex}
.dbs-action svg{width:calc(15px + var(--dsh-content-font-delta,0px));height:calc(15px + var(--dsh-content-font-delta,0px))}
.dbs-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dbs-actionTime{font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.dbs-msgTime{flex:none;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(18px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums;user-select:none;white-space:nowrap}
.dbs-userRow .dbs-msgTime,.dbs-botRow .dbs-msgTime{padding:0 4px}
.dbs-dayDivider{display:flex;align-items:center;justify-content:center}
.dbs-dayDivider span{padding:2px 10px;border-radius:999px;background:var(--dsw-specific-bubble,var(--dsw-alias-bg-layer-2,rgba(0,0,0,.05)));color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;user-select:none}
.dbs-turnStatus{height:calc(26px + var(--dsh-content-font-delta,0px));font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));font-weight:400;white-space:nowrap;background:linear-gradient(90deg,var(--dsw-static-deepseek-500,#4d6bfe) 0%,var(--dsw-static-deepseek-500,#4d6bfe) 40%,var(--dsw-static-deepseek-200,#b6c2ff) 50%,var(--dsw-static-deepseek-500,#4d6bfe) 60%,var(--dsw-static-deepseek-500,#4d6bfe) 100%);color:#0000;-webkit-text-fill-color:transparent;background-position:100% 0;background-size:250% 100%;-webkit-background-clip:text;background-clip:text;flex:none;align-self:flex-start;align-items:center;animation:1.8s linear infinite dbs-turn-status-shimmer;display:inline-flex}
@keyframes dbs-turn-status-shimmer{to{background-position:0 0}}
@media (prefers-reduced-motion:reduce){.dbs-turnStatus{background-position:0 0;background-size:100% 100%;animation:none}.dbs-arrow{transition:none}}
.dbs-composerSeat{flex:none;display:flex;flex-direction:column;z-index:7;background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-bg-base) 0%,transparent) 0px,var(--dsw-alias-bg-base) 36px)}
/* Composer chrome mirrors the shipped InputBar: no border (the stroke comes
 * from the elevation system), elevation-soft shadow, 8px top padding, and the
 * shell's content font variables so a font-size setting moves us too. */
.dbs-composer{padding:0 var(--dsh-composer-side-clearance) 8px;flex-direction:column;align-items:center;display:flex}
.dbs-composerCard{cursor:text;box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width);--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-1,#fff));box-shadow:var(--dsw-elevation-soft,0 2px 8px rgba(0,0,0,.08));border:0;border-radius:22px;flex-direction:column;gap:12px;padding-top:8px;font-size:var(--dsh-content-font-size,14px);line-height:calc(24px + var(--dsh-content-font-delta,0px));display:flex;position:relative}
.dbs-composerScroll{max-height:var(--dsh-composer-text-max-height,220px);margin-right:4px;overflow-y:auto}
.dbs-composerRow{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;min-width:0;padding:2px 8px 6px;display:flex}
.dbs-composerTools{align-items:center;min-width:0;display:flex;gap:12px}
.dbs-composerTrailing{align-items:center;min-width:0;display:flex;flex:none;gap:12px;margin-left:auto}
.dbs-composerInput{resize:none;display:block;width:100%;box-sizing:border-box;border:none;outline:none;background:transparent;font-family:var(--dsw-font-family);font-size:inherit;line-height:inherit;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;caret-color:var(--dsw-alias-state-business-primary);padding:4px 8px 0 14px;min-height:36px;max-height:var(--dsh-composer-text-max-height,220px);overflow-y:auto;field-sizing:content;color:var(--dsw-alias-label-primary)}
.dbs-composerInput::placeholder{color:var(--dsw-alias-label-caption);user-select:none}
.dbs-send{corner-shape:round;background:var(--dsw-alias-button-info-fill,#1a6dff);color:#fff;cursor:pointer;border:none;border-radius:999px;flex:none;place-items:center;width:34px;height:34px;transition:background-color .1s;display:grid;transform:translateY(-2px)}
.dbs-send:hover:not(:disabled){background:var(--dsw-alias-button-info-hover,var(--dsw-alias-button-info-fill,#1a6dff))}
.dbs-send:disabled{opacity:.4;cursor:default}
.dbs-modalBackdrop{position:fixed;inset:0;z-index:1000;background:var(--dsw-alias-bg-mask-1,var(--dsw-alias-bg-overlay,rgba(0,0,0,.45)));backdrop-filter:var(--dsw-mask-blur,none);display:flex;align-items:center;justify-content:center;padding:24px;pointer-events:auto}
.dbs-modalCard{position:relative;width:min(440px,calc(100vw - 48px));max-height:calc(100vh - 48px);overflow-y:auto;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1,#fff));--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);border:0;border-radius:20px;padding:20px 20px 22px;box-shadow:var(--dsw-elevation-prominent,var(--dsw-shadow-lv3,0 24px 80px rgba(0,0,0,.3)));animation:dbs-modal-in .18s ease-out}
/* Confirm-class dialogs carry one sentence, not a form: 440px reads as a
   billboard. Native confirms sit ~340-360px, so the delete dialog narrows —
   and drops the form chrome entirely: no title bar, no close X, uniform
   padding. The message IS the dialog (Escape/backdrop still dismiss). */
.dbs-modalCard.dbs-modalNarrow{width:min(360px,calc(100vw - 48px));padding:20px}
.dbs-confirmText{font-size:15px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary)}
@keyframes dbs-modal-in{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}
.dbs-modalTitleRow{display:flex;align-items:center;gap:8px;margin-bottom:14px}
.dbs-modalTitle{font-size:16px;line-height:22px;font-weight:500;color:var(--dsw-alias-label-primary);flex:1;min-width:0}
.dbs-modalBody{display:flex;flex-direction:column;gap:10px}
.dbs-modalMembers{display:flex;flex-direction:column;gap:2px;max-height:240px;overflow-y:auto;background:var(--dsw-alias-bg-layer-1,transparent);border:0;border-radius:14px;padding:4px}
.dbs-modalFooter{display:flex;justify-content:flex-end;align-items:center;gap:12px;margin-top:18px}
.dbs-rowMore{display:none;border:none;background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;width:24px;height:24px;border-radius:6px;padding:0}
.dbs-rowMore:hover,.dbs-rowMore:focus-visible{color:var(--dsw-alias-label-primary);background:transparent}
.dbs-srow:hover .dbs-rowMore,.dbs-rowMore:focus-visible,.dbs-srow[data-menu="true"] .dbs-rowMore{display:inline-flex}
.dbs-srow{position:relative}
.dbs-rowMenu{position:absolute;top:calc(100% - 2px);right:4px;z-index:40}
.dbs-rowMenu.dbs-flipUp{top:auto;bottom:calc(100% + 2px)}
/* Same quiet-hover contract for the section-header action buttons. */
.dbs-secHead .dbs-rowActions button:hover,.dbs-secHead .dbs-rowActions button:focus-visible{background:transparent}
/* Trigger menu (@ list), matching the shipped MenuView: specific-menu
   surface with an elevation stroke, 20px radius, 320px cap, 40px rows, a
   tertiary description column and a Tab drill hint on the active row. */
.dbs-mention{z-index:100;background:var(--dsw-specific-menu,var(--dsw-alias-bg-overlay,var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-1))));--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);max-height:320px;box-shadow:var(--dsw-elevation-prominent,var(--dsw-shadow-lv2));border:0;border-radius:20px;flex-direction:column;padding:4px;display:flex;position:absolute;bottom:calc(100% + 4px);left:0;right:0;overflow:hidden}
.dbs-mentionViewport{flex-direction:column;min-height:0;overflow-y:auto;display:flex}
.dbs-mentionRow{cursor:pointer;width:100%;min-height:40px;color:var(--dsw-alias-label-primary);text-align:left;background:0 0;border:none;border-radius:10px;align-items:center;gap:8px;padding:8px 10px;font-size:14px;line-height:22px;display:flex}
.dbs-mentionRow[data-active="true"],.dbs-mentionRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dbs-mentionIcon{width:16px;height:16px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;display:inline-flex}
.dbs-mentionName{text-overflow:ellipsis;white-space:nowrap;flex:none;max-width:40%;overflow:hidden}
.dbs-mentionDesc{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-tertiary);flex:1;overflow:hidden}
.dbs-mentionHint{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-caption);border-radius:4px;padding:0 5px;font-family:inherit;font-size:11px;line-height:18px;flex:none;margin-left:auto;display:none}
.dbs-mentionRow[data-active="true"] .dbs-mentionHint{display:inline-flex}
.dbs-empty{color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:22px;text-align:center;padding:32px 0}
.dbs-scrollArea{position:relative;flex:1;min-height:0;display:flex;flex-direction:column}
.dbs-scrollBody::-webkit-scrollbar{width:10px}
.dbs-scrollBody::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,rgba(0,0,0,.18));border-radius:5px;border:3px solid transparent;background-clip:content-box}
.dbs-scrollBody::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-label-caption,var(--dsw-alias-border-l2,rgba(0,0,0,.25)));border:3px solid transparent;background-clip:content-box}
.dbs-scrollBody::-webkit-scrollbar-track{background:transparent}
.dbs-jump{--dsw-elevation-stroke-color:var(--dsw-alias-border-l3);corner-shape:round;position:absolute;left:50%;bottom:10px;transform:translateX(-50%);display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:100px;border:0;background:var(--dsw-alias-button-floating-fill,var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-1,#fff)));box-shadow:var(--dsw-elevation-panel,var(--dsw-shadow-lv2));color:var(--dsw-alias-label-primary);cursor:pointer;z-index:5;transition:opacity .15s ease,transform .15s ease}
.dbs-jump:hover{background:var(--dsw-alias-button-floating-hover,var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-1,#fff)));transform:translate(-50%,-1px)}
.dbs-jump[data-show="false"]{opacity:0;pointer-events:none;transform:translate(-50%,4px)}
/* Turn rail (native TurnNavigatorRail): a right-edge column of turn ticks —
   2px tall, 12px wide, right-aligned, the active one primary and wider — that
   jumps the stream to a turn. Fades at both ends when it overflows. */
.dbs-rail{position:absolute;top:50%;right:6px;width:28px;height:min(calc(100% - 96px),420px);cursor:pointer;pointer-events:auto;transform:translateY(-50%);z-index:6}
.dbs-railScroll{position:absolute;inset:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none}
.dbs-railScroll::-webkit-scrollbar{display:none}
.dbs-railFadeTop{mask-image:linear-gradient(#0000 0,#000 24px 100%)}
.dbs-railFadeBottom{mask-image:linear-gradient(#000 0 calc(100% - 24px),#0000 100%)}
.dbs-railFadeTop.dbs-railFadeBottom{mask-image:linear-gradient(#0000 0,#000 24px calc(100% - 24px),#0000 100%)}
.dbs-railMarks{position:relative;height:100%}
.dbs-railMark{position:absolute;right:0;width:20px;height:10px;background:0 0;border:0;border-radius:8px;padding:0;cursor:pointer;transform:translateY(-50%)}
.dbs-railMark:before{background:var(--dsw-alias-border-l4,rgba(0,0,0,.18));content:"";border-radius:2px;width:12px;height:2px;transition:width .14s,background-color .14s;position:absolute;top:50%;right:0;transform:translateY(-50%)}
.dbs-railMark:hover:before,.dbs-railMark:focus-visible:before{background:var(--dsw-alias-state-business-primary);width:18px}
.dbs-railMark[data-active="true"]:before{background:var(--dsw-alias-label-primary);width:20px}
.dbs-railMark[data-busy="true"]:before{animation:1s ease-in-out infinite dbsRailBusy}
@keyframes dbsRailBusy{0%,100%{opacity:.35}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){.dbs-railMark[data-busy="true"]:before{animation:none}}
/* In-flight turn status, rebuilt on the native TurnStatus row: the shimmering
 * "深度求索中..." label over the DeepSeek gradient plus a tabular elapsed
 * clock that only appears past the native 15s threshold. */
.dbs-typing{display:inline-flex;align-items:center;gap:8px;padding:2px 0;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px))}
.dbs-turnStatusClock{font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-caption);font-weight:400}
@keyframes dbsSpin{to{transform:rotate(360deg)}}
.dbs-mdRow{display:flex;align-items:flex-start;gap:0;min-width:0;width:100%}
.dbs-caret{flex:none;display:inline-block;width:3px;height:18px;margin-top:5px;border-radius:2px;background:var(--dsw-alias-label-primary);animation:dbsCaret 1s steps(2) infinite}
@keyframes dbsCaret{0%,49%{opacity:1}50%,100%{opacity:0}}
.dbs-botRow[data-compact="true"]{padding-left:30px}
.dbs-compactTime{display:flex;justify-content:flex-end;width:100%}
.dbs-compactTime .dbs-msgTime{padding:0}
.dbs-welcome{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:6px;padding:64px 24px 32px;min-height:50%}
.dbs-welcomeName{font-size:18px;line-height:26px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dbs-welcomeDesc{font-size:14px;line-height:22px;color:var(--dsw-alias-label-secondary);max-width:420px}
.dbs-welcomeHint{font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary);margin-top:12px}
.dbs-skeleton{display:flex;flex-direction:column;gap:18px;padding:24px 0;max-width:560px}
.dbs-skelRow{height:16px;border-radius:8px;background:linear-gradient(90deg,var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06)) 25%,var(--dsw-alias-border-l1,rgba(0,0,0,.08)) 50%,var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06)) 75%);background-size:200% 100%;animation:dbsShimmer 1.4s ease-in-out infinite}
@keyframes dbsShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.dbs-composerCard:focus-within{--dsw-elevation-stroke-color:var(--dsw-alias-border-l2)}

.dbs-settings{padding:0 0 24px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,inherit);display:flex;flex-direction:column;gap:12px}
/* Native section header pattern (ModelsSection): 16px/500 title over a
 * 14px/22px tertiary intro. */
.dbs-settingsTitle{font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary);margin:0}
.dbs-settingsIntro{font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary)}
/* Tabs follow the native conversation-header tab anatomy: no rail border, a
 * 13px/500 tertiary label, 36px gaps, and a 2px business underline on the
 * active tab only. */
.dbs-settingsTabs{display:flex;align-items:flex-end;gap:36px;overflow-x:auto;scrollbar-width:none}
.dbs-settingsTabs::-webkit-scrollbar{display:none}
.dbs-settingsTab{position:relative;flex:none;padding:0 0 9px;border:0;background:none;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;font-weight:500;line-height:16px;cursor:pointer}
.dbs-settingsTab:hover{color:var(--dsw-alias-label-primary)}
.dbs-settingsTab[aria-selected="true"]{color:var(--dsw-alias-state-business-primary)}
.dbs-settingsTab[aria-selected="true"]:after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;border-radius:2px;background:var(--dsw-alias-state-business-primary)}
.dbs-settingsTab:focus-visible,.dbs-settings :is(button,input,textarea,select):focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dbs-settingsPanel{display:flex;flex-direction:column;gap:10px;min-width:0;padding-top:2px}
.dbs-settingsPanel[hidden]{display:none}
/* Cards mirror the native settings rowCard: .5px l4 border, 16px radius,
 * 12px 14px padding, 12px gap, no fill. */
.dbs-setcard{border:.5px solid var(--dsw-alias-border-l4,var(--dsw-alias-border-l2));border-radius:16px;padding:12px 14px;display:flex;flex-direction:column;gap:12px;min-width:0}
.dbs-setcard .dbs-setcard{background:var(--dsw-alias-bg-layer-1);margin:4px 0}
.dbs-sethead{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);font-weight:500}
.dbs-sethead .dbs-title{margin:0}
.dbs-setrow{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-secondary);min-width:0;overflow-wrap:anywhere}
.dbs-setrow b{color:var(--dsw-alias-label-primary);font-weight:500;word-break:break-word}
.dbs-setcard>.dbs-setrow+.dbs-setrow{border-top:.5px solid var(--dsw-alias-border-l2);padding-top:9px}
.dbs-settings .dbs-select{height:32px;margin-left:auto;border-color:var(--dsw-alias-border-l4);border-radius:8px}
.dbs-settings textarea{box-sizing:border-box}
@media(max-width:600px){.dbs-settingsTabs{gap:16px}.dbs-setcard{padding:12px}.dbs-settings .dbs-select{width:100%;margin-left:0;min-width:0}}

`

      // =========================================================
      // Locale.
      //
      // Registered into the shell's own locale runtime under the `bots`
      // namespace, so language follows the app-wide preference instead of
      // stranding this plugin in one language. `zh` is the key-set source of
      // truth; `en` mirrors it exactly. Wire error strings from the gateway
      // pass through untranslated, matching how the shipped packages treat
      // runtime failure text.
      // =========================================================
      const NS = 'bots'

      const zh: Record<string, string> = {
        'goal.chooseBot': '从侧栏选择一个 Bot，开始对话或创建目标。',
        'goal.views': '会话视图',
        'goal.chat': '对话',
        'goal.title': '目标',
        'goal.retrySetup': '重试创建',
        'goal.refresh': '刷新状态',
        'goal.intro': '把目标和验收标准交给 Bot，关闭页面后仍会按设定间隔推进。',
        'goal.new': '创建目标',
        'goal.objective': '希望完成什么？',
        'goal.criteria': '验收标准（每行一条）',
        'goal.interval': '推进间隔',
        'goal.minutes': '每 {n} 分钟',
        'goal.start': '开始持续推进',
        'goal.working': '正在保存…',
        'goal.loading': '正在读取目标…',
        'goal.pause': '暂停目标',
        'goal.resume': '恢复推进',
        'goal.complete': '确认验收通过',
        'goal.revise': '退回继续改进',
        'goal.cancel': '结束目标',
        'goal.cancelConfirm': '确认结束此目标？',
        'goal.keep': '保留目标',
        'goal.feedback': '还需要完成什么？',
        'goal.sendFeedback': '保存并继续推进',
        'goal.progress': 'Bot 声明已满足 {done}/{total} 条 · 第 {cycle} 轮',
        'goal.reviewHint': '请核对下方证据与实际产物，再确认验收；Bot 的完成声明尚未经过独立验证。',
        'goal.checkpoint': '进展与证据（Bot 记录）',
        'goal.noEvidence': '尚无进展记录。首轮运行后在这里查看证据和下一步。',
        'goal.history': '运行历史',
        'goal.next': '下次计划：{time}',
        'goal.scheduled': '等待下一轮',
        'goal.running': '正在推进',
        'goal.paused': '已暂停',
        'goal.blocked': '需要处理阻塞',
        'goal.review': '等待验收',
        'goal.completed': '已验收完成',
        'goal.cancelled': '已结束',
        'goal.attention': '需要检查',
        'goal.runOk': '本轮已结束',
        'goal.runError': '本轮失败',
        'nav.workspaces': '工作区',
        'nav.bots': 'Bots',
        'nav.bots.aria': 'Bots',
        'nav.bots.unread': 'Bots（{n} 条未读）',
        'delegate.loading': '加载中…',
        'delegate.unavailable': '工作区视图不可用，请刷新页面。',
        'delegate.failed': '工作区视图加载失败，Bots 不受影响。',
        'gateway.online': '网关在线 :{port}',
        'gateway.offline': '网关未连接',
        'gateway.offlineHint': '网关未连接，详见设置页。',
        'bot.new': '新建 Bot',
        'group.new': '新建群聊',
        'bot.namePlaceholder': 'Bot 名称',
        'group.namePlaceholder': '群聊名称',
        'bot.descPlaceholder': '简介 / 人设（可选）',
        'action.create': '创建',
        'action.cancel': '取消',
        'action.close': '关闭',
        'action.save': '保存',
        'action.saving': '保存中…',
        'action.stop': '停止生成',
        'chat.stop.noop': '当前没有进行中的生成',
        'media.openFailed': '打开失败，文件可能已移动或被删除',
        'chat.members.manage': '管理成员',
        'chat.members.cap': '已达群成员上限 {cap} 人——可在会话设置里调高',
        'chat.settings': '设置',
        'chat.settings.title': '会话设置',
        'chat.settings.name': '名称',
        'chat.settings.desc': '简介',
        'chat.settings.workspace': '工作区隔离',
        'chat.settings.root': '工作区根目录',
        'chat.settings.rootPh': '留空 = 不启用',
        'chat.settings.paths': '额外可写路径（逗号分隔）',
        'chat.settings.pathsPh': '/tmp/xxx, /Users/you/shared',
        'chat.settings.hint': '写入被沙盒限制在工作区（含额外路径）内，读取不受限；同 slug 的 Bot 共享同一目录。',
        'settings.group.title': '群聊',
        'settings.group.cap': '成员上限',
        'settings.group.capHint': '全局生效：新建群与编辑群名单时使用（1–16）。已有群的现有名单不会被改动。',
        'modal.members.title': '管理群成员',
        'modal.members.hint': '勾选的 Bot 为群成员；保存后立即生效（可随时再改）。',

        'action.pin': '置顶',
        'action.unpin': '取消置顶',
        'action.delete': '删除',
        'delete.title.bot': '删除 Bot',
        'delete.title.group': '删除群聊',
        'delete.confirm': '将删除「{name}」及其全部会话记录，此操作不可恢复。',
        'delete.working': '删除中…',
        'action.send': '发送',
        'action.refresh': '刷新',
        'list.loading': '加载中…',
        'list.empty.hidden': '所有会话都隐藏在侧栏之外。',
        'modal.members.empty': '没有可添加的单聊成员。',
        'list.unhideAll': '全部显示',
        'section.groups': '群聊',
        'list.more': '更多操作',
        'list.refresh': '刷新列表',
        'section.singles': '单聊',
        'chat.group': '群聊 · {n} 名成员',
        'chat.single': '单聊',
        'chat.loading': '加载中…',
        'chat.empty.single': '给 {name} 发第一条消息，开始你们的对话',
        'chat.empty.group': '在群里说点什么，成员们会接龙回复',
        'chat.jump': '回到底部',
        'chat.composing': '深度求索中...',
        'chat.thinking': '思考',
        'action.copy': '复制',
        'action.copied': '已复制',
        'chat.queuedSend': '排队发送',
        'duration.seconds': '{seconds}秒',
        'duration.minutes': '{minutes}分{seconds}秒',
        'chat.placeholder.group': '@名字 可定向，默认全员',
        'chat.placeholder.single': '给 {name} 发消息…',
        'chat.placeholder.busy': '生成中… 发送将排队，当前回合结束后送达',
        'chat.attach': '添加图片',
        'chat.attach.remove': '移除图片',
        'chat.attach.limit': '一次最多 4 张图片',
        'time.today': '今天',
        'time.yesterday': '昨天',
        'time.date': '{m} 月 {d} 日',
        'time.dateFull': '{y} 年 {m} 月 {d} 日',
        'tool.fallbackName': '工具',
        'settings.summary': '多 Bot 工作台，桥接 sdk-bots 编排网关。',
        'settings.tab.overview': '概览',
        'settings.tab.models': '模型',
        'settings.tab.workspace': '工作区',
        'settings.tab.mcp': 'MCP',
        'settings.tab.skills': '技能',
        'settings.tabs': 'Bots 设置页签',
        'settings.probing': '检测中…',
        'settings.address': '地址：',
        'settings.pid': 'PID：',
        'settings.busy': '忙',
        'settings.idle': '闲',
        'settings.auth': '鉴权：',
        'settings.auth.token': 'token（自动携带）',
        'settings.auth.none': '无（loopback 免鉴权）',
        'settings.reason': '原因：',
        'settings.reason.unknown': '未知',
        'settings.dataDir': '数据目录：',
        'settings.reading': '读取中…',
        'settings.events': '实时事件：',
        'settings.events.on': '已连接 · 缓冲 {n} 条',
        'settings.events.off': '未连接',
        'settings.entry': '入口：',
        'settings.entry.value': '左侧边栏「工作区 ｜ Bots」折叠导航',
        'settings.model.title': '模型配置',
        'settings.model.current': '当前模型',
        'settings.model.auto': 'auto（freeroute 默认）',
        'settings.model.engineDefault': '引擎默认（未设置）',
        'settings.model.freeroute': 'freeroute 自动路由（默认）',
        'settings.model.pick': '选择模型',
        'settings.model.provider': '提供方',
        'settings.model.hint': '引擎只在启动时读取模型环境变量，所以选择模型后要点「应用并重启引擎」才会真正生效（重启会中断正在进行的回合）。左侧「当前模型」是引擎下次启动将使用的值。',
        'settings.model.offline': 'freeroute 不可达——已回退当前默认模型',
        'settings.model.saving': '保存中…',
        'settings.model.engine': '引擎实际模型',
        'settings.model.engineUnset': '未设置（环境变量缺省）',
        'settings.model.engineApply': '应用并重启引擎',
        'settings.model.engineApplying': '重启中…',
        'settings.model.engineRestarted': '已重启并生效',
        'settings.model.applyFailed': '应用失败——引擎没有重启成功，模型选择未生效：',
        'settings.skills': '技能',
        'settings.skills.summary': '技能是可复用的指令库（SKILL.md，与 DSH 同格式）。Bot 在系统提示里看到技能库路径并自行读取；消息里 @技能名 会把该技能正文注入上下文。库全局共享，启停按 Bot 生效。',
        'settings.skills.empty': '暂无技能——新建一个，或粘贴 markdown 导入',
        'settings.skills.add': '新建技能',
        'settings.skills.import': '导入 markdown',
        'settings.skills.importing': '导入中…',
        'settings.skills.namePlaceholder': '技能名，例如 weekly-report',
        'settings.skills.descPlaceholder': '一句话说明何时使用（会随库路径提示给 Bot）',
        'settings.skills.bodyPlaceholder': '技能正文（Markdown）。可粘贴带 frontmatter 的 SKILL.md，引擎会解析 name/description。',
        'settings.skills.save': '保存技能',
        'settings.skills.saving': '保存中…',
        'settings.skills.cancel': '取消',
        'settings.skills.edit': '编辑',
        'settings.skills.delete': '删除',
        'settings.skills.deleteConfirm': '确认删除？',
        'settings.skills.run': '运行',
        'settings.skills.on': '停用',
        'settings.skills.off': '启用',
        'settings.skills.source.workflow': '技能',
        'settings.skills.source.plugin': '插件提供',
        'settings.skills.source.managed': '托管',
        'settings.skills.source.automation': '例行',
        'settings.skills.schedule': '例行 · ',
        'settings.skills.lockedHint': '由插件/托管提供，不能单独停用',
        'settings.skills.agent': '作用 Bot：',
        'settings.skills.failed': '技能操作失败：',
        'errors.gatewayDown': 'Bots 引擎未运行——watchdog 会自动拉起；若持续报错请检查 com.sdk-bots.host launchd 任务',
        'errors.gatewayAuth': '网关需要鉴权——请在引擎侧配置 token 或改回 loopback 绑定',
        'settings.model.deepseek': 'DeepSeek',
        'settings.model.native': 'DSH 默认模型（与其他会话一致）',
        'settings.model.nativeDefault': '当前默认：{provider} / {model}',
        'settings.model.nativeMissing': '未读取到 DSH 模型目录',
        'settings.workspaceRoot': '工作区根目录：',
        'settings.jail.title': 'Bot 工作区隔离',
        'settings.jail.summary': '开启后，该 Bot 的每条 Shell 命令被 macOS Seatbelt 包裹：只允许写入自己的工作目录（工作区根/<名字>）与系统临时目录，越界写入被内核拒绝；读取不受限（共享黑板仍可读）。下次对话生效，无需重启。注意：同一名字的多个 Bot 会共享同一目录。',
        'settings.jail.count': '已隔离：',
        'settings.jail.on': '开启隔离',
        'settings.jail.off': '解除',
        'settings.jail.offConfirm': '确认解除？',
        'settings.mcp': 'MCP 服务器',
        'settings.mcp.summary': 'Bot 的工具扩展总线：服务器由 sdk-bots 引擎托管，所有 Bot 共享。',
        'settings.mcp.empty': '未安装任何 MCP 服务器',
        'settings.mcp.tools': '可用工具：',
        'settings.mcp.add': '添加服务器',
        'settings.mcp.adding': '添加中…',
        'settings.mcp.namePlaceholder': '名称，例如 github',
        'settings.mcp.configPlaceholder': '{"command": "npx", "args": ["-y", "server包"]} 或 {"url": "https://…/mcp"}',
        'settings.mcp.exampleStdio': '填入本地 stdio 示例',
        'settings.mcp.exampleUrl': '填入远程 URL 示例',
        'settings.mcp.exampleStdioValue': '{"command": "node", "args": ["/path/to/server.mjs"]}',
        'settings.mcp.exampleUrlValue': '{"url": "https://example.com/mcp", "headers": {"Authorization": "Bearer <token>"}}',
        'settings.mcp.remove': '删除',
        'settings.mcp.removeConfirm': '确认删除？',
        'settings.mcp.restart': '重启连接',
        'settings.mcp.restarting': '重启中…',
        'settings.mcp.failed': '操作失败：',
        'error.noConnection': '连接服务尚未就绪',
        'error.callFailed': '调用失败',
        'error.badResponse': '意外的 RPC 响应',
      }

      const en: Record<string, string> = {
        'goal.chooseBot': 'Choose a bot in the sidebar to chat or create a goal.',
        'goal.views': 'Conversation views',
        'goal.chat': 'Chat',
        'goal.title': 'Goals',
        'goal.retrySetup': 'Retry setup',
        'goal.refresh': 'Refresh status',
        'goal.intro': 'Give the bot a goal and acceptance criteria. Scheduled work continues with this page closed.',
        'goal.new': 'Create goal',
        'goal.objective': 'What should be accomplished?',
        'goal.criteria': 'Acceptance criteria (one per line)',
        'goal.interval': 'Run interval',
        'goal.minutes': 'Every {n} minutes',
        'goal.start': 'Start scheduled work',
        'goal.working': 'Saving…',
        'goal.loading': 'Loading goals…',
        'goal.pause': 'Pause goal',
        'goal.resume': 'Resume goal',
        'goal.complete': 'Accept result',
        'goal.revise': 'Request changes',
        'goal.cancel': 'End goal',
        'goal.cancelConfirm': 'End this goal?',
        'goal.keep': 'Keep goal',
        'goal.feedback': 'What still needs work?',
        'goal.sendFeedback': 'Save and resume',
        'goal.progress': 'Bot reports {done}/{total} criteria met · Cycle {cycle}',
        'goal.reviewHint': 'Check the evidence and actual deliverables before accepting. The bot’s claims have not been independently verified.',
        'goal.checkpoint': 'Progress and evidence (reported by bot)',
        'goal.noEvidence': 'No checkpoint yet. Evidence and next steps will appear after a run.',
        'goal.history': 'Run history',
        'goal.next': 'Next scheduled run: {time}',
        'goal.scheduled': 'Scheduled',
        'goal.running': 'Running',
        'goal.paused': 'Paused',
        'goal.blocked': 'Blocked',
        'goal.review': 'Awaiting review',
        'goal.completed': 'Accepted',
        'goal.cancelled': 'Ended',
        'goal.attention': 'Needs attention',
        'goal.runOk': 'Run finished',
        'goal.runError': 'Run failed',
        'nav.workspaces': 'Workspaces',
        'nav.bots': 'Bots',
        'nav.bots.aria': 'Bots',
        'nav.bots.unread': 'Bots ({n} unread)',
        'delegate.loading': 'Loading…',
        'delegate.unavailable': 'Workspace view unavailable — reload the page.',
        'delegate.failed': 'Workspace view failed to render; Bots is unaffected.',
        'gateway.online': 'Gateway online :{port}',
        'gateway.offline': 'Gateway not connected',
        'gateway.offlineHint': 'Gateway not connected — see the settings page.',
        'bot.new': 'New bot',
        'group.new': 'New group chat',
        'bot.namePlaceholder': 'Bot name',
        'group.namePlaceholder': 'Group name',
        'bot.descPlaceholder': 'Description / persona (optional)',
        'action.create': 'Create',
        'action.cancel': 'Cancel',
        'action.close': 'Close',
        'action.save': 'Save',
        'action.saving': 'Saving…',
        'action.stop': 'Stop generating',
        'chat.stop.noop': 'No generation in progress',
        'media.openFailed': 'Open failed — the file may have moved or been deleted',
        'chat.members.manage': 'Manage members',
        'chat.members.cap': 'Group cap is {cap} members — raise it in session settings',
        'chat.settings': 'Settings',
        'chat.settings.title': 'Session settings',
        'chat.settings.name': 'Name',
        'chat.settings.desc': 'Description',
        'chat.settings.workspace': 'Workspace jail',
        'chat.settings.root': 'Workspace root',
        'chat.settings.rootPh': 'Empty = disabled',
        'chat.settings.paths': 'Extra writable paths (comma-separated)',
        'chat.settings.pathsPh': '/tmp/xxx, /Users/you/shared',
        'chat.settings.hint': 'Writes are sandboxed to the workspace (plus extra paths); reads stay unrestricted. Bots sharing a slug share one directory.',
        'settings.group.title': 'Groups',
        'settings.group.cap': 'Member cap',
        'settings.group.capHint': 'Global: applied to new groups and roster edits (1–16). Existing rosters are left untouched.',
        'modal.members.title': 'Manage group members',
        'modal.members.hint': 'Checked bots are members; changes apply immediately on save (editable again anytime).',

        'action.pin': 'Pin to top',
        'action.unpin': 'Unpin',
        'action.delete': 'Delete',
        'delete.title.bot': 'Delete bot',
        'delete.title.group': 'Delete group chat',
        'delete.confirm': 'This permanently deletes "{name}" and its transcript.',
        'delete.working': 'Deleting…',
        'action.send': 'Send',
        'action.refresh': 'Refresh',
        'list.loading': 'Loading…',
        'list.empty.hidden': 'All conversations are hidden from the sidebar.',
        'modal.members.empty': 'No single chats to add.',
        'list.unhideAll': 'Show all',
        'section.groups': 'Groups',
        'list.more': 'More actions',
        'list.refresh': 'Refresh list',
        'section.singles': 'Direct',
        'chat.group': 'Group · {n} members',
        'chat.single': 'Direct',
        'chat.loading': 'Loading…',
        'chat.empty.single': 'Send the first message to {name} and start the conversation.',
        'chat.empty.group': 'Say something in the room — members will pick it up.',
        'chat.jump': 'Jump to latest',
        'chat.composing': 'Deep diving...',
        'chat.thinking': 'Thinking',
        'action.copy': 'Copy',
        'action.copied': 'Copied',
        'chat.queuedSend': 'Queue message',
        'duration.seconds': '{seconds}s',
        'duration.minutes': '{minutes}m {seconds}s',
        'chat.placeholder.group': 'Use @name to direct a turn; everyone by default',
        'chat.placeholder.single': 'Message {name}…',
        'chat.placeholder.busy': 'Generating… sends will queue and land after the current turn',
        'chat.attach': 'Add images',
        'chat.attach.remove': 'Remove image',
        'chat.attach.limit': 'Up to 4 images per message',
        'time.today': 'Today',
        'time.yesterday': 'Yesterday',
        'time.date': '{m}/{d}',
        'time.dateFull': '{y}/{m}/{d}',
        'tool.fallbackName': 'Tool',
        'settings.summary': 'Multi-bot workbench, bridged to the sdk-bots orchestration gateway.',
        'settings.tab.overview': 'Overview',
        'settings.tab.models': 'Models',
        'settings.tab.workspace': 'Workspace',
        'settings.tab.mcp': 'MCP',
        'settings.tab.skills': 'Skills',
        'settings.tabs': 'Bots settings tabs',
        'settings.probing': 'Probing…',
        'settings.address': 'Address: ',
        'settings.pid': 'PID: ',
        'settings.busy': 'busy',
        'settings.idle': 'idle',
        'settings.auth': 'Auth: ',
        'settings.auth.token': 'token (sent automatically)',
        'settings.auth.none': 'none (loopback, unauthenticated)',
        'settings.reason': 'Reason: ',
        'settings.reason.unknown': 'unknown',
        'settings.dataDir': 'Data directory: ',
        'settings.reading': 'reading…',
        'settings.events': 'Live events: ',
        'settings.events.on': 'connected · {n} buffered',
        'settings.events.off': 'not connected',
        'settings.entry': 'Entry point: ',
        'settings.entry.value': 'Sidebar “Workspaces | Bots” collapsible nav',
        'settings.model.title': 'Model',
        'settings.model.current': 'Current model',
        'settings.model.auto': 'auto (freeroute default)',
        'settings.model.engineDefault': 'Engine default (unset)',
        'settings.model.freeroute': 'freeroute auto routing (default)',
        'settings.model.pick': 'Pick a model',
        'settings.model.provider': 'Provider',
        'settings.model.hint': 'The engine reads its model from an environment variable at startup, so a pick only takes effect after “Apply and restart engine” (a restart interrupts in-flight turns). “Engine model” is what the next start will use.',
        'settings.model.offline': 'freeroute unreachable — using the current default model',
        'settings.model.saving': 'Saving…',
        'settings.model.engine': 'Engine model',
        'settings.model.engineUnset': 'unset (env default)',
        'settings.model.engineApply': 'Apply and restart engine',
        'settings.model.engineApplying': 'Restarting…',
        'settings.model.engineRestarted': 'Restarted and live',
        'settings.model.applyFailed': 'Apply failed — the engine did not restart, the pick is NOT live:',
        'settings.skills': 'Skills',
        'settings.skills.summary': 'Skills are a reusable instruction library (SKILL.md, same format as DSH). Bots see the library path in their system prompt and read files themselves; @skillName in a message injects that skill body into context. The library is global; enablement is per-bot.',
        'settings.skills.empty': 'No skills yet — create one, or paste markdown to import',
        'settings.skills.add': 'New skill',
        'settings.skills.import': 'Import markdown',
        'settings.skills.importing': 'Importing…',
        'settings.skills.namePlaceholder': 'Skill name, e.g. weekly-report',
        'settings.skills.descPlaceholder': 'One line on when to use it (surfaced to the bot alongside the library path)',
        'settings.skills.bodyPlaceholder': 'Skill body (Markdown). A pasted SKILL.md with frontmatter works — the engine parses name/description.',
        'settings.skills.save': 'Save skill',
        'settings.skills.saving': 'Saving…',
        'settings.skills.cancel': 'Cancel',
        'settings.skills.edit': 'Edit',
        'settings.skills.delete': 'Delete',
        'settings.skills.deleteConfirm': 'Delete for real?',
        'settings.skills.run': 'Run',
        'settings.skills.on': 'Disable',
        'settings.skills.off': 'Enable',
        'settings.skills.source.workflow': 'skill',
        'settings.skills.source.plugin': 'plugin',
        'settings.skills.source.managed': 'managed',
        'settings.skills.source.automation': 'routine',
        'settings.skills.schedule': 'routine · ',
        'settings.skills.lockedHint': 'Provided by a plugin/managed feed — cannot be disabled per-bot',
        'settings.skills.agent': 'For bot:',
        'settings.skills.failed': 'Skill operation failed: ',
        'errors.gatewayDown': 'The bots engine is not running — the watchdog will restart it; if this persists, check the com.sdk-bots.host launchd job',
        'errors.gatewayAuth': 'The gateway requires auth — configure a token on the engine or switch back to loopback binding',
        'settings.model.deepseek': 'DeepSeek',
        'settings.model.native': 'DSH default model (same as other sessions)',
        'settings.model.nativeDefault': 'Default: {provider} / {model}',
        'settings.model.nativeMissing': 'DSH model catalog unavailable',
        'settings.workspaceRoot': 'Workspace root: ',
        'settings.jail.title': 'Bot workspace jail',
        'settings.jail.summary': 'When enabled, every shell command of that bot is wrapped in a macOS Seatbelt profile: writes are confined to its own workspace directory (workspace root /<name>) and the OS temp dir — out-of-bounds writes are denied by the kernel. Reads stay unrestricted (shared blackboards remain readable). Takes effect on the bot’s next turn, no restart. Note: bots sharing a name share one directory.',
        'settings.jail.count': 'Jailed: ',
        'settings.jail.on': 'Enable jail',
        'settings.jail.off': 'Remove',
        'settings.jail.offConfirm': 'Confirm removal?',
        'settings.mcp': 'MCP servers',
        'settings.mcp.summary': 'The tool-expansion bus for bots: servers are hosted by the sdk-bots engine and shared by every bot.',
        'settings.mcp.empty': 'No MCP servers installed',
        'settings.mcp.tools': 'Available tools: ',
        'settings.mcp.add': 'Add server',
        'settings.mcp.adding': 'Adding…',
        'settings.mcp.namePlaceholder': 'Name, e.g. github',
        'settings.mcp.configPlaceholder': '{"command": "npx", "args": ["-y", "package"]} or {"url": "https://…/mcp"}',
        'settings.mcp.exampleStdio': 'Fill stdio example',
        'settings.mcp.exampleUrl': 'Fill URL example',
        'settings.mcp.exampleStdioValue': '{"command": "node", "args": ["/path/to/server.mjs"]}',
        'settings.mcp.exampleUrlValue': '{"url": "https://example.com/mcp", "headers": {"Authorization": "Bearer <token>"}}',
        'settings.mcp.remove': 'Remove',
        'settings.mcp.removeConfirm': 'Confirm removal?',
        'settings.mcp.restart': 'Restart connections',
        'settings.mcp.restarting': 'Restarting…',
        'settings.mcp.failed': 'Operation failed: ',
        'error.noConnection': 'Connection service is not ready yet',
        'error.callFailed': 'Call failed',
        'error.badResponse': 'Unexpected RPC response',
      }

      /**
       * Namespace-bound translator.
       *
       * `locale.bind` returns a stable function that resolves against whatever
       * locale is active at call time, so this can live at module scope; a
       * switch re-renders through the subscription installed in `apply`.
       * Falls back to the zh dictionary (then the key) if the locale service
       * is unavailable, so no surface ever renders a bare key.
       */
      let boundT: ((key: string, params?: Record<string, unknown>) => string) | null = null
      function t(key: string, params?: Record<string, unknown>): string {
        if (boundT !== null) return boundT(key, params)
        const template = zh[key] ?? key
        if (params === undefined) return template
        return template.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
      }

      /**
       * Localize a host-side error for rendering.
       *
       * Host errors arrive in engine-internal wording — `callGateway` throws
       * "gateway.json not found — sdk-bots host 是否在运行？" and friends —
       * and a raw passthrough strands half the UI in the wrong language. The
       * recurring, user-actionable ones map to locale strings; anything else
       * passes through verbatim, so an unknown error is never masked.
       */
      function errText(e2: unknown): string {
        const msg = String((e2 as any)?.message ?? e2 ?? '')
        if (/gateway\.json not found/.test(msg)) return t('errors.gatewayDown')
        if (/gateway unauthorized/.test(msg)) return t('errors.gatewayAuth')
        return msg
      }

      // =========================================================
      // Module-level services and state.
      // =========================================================
      let ctx: any = null
      let connectionSvc: any = null
      let slotsSvc: any = null
      let layoutSvc: any = null

      /** Cadence for draining the host's in-memory SSE ring (no gateway hop). */
      const RING_DRAIN_MS = 1000

      async function botsCall<T = unknown>(method: string, request?: unknown): Promise<T> {
        if (connectionSvc === null) throw new Error(t('error.noConnection'))
        const envelope = await connectionSvc.rpc.call('/api', 'bots/' + method, {
          args: { request: request === undefined ? null : request },
        })
        if (envelope !== null && typeof envelope === 'object' && envelope.ok === false) {
          throw new Error(envelope.error?.message ?? t('error.callFailed'))
        }
        if (envelope !== null && typeof envelope === 'object' && envelope.ok === true) return envelope.value
        throw new Error(t('error.badResponse'))
      }

      /**
       * The single reader of the host's event ring.
       *
       * The cursor lives here and nowhere else. Components subscribe and get
       * told which channels moved; they never call `eventsSince` themselves,
       * so two consumers can no longer race for the same increment (the old
       * design had a module-global cursor that whoever polled first would
       * advance, silently starving everyone else).
       */
      const ring = (() => {
        let seq = -1
        let timer: any = null
        let live: any = null
        /** Latest host-side unread snapshot (see `unread.ts` on the host). */
        let unread: Record<string, number> | null = null
        const subs = new Set<(channels: Set<string>, events: any[]) => void>()

        async function drain(): Promise<void> {
          let r: any
          try { r = await botsCall('eventsSince', { seq }) }
          catch { return /* gateway offline; the next tick retries */ }
          if (r === null || typeof r !== 'object') return
          if (Number.isFinite(r.nextSeq)) seq = Number(r.nextSeq)
          if (r.state !== undefined) live = r.state
          if (r.unread !== null && typeof r.unread === 'object') unread = r.unread
          const events: any[] = Array.isArray(r.events) ? r.events : []
          if (events.length === 0) return
          const channels = new Set<string>()
          for (const ev of events) if (ev !== null && typeof ev?.channel === 'string') channels.add(ev.channel)
          for (const fn of [...subs]) { try { fn(channels, events) } catch { /* one bad subscriber must not stop the rest */ } }
        }

        return {
          subscribe(fn: (channels: Set<string>, events: any[]) => void): () => void {
            subs.add(fn)
            if (timer === null) {
              timer = setInterval(() => { void drain() }, RING_DRAIN_MS)
              void drain()
            }
            return () => {
              subs.delete(fn)
              if (subs.size === 0 && timer !== null) { clearInterval(timer); timer = null }
            }
          },
          state: () => live,
          unread: () => unread,
        }
      })()

      /** Shared UI state; every mutation goes through `patch`. */
      const state: any = {
        agents: [] as any[],
        agentsLoaded: false,
        info: undefined as any,
        error: null as string | null,
        chatAgentId: null as string | null,
        // First paint: only 「工作区」 is expanded — Bots folds until asked,
        // matching the one-column-of-attention rule the accordion enforces.
        open: { workspaces: true, bots: false },
        /** Host-computed unread counts per agent id (plugin-owned model). */
        unreadCounts: {} as Record<string, number>,
        /** Pinned conversation ids (置顶会话), plugin prefs; order = pin order. */
        pinnedIds: [] as string[],
        /** Create dialog: 'bot' | 'group' | null — rendered as a system-style
         *  modal from shell.overlay, so the form state lives in the store. */
        create: null as string | null,
        createName: '',
        createDesc: '',
        createMembers: {} as Record<string, boolean>,
        createWorking: false,
        /** Delete confirmation: { id, name, isGroup } | null (system modal). */
        confirmDelete: null as any,
        /** Manage-members dialog: group agentId | null (system modal). */
        manageMembers: null as string | null,
        settingsAgentId: null as string | null,
        sectionMenu: null as string | null,
        rowMenu: null as string | null,
        /** Last row's menu may not fit below — flipped above the row when the
         *  viewport runs out (the sidebar scroll box clips absolute children). */
        rowMenuFlip: false,
        sectionsOpen: null as Record<string, boolean> | null,
        /** Bumped on a language switch so module-scope `t` output re-renders. */
        localeRev: 0,
      }
      const stateSubs = new Set<() => void>()
      function patch(next: any): void {
        Object.assign(state, next)
        for (const fn of [...stateSubs]) fn()
      }
      function useStore(): any {
        const [, force] = React.useState(0)
        React.useEffect(() => {
          const fn = () => force((n: number) => n + 1)
          stateSubs.add(fn)
          return () => { stateSubs.delete(fn) }
        }, [])
        return state
      }

      /** Per-agent composer drafts, kept in memory for the plugin lifetime so
       *  leaving a chat and coming back restores what was being typed — the
       *  native persisted-draft contract, minus the Host round-trip. Cleared
       *  on a successful send; a failed send keeps the draft for retry. */
      const draftMemory = new Map<string, string>()

      /** Image mime types the composer accepts as attachments. Must stay in
       * lockstep with the host's IMAGE_EXTS allowlist (src/index.ts): the host
       * re-validates, this is the UX filter that fails fast in the picker. */
      const SEND_IMAGE_TYPES: Record<string, boolean> = {
        'image/png': true, 'image/jpeg': true, 'image/jpg': true,
        'image/gif': true, 'image/webp': true, 'image/bmp': true,
      }
      /** Same cap as the host (4 images per message) and the gateway engine. */
      const SEND_IMAGE_LIMIT = 4

      async function refreshAgents(): Promise<void> {
        try {
          const list: any = await botsCall('list')
          patch({ agents: Array.isArray(list) ? list : [], agentsLoaded: true, error: null })
        } catch (err: any) {
          patch({ agentsLoaded: true, error: String(err?.message ?? err) })
        }
      }
      /** Load the pinned-conversation list (置顶会话) from plugin prefs. */
      async function refreshPins(): Promise<void> {
        try {
          const r: any = await botsCall('pin', null)
          patch({ pinnedIds: Array.isArray(r?.ids) ? r.ids.map(String) : [] })
        } catch { /* pins are cosmetic; keep the last known list */ }
      }
      /** Bulk-restore sidebar visibility for every hidden agent, then refresh. */
      async function unhideAll(): Promise<void> {
        const hidden = (state.agents as any[]).filter((a) => a.isHiddenFromSidebar === true)
        await Promise.allSettled(hidden.map((a) => botsCall('setHidden', { id: a.id, hidden: false })))
        void refreshAgents()
      }
      /** Toggle one conversation's pin and take the authoritative id list back. */
      function setPin(id: string, pinned: boolean): void {
        void botsCall('pin', { id, pinned })
          .then((r: any) => { patch({ pinnedIds: Array.isArray(r?.ids) ? r.ids.map(String) : [] }) })
          .catch(() => { /* best-effort; next boot resyncs */ })
      }
      async function refreshInfo(): Promise<void> {
        try { patch({ info: await botsCall('gatewayInfo', {}) }) } catch { /* keep the last good reading */ }
      }

      /** Pull the latest host unread snapshot into the store. */
      function syncUnread(): void {
        const u = ring.unread()
        if (u !== null) patch({ unreadCounts: u })
      }

      function openChat(id: string): void {
        layoutSvc.selectPanel('dsh-bots')
        patch({ chatAgentId: id, unreadCounts: { ...state.unreadCounts, [id]: 0 } })
        // Clear the badge at the source; the gateway owns unread state.
        void botsCall('markRead', { id, atMs: Date.now() }).then(refreshAgents).catch(() => {})
      }

      function agentById(id: string | null): any {
        if (id === null) return null
        return state.agents.find((a: any) => a.id === id) ?? null
      }

      // =========================================================
      // Delegation of the shipped workspace browser.
      // =========================================================

      /**
       * `useSyncExternalStore` selector bound to one host observable, cached
       * per source. The cache is not an optimization: a fresh hook identity on
       * every render makes React tear down and re-create the child's
       * subscription each pass, which is what the shell's own renderer avoids
       * by caching the same way.
       */
      const warned = new Set<string>()
      function warnOnce(message: string): void {
        if (warned.has(message)) return
        warned.add(message)
        // eslint-disable-next-line no-console
        console.warn('[dsh-bots] ' + message)
        reportDiag('warn', { message })
      }

      /**
       * Record a delegation milestone to the host's diagnostics file.
       *
       * Deduplicated by stage+detail, because these fire from render paths.
       * Failure to record is never surfaced: diagnostics must not be able to
       * break the thing they observe.
       */
      const diagSeen = new Set<string>()
      function reportDiag(stage: string, detail?: unknown): void {
        const key = stage + ':' + JSON.stringify(detail ?? null)
        if (diagSeen.has(key)) return
        diagSeen.add(key)
        void botsCall('diag', { stage, detail: detail ?? null }).catch(() => {})
      }

      const hookCache = new WeakMap<object, any>()
      function observableHook(source: any): any {
        if (source === null || typeof source !== 'object') return undefined
        const hit = hookCache.get(source)
        if (hit !== undefined) return hit
        const subscribe = (fn: () => void) => source.subscribe(fn)
        const hook = function useSelector(sel: any) {
          return React.useSyncExternalStore(subscribe, () => (sel === undefined ? source.getSnapshot() : sel(source.getSnapshot())))
        }
        hookCache.set(source, hook)
        return hook
      }

      const Boundary = class extends React.Component {
        constructor(props: any) { super(props); this.state = { failed: false } }
        static getDerivedStateFromError() { return { failed: true } }
        componentDidCatch(error: any) {
          // eslint-disable-next-line no-console
          console.error('[dsh-bots] delegated slot entry failed:', error)
          reportDiag('delegate-crashed', { message: String(error?.message ?? error) })
        }
        render() { return this.state.failed ? this.props.fallback : this.props.children }
      }

      /** Live entries of a slot that are not ours, most-specific first. */
      function foreignEntries(key: string): any[] {
        if (slotsSvc === null) return []
        let list: any[] = []
        try { list = slotsSvc.entries(key) ?? [] } catch { return [] }
        return list.filter((en: any) => en !== null && en.component !== undefined && en.registrant !== 'dsh-bots')
      }

      /**
       * Render a shadowed entry the way the shell would.
       *
       * The shell's renderer assembles a "standard kit" before handing props
       * to a slot component: global hooks, the entry's store and actions, its
       * locale seat, and — when the registration declares `children` — a bound
       * `renderSlot` so the component can fill its own holes. Taking over a
       * single slot means taking over that assembly too. The previous version
       * stubbed `renderSlot` to `() => null`, which silently blanked the
       * workspace browser's directory-picker flow; here it recurses, so a
       * delegated entry's children render exactly as they would natively.
       */
      function synthesizeProps(entry: any, ownerProps: any, shellProps?: any): any {
        const props: any = {}
        if (slotsSvc === null) return { ...props, ...ownerProps }

        // Forward the WHOLE standard kit the shell hands our `sidebar.workspaces`
        // shadow — every hook and callback (useSessions/useWorkspaces/
        // useSessionPendingInteraction/usePanelInfo/useResource/expandSidebar…).
        // Two fixed-list misses crashed the delegated browser on renderer
        // upgrades (09-09 `useWorkspaces`, 09-10 `usePanelInfo`); a generic
        // function-forward heals future kit growth by itself. The four names
        // below stay plugin-synthesized (entry store/locale/children), and
        // non-function kit entries (sessionId/useProjection…) stay session-only.
        if (shellProps !== undefined) {
          for (const name of Object.keys(shellProps)) {
            if (name === 'renderSlot' || name === 'useStore' || name === 'actions' || name === 't') continue
            const value = shellProps[name]
            if (typeof value === 'function') props[name] = value
          }
        }

        let host: any
        try { host = slotsSvc.hostFace?.() } catch { host = undefined }

        if (host !== undefined && host.sessions !== undefined && host.workspaces !== undefined) {
          if (props.useSessions === undefined) props.useSessions = observableHook(host.sessions.list)
          if (props.useWorkspaces === undefined) props.useWorkspaces = observableHook(host.workspaces.list)
        }

        let actions: any
        if (entry.store !== undefined) {
          try {
            const store = host !== undefined && typeof host.storeOf === 'function'
              ? host.storeOf(entry, undefined)
              : entry.store
            if (store !== undefined) {
              props.useStore = observableHook(store)
              props.actions = store.actions
              actions = store.actions
            }
          } catch (err: any) {
            // The entry still renders, just without its store — better than a
            // blank region, but worth a record since it means degraded props.
            reportDiag('delegate-store-failed', { message: String(err?.message ?? err) })
          }
        }

        if (entry.locale !== undefined && host !== undefined && host.locale !== undefined) {
          try {
            const bound = host.locale.bind(entry.locale)
            props.t = (key: string, params?: unknown) => bound(key, params)
          } catch { props.t = (key: string) => key }
        }

        if (entry.children !== undefined) {
          props.renderSlot = (key: string, ownerProps2?: any) => renderChildSlot(key, ownerProps2, shellProps)
          // Two child-spec flavours need renderer internals we cannot mint from
          // out here (chain composition, the session seat). Neither is used by
          // any slot we delegate today; warn loudly if that ever changes, so it
          // surfaces as a message instead of another silently empty region.
          const specs: any[] = Object.values(entry.children)
          if (specs.some((spec) => spec?.kind === 'chain' || spec?.scope === 'session')) {
            warnOnce(`delegated entry '${String(entry.name)}' declares chain/session children that this shadow cannot synthesize`)
          }
        }

        // The shell passes the entry's own actions into `inject`; matching that
        // matters for registrations whose injected callbacks close over them.
        if (typeof entry.inject === 'function') {
          let injected: any
          try { injected = entry.inject(actions) } catch { injected = undefined }
          if (injected !== null && typeof injected === 'object') {
            for (const key of Object.keys(injected)) {
              if (key === 'hooks') continue
              props[key] = injected[key]
            }
            if (injected.hooks !== null && typeof injected.hooks === 'object') {
              for (const name of Object.keys(injected.hooks)) {
                const source = injected.hooks[name]
                const hook = observableHook(source)
                if (hook !== undefined) props['use' + name[0].toUpperCase() + name.slice(1)] = hook
              }
            }
          }
        }

        // Owner props win, exactly as in the shell's own merge order.
        return { ...props, ...ownerProps }
      }

      /** Bound `renderSlot` handed to delegated entries (recursive). */
      function renderChildSlot(key: string, ownerProps?: any, shellProps?: any): any {
        const entries = foreignEntries(key)
        if (entries.length === 0) return null
        return entries.map((en: any, i: number) => e(Boundary, {
          key: en.id ?? key + ':' + String(i),
          fallback: null,
          children: e(en.component, synthesizeProps(en, ownerProps ?? {}, shellProps)),
        }))
      }

      /**
       * Renders the shipped `sidebar.workspaces` entry underneath our shadow.
       * `wide` is forwarded untouched so the shipped rail branch — search and
       * add-workspace, which the plugin used to replace with two inert icons —
       * keeps working when the sidebar is collapsed.
       */
      function DelegatedBrowser(p: {
        wide: boolean
        expandSidebar?: () => void
        useSessions?: any
        useWorkspaces?: any
        useSessionPendingInteraction?: any
      }) {
        const [entry, setEntry] = React.useState(null)
        const [status, setStatus] = React.useState('loading')
        React.useEffect(() => {
          let alive = true
          const check = () => {
            const found = foreignEntries('sidebar.workspaces')[0] ?? null
            if (!alive) return
            setEntry(found)
            setStatus(found === null ? 'missing' : 'ready')
            reportDiag(found === null ? 'delegate-missing' : 'delegate-ready', { slot: 'sidebar.workspaces' })
          }
          check()
          const unsub = slotsSvc === null ? null : slotsSvc.subscribe('sidebar.workspaces', check)
          return () => { alive = false; if (unsub) unsub() }
        }, [])

        const props = React.useMemo(
          () => (entry === null ? null : synthesizeProps(entry, { wide: p.wide, expandSidebar: p.expandSidebar }, p)),
          [entry, p.wide, p.expandSidebar, p.useSessions, p.useWorkspaces, p.useSessionPendingInteraction],
        )

        if (status === 'loading') return e('div', { className: 'dbs-navBodyErr' }, t('delegate.loading'))
        if (entry === null || props === null) return e('div', { className: 'dbs-navBodyErr' }, t('delegate.unavailable'))
        return e(Boundary, {
          fallback: e('div', { className: 'dbs-navBodyErr' }, t('delegate.failed')),
          children: e(entry.component, props),
        })
      }

      // =========================================================
      // Shared row pieces.
      // =========================================================

      // =========================================================
      // MERGED BLOUB ENGINE — generated block, see tools/bloub/README.md.
      // =========================================================

/* ⬇⬇⬇ MERGED BLOUB ENGINE (verbatim from tools/bloub/src, generated by
 * scripts/merge-bloub-engine.mjs — do not edit by hand; re-vendor + re-run).
 * bloub — SVG recreation of the x.ai bot avatar, one shape morphing through
 * 14 measured states. https://github.com/jeremy-prt/bloub — MIT, © Jérémy Perret.
 * Framework-free and clock-free: engine.sample(t) is a pure function of time. */
// ── math.ts ──────────────────────────────────────────────────────────
const TAU = Math.PI * 2

const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

type Easing = (t: number) => number

/**
 * Mesure sur la video : les transitions sont des ease-out exponentiels, sans
 * depassement du corps. Les seuls effets de ressort sont locaux (le pop de la
 * pastille de notification, l'ouverture des yeux) et sont ecrits directement
 * dans l'etat concerne.
 */
const easings = {
  easeOutCubic: (t: number) => 1 - (1 - t) ** 3,
  easeInOutCubic: (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  easeOutQuint: (t: number) => 1 - (1 - t) ** 5
} satisfies Record<string, Easing>

/** Bruit 1D periodique : boucle sans couture sur `period`, utile pour la derive du regard. */
function loopNoise(t: number, period: number, seed = 0): number {
  const p = (t / period) * TAU
  return (
    0.55 * Math.sin(p + seed) +
    0.3 * Math.sin(2 * p + seed * 1.7 + 1.1) +
    0.15 * Math.sin(3 * p + seed * 2.3 + 2.4)
  )
}

/** PRNG deterministe (mulberry32) : meme sequence a chaque lecture. */
function createRng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Arrondi court : divise par ~2 le poids des chaines de path generees a 60 fps. */
const r2 = (v: number) => Math.round(v * 100) / 100

// ── profiles.ts ──────────────────────────────────────────────────────────
// Profils radiaux r(theta) releves au pixel sur la video de reference.
// theta = 0 pointe vers la droite et croit dans le sens horaire (y vers le bas).
// Unite : rayon de la boule au repos = 1.
//
// Genere par tools/extract-profiles.py — ne pas editer a la main.

const PROFILE_SAMPLES = 64

const PROFILES = {
  // oeuf : meme hauteur que la boule, retreci en largeur
  // image 164, empreinte mesuree 1.647 x 2.000
  egg: [0.8369,0.8424,0.8497,0.8585,0.8674,0.8775,0.8878,0.8983,0.9089,0.9185,0.9288,0.9374,0.9445,0.9504,0.9543,0.9559,0.9555,0.9519,0.9466,0.9389,0.9302,0.9193,0.9085,0.8969,0.8852,0.8734,0.8625,0.8513,0.8411,0.8325,0.8243,0.8179,0.8137,0.8112,0.8102,0.8128,0.8178,0.8262,0.8374,0.8518,0.8702,0.8922,0.9169,0.9446,0.9741,1.0023,1.0267,1.0433,1.0481,1.0393,1.0216,0.9970,0.9697,0.9418,0.9169,0.8949,0.8760,0.8604,0.8490,0.8394,0.8337,0.8314,0.8305,0.8326],
  // hexagone pointe en haut, coins tres arrondis
  // image 174, empreinte mesuree 1.826 x 2.011
  hexagon: [0.9210,0.9282,0.9441,0.9706,0.9984,1.0059,0.9896,0.9562,0.9290,0.9124,0.9047,0.9058,0.9157,0.9349,0.9642,0.9873,0.9882,0.9665,0.9336,0.9105,0.8968,0.8918,0.8955,0.9080,0.9293,0.9611,0.9820,0.9812,0.9590,0.9282,0.9089,0.8978,0.8964,0.9026,0.9189,0.9439,0.9778,0.9990,0.9964,0.9713,0.9439,0.9274,0.9196,0.9206,0.9308,0.9502,0.9799,1.0121,1.0226,1.0071,0.9752,0.9510,0.9366,0.9316,0.9351,0.9485,0.9711,1.0026,1.0213,1.0155,0.9863,0.9547,0.9347,0.9232],
  // triangle pointe en haut, coins tres arrondis
  // image 190, empreinte mesuree 1.995 x 1.884
  triangle: [0.7819,0.8211,0.8747,0.9440,1.0223,1.0960,1.1401,1.1340,1.0808,1.0047,0.9265,0.8603,0.8104,0.7730,0.7450,0.7273,0.7151,0.7118,0.7148,0.7245,0.7427,0.7680,0.8037,0.8518,0.9148,0.9876,1.0583,1.1073,1.1109,1.0667,0.9940,0.9164,0.8482,0.7948,0.7555,0.7261,0.7056,0.6925,0.6859,0.6869,0.6938,0.7084,0.7305,0.7615,0.8040,0.8595,0.9311,1.0092,1.0791,1.1171,1.1054,1.0501,0.9779,0.9050,0.8450,0.7990,0.7656,0.7413,0.7258,0.7160,0.7146,0.7204,0.7330,0.7528],
} as const

type ProfileName = keyof typeof PROFILES


// ── shape.ts ──────────────────────────────────────────────────────────

interface Point {
  x: number
  y: number
}

/**
 * Une silhouette = un profil radial r(theta) plus une pose.
 *
 * Tout passe par des profils echantillonnes au MEME nombre d'angles : deux
 * formes quelconques ont donc des points qui se correspondent un a un, et le
 * morphing se reduit a une interpolation lineaire des rayons. C'est ce qui
 * rend les transitions propres sans librairie de morphing de path.
 */
interface Silhouette {
  radii: number[]
  /** rotation du profil, en radians */
  rot: number
  /** decalage du centre, en unites de rayon de boule */
  cx: number
  cy: number
  /** squash & stretch, applique en repere ecran (apres rotation) */
  sx: number
  sy: number
}

const ANGLES = Array.from({ length: PROFILE_SAMPLES }, (_, i) => (i / PROFILE_SAMPLES) * TAU)
const COS = ANGLES.map(Math.cos)
const SIN = ANGLES.map(Math.sin)

function silhouette(name: ProfileName, pose: Partial<Silhouette> = {}): Silhouette {
  return {
    radii: [...PROFILES[name]],
    rot: 0,
    cx: 0,
    cy: 0,
    sx: 1,
    sy: 1,
    ...pose
  }
}

/** Cercle parfait : sert de base neutre (point, bulle, cible de fondu). */
function circle(radius: number, pose: Partial<Silhouette> = {}): Silhouette {
  return {
    radii: new Array(PROFILE_SAMPLES).fill(radius),
    rot: 0,
    cx: 0,
    cy: 0,
    sx: 1,
    sy: 1,
    ...pose
  }
}

/** Interpolation de deux silhouettes. `out` est reutilise pour eviter d'allouer a 60 fps. */
function blend(a: Silhouette, b: Silhouette, t: number, out?: Silhouette): Silhouette {
  const dst = out ?? { radii: new Array<number>(PROFILE_SAMPLES), rot: 0, cx: 0, cy: 0, sx: 1, sy: 1 }
  for (let i = 0; i < PROFILE_SAMPLES; i++) {
    dst.radii[i] = lerp(a.radii[i] ?? 1, b.radii[i] ?? 1, t)
  }
  // Rotation par le chemin le plus court : evite de faire un tour complet
  // quand on passe par exemple de +170deg a -170deg.
  let dRot = b.rot - a.rot
  while (dRot > Math.PI) dRot -= TAU
  while (dRot < -Math.PI) dRot += TAU
  dst.rot = a.rot + dRot * t
  dst.cx = lerp(a.cx, b.cx, t)
  dst.cy = lerp(a.cy, b.cy, t)
  dst.sx = lerp(a.sx, b.sx, t)
  dst.sy = lerp(a.sy, b.sy, t)
  return dst
}

/** Projette la silhouette en points ecran. `scale` = rayon de la boule en unites de viewBox. */
function toPoints(s: Silhouette, scale: number, out: Point[] = []): Point[] {
  const cr = Math.cos(s.rot)
  const sr = Math.sin(s.rot)
  for (let i = 0; i < PROFILE_SAMPLES; i++) {
    const r = s.radii[i] ?? 1
    const x = r * (COS[i] ?? 0)
    const y = r * (SIN[i] ?? 0)
    // rotation puis squash en repere ecran, puis translation
    const rx = x * cr - y * sr
    const ry = x * sr + y * cr
    const p = out[i] ?? { x: 0, y: 0 }
    p.x = (rx * s.sx + s.cx) * scale
    p.y = (ry * s.sy + s.cy) * scale
    out[i] = p
  }
  out.length = PROFILE_SAMPLES
  return out
}

/**
 * Polyligne fermee -> cubiques Catmull-Rom.
 *
 * Avec 64 points les tangentes centrees suffisent largement : le contour est
 * lisse au pixel pres meme affiche en 600 px, et la chaine reste courte.
 */
function closedPath(pts: Point[], tension = 1 / 6): string {
  const n = pts.length
  if (n < 3) return ''
  const first = pts[0]!
  let d = `M${r2(first.x)} ${r2(first.y)}`
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!
    const p1 = pts[i]!
    const p2 = pts[(i + 1) % n]!
    const p3 = pts[(i + 2) % n]!
    const c1x = p1.x + (p2.x - p0.x) * tension
    const c1y = p1.y + (p2.y - p0.y) * tension
    const c2x = p2.x - (p3.x - p1.x) * tension
    const c2y = p2.y - (p3.y - p1.y) * tension
    d += `C${r2(c1x)} ${r2(c1y)} ${r2(c2x)} ${r2(c2y)} ${r2(p2.x)} ${r2(p2.y)}`
  }
  return `${d}Z`
}

/**
 * Polygone quelconque -> profil radial, par lancer de rayon depuis `center`.
 *
 * Sert a fabriquer les formes qui ne s'expriment pas naturellement en r(theta)
 * (la barre tronconique du "!"). Calcule une seule fois au chargement, jamais
 * dans la boucle de rendu.
 */
function profileFromPolygon(poly: Point[], cx: number, cy: number): number[] {
  const radii = new Array<number>(PROFILE_SAMPLES).fill(0)
  const n = poly.length
  for (let k = 0; k < PROFILE_SAMPLES; k++) {
    const dx = COS[k] ?? 0
    const dy = SIN[k] ?? 0
    let best = 0
    for (let i = 0; i < n; i++) {
      const a = poly[i]!
      const b = poly[(i + 1) % n]!
      const ex = b.x - a.x
      const ey = b.y - a.y
      const den = dx * ey - dy * ex
      if (Math.abs(den) < 1e-9) continue
      const px = a.x - cx
      const py = a.y - cy
      const t = (px * ey - py * ex) / den // distance le long du rayon
      const u = (px * dy - py * dx) / den // position sur le segment
      if (t > best && u >= 0 && u <= 1) best = t
    }
    radii[k] = best
  }
  return radii
}

/** Enveloppe convexe de deux cercles : la barre tronconique du "!" vertical. */
function hullOfCircles(
  x1: number,
  y1: number,
  r1: number,
  x2: number,
  y2: number,
  r2v: number,
  steps = 96
): Point[] {
  const dx = x2 - x1
  const dy = y2 - y1
  const dist = Math.hypot(dx, dy) || 1e-6
  // angle des tangentes externes communes
  const base = Math.atan2(dy, dx)
  const spread = Math.acos(Math.max(-1, Math.min(1, (r1 - r2v) / dist)))
  const pts: Point[] = []
  // arc du grand cercle
  for (let i = 0; i <= steps / 2; i++) {
    const a = base + spread + ((TAU - 2 * spread) * i) / (steps / 2)
    pts.push({ x: x1 + Math.cos(a) * r1, y: y1 + Math.sin(a) * r1 })
  }
  // arc du petit cercle
  for (let i = 0; i <= steps / 2; i++) {
    const a = base - spread + ((2 * spread) * i) / (steps / 2)
    pts.push({ x: x2 + Math.cos(a) * r2v, y: y2 + Math.sin(a) * r2v })
  }
  return pts
}

/**
 * Rayon du profil dans une direction quelconque, par interpolation entre les
 * deux echantillons voisins.
 *
 * Sert a recaler ce qui est pose "sur" le corps (les yeux, la pastille de
 * notification) quand la silhouette n'est plus un cercle : sans ca, un oeil
 * place a 0.62 rayon sort d'une forme dont le bord est a 0.55 dans cette
 * direction, et le masque le rogne.
 */
function radiusAtAngle(radii: number[], angle: number): number {
  const n = radii.length
  const t = ((((angle / TAU) % 1) + 1) % 1) * n
  const i = Math.floor(t)
  return lerp(radii[i % n] ?? 1, radii[(i + 1) % n] ?? 1, t - i)
}

/**
 * Superellipse : |x/sx|^n + |y/sy|^n = 1.
 * n = 2 donne une ellipse, n ~ 4 le squircle du personnalisateur.
 */
function superellipseProfile(n: number, sx = 1, sy = 1): number[] {
  return ANGLES.map((_, i) => {
    const c = Math.abs((COS[i] ?? 0) / sx) ** n
    const s = Math.abs((SIN[i] ?? 0) / sy) ** n
    return (c + s) ** (-1 / n)
  })
}

/**
 * Profil radial de l'UNION de disques : r(theta) = la plus lointaine des
 * intersections rayon/cercle. Exact tant que l'origine est dans l'union — c'est
 * ce qui donne les bosses du nuage sans booleen de path.
 */
function unionOfCirclesProfile(circles: Array<{ x: number; y: number; r: number }>): number[] {
  const out = new Array<number>(PROFILE_SAMPLES).fill(0)
  for (let i = 0; i < PROFILE_SAMPLES; i++) {
    const dx = COS[i] ?? 0
    const dy = SIN[i] ?? 0
    let best = 0
    for (const c of circles) {
      const b = dx * c.x + dy * c.y
      const disc = b * b - (c.x * c.x + c.y * c.y - c.r * c.r)
      if (disc < 0) continue
      const t = b + Math.sqrt(disc)
      if (t > best) best = t
    }
    out[i] = best
  }
  return out
}

/**
 * Polygone a coins arrondis, par somme de Minkowski avec un disque : chaque
 * arete est poussee de `rc` vers l'exterieur, chaque sommet devient un arc de
 * rayon `rc`. Les sommets sont donc a poser au rayon voulu MOINS rc.
 * Attend un polygone en sens horaire (repere ecran, y vers le bas).
 */
function roundedPolygon(verts: Point[], rc: number, arcSteps = 10): Point[] {
  const n = verts.length
  const out: Point[] = []
  const normal = (a: Point, b: Point) => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    // sens horaire + y vers le bas : la normale sortante est (dy, -dx)
    return Math.atan2(-dx / len, dy / len)
  }
  for (let i = 0; i < n; i++) {
    const prev = verts[(i - 1 + n) % n]!
    const cur = verts[i]!
    const next = verts[(i + 1) % n]!
    const a0 = normal(prev, cur)
    const a1 = normal(cur, next)
    let d = a1 - a0
    while (d > Math.PI) d -= TAU
    while (d < -Math.PI) d += TAU
    for (let k = 0; k <= arcSteps; k++) {
      const a = a0 + (d * k) / arcSteps
      out.push({ x: cur.x + Math.cos(a) * rc, y: cur.y + Math.sin(a) * rc })
    }
  }
  return out
}

/** Polygone regulier a coins arrondis, inscrit dans `radius`. */
function regularPolygonProfile(
  sides: number,
  radius: number,
  rc: number,
  rotationDeg = 0
): number[] {
  const rot = (rotationDeg * Math.PI) / 180
  const verts = Array.from({ length: sides }, (_, i) => {
    // sens horaire a l'ecran : theta croissant avec y vers le bas
    const a = rot + (i / sides) * TAU
    return { x: Math.cos(a) * (radius - rc), y: Math.sin(a) * (radius - rc) }
  })
  return profileFromPolygon(roundedPolygon(verts, rc), 0, 0)
}

/** Polyligne fermee exacte : garde les segments droits (contrairement a closedPath). */
function polyPath(pts: Point[], scale = 1): string {
  if (pts.length < 3) return ''
  let d = ''
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!
    d += `${i === 0 ? 'M' : 'L'}${r2(p.x * scale)} ${r2(p.y * scale)}`
  }
  return `${d}Z`
}

/** Capsule (stade) centree sur l'origine : la forme exacte des yeux du bot. */
function capsulePath(w: number, h: number): string {
  const hw = Math.max(w, 0.01) / 2
  const hh = Math.max(h, 0.01) / 2
  const r = Math.min(hw, hh)
  return (
    `M${r2(-hw)} ${r2(-hh + r)}` +
    `A${r2(r)} ${r2(r)} 0 0 1 ${r2(-hw + r)} ${r2(-hh)}` +
    `L${r2(hw - r)} ${r2(-hh)}` +
    `A${r2(r)} ${r2(r)} 0 0 1 ${r2(hw)} ${r2(-hh + r)}` +
    `L${r2(hw)} ${r2(hh - r)}` +
    `A${r2(r)} ${r2(r)} 0 0 1 ${r2(hw - r)} ${r2(hh)}` +
    `L${r2(-hw + r)} ${r2(hh)}` +
    `A${r2(r)} ${r2(r)} 0 0 1 ${r2(-hw)} ${r2(hh - r)}Z`
  )
}

// ── repere.ts ──────────────────────────────────────────────────────────
/**
 * Le repere de tout ce que le moteur rend.
 *
 * `engine.sample()` sort des coordonnees en unites de viewBox, et ces deux nombres en sont
 * la definition : sans eux, une sortie du moteur ne veut rien dire. Ils vivaient dans
 * `BloubBot.vue`, donc hors d'atteinte — un `<script setup>` n'exporte rien — et
 * `export.ts` en redisait un a la main avec le commentaire qui nommait le probleme.
 *
 * Ils sont ici parce que `src/bot/` est ce qui se lit et se consomme du dehors : le
 * composant Vue est UN client du moteur, pas sa definition.
 */

/**
 * Rayon de la boule au repos, en unites de viewBox. C'est le `scale` que le composant
 * passe a `BotEngine`.
 *
 * Choisi et non mesure : c'est l'unite de travail. Tout le reste du dossier s'exprime en
 * fractions de ce rayon, ce qui rend les mesures relevees sur la video independantes de la
 * taille d'affichage.
 */
const RAYON = 100

/**
 * Demi-cote du viewBox affiche. La marge au-dela du rayon loge les anneaux.
 *
 * Ce n'est pas une valeur libre : les anneaux de l'orbite et le swoosh de la comete montent
 * a 1,4 fois le rayon, soit 140. Rien ne les borne au runtime — c'est le reglage a la main
 * des tableaux `RINGS` et `SWOOSH` (`decor.ts`) qui les tient sous 158, et un test le
 * verrouille.
 */
const DEMI_VIEWBOX = 158

// ── face.ts ──────────────────────────────────────────────────────────

/**
 * Les yeux sont peints sur une sphere, pas poses a plat.
 *
 * Mesure sur la video : l'oeil le plus proche du bord fait 0.69 fois la largeur
 * de l'autre, et son aire 0.663 fois — exactement le facteur de profondeur
 * (z = 0.669) d'un point de sphere a cette distance du centre. On modelise donc
 * une vraie orientation de tete : chaque oeil recupere le repere tangent de la
 * sphere, projete en orthographique. La compression et l'inclinaison en
 * decoulent toutes seules, c'est ce qui donne le volume.
 *
 * Les constantes ci-dessous ne sont pas choisies a la main : elles sortent d'un
 * ajustement du modele sur les positions et tailles relevees image par image
 * (erreur residuelle ~1 px sur un rayon de 190 px).
 */

type Vec3 = [number, number, number]

/** Demi-ecart des yeux sur la sphere, en degres (separation totale ~31deg). */
const EYE_SPLIT = 15.46
/** Taille de l'oeil au repos, en unites de rayon de boule. */
const EYE_W = 0.186
const EYE_H = 0.412

/** Orientation de tete au repos, ajustee sur les frames de reference. */
const REST_GAZE: HeadGaze = { yaw: 28.49, pitch: 28.62, roll: -13 }

interface EyePose {
  x: number
  y: number
  /** matrice tangente 2x2 : [a b c d] au sens SVG matrix(a,b,c,d,e,f) */
  a: number
  b: number
  c: number
  d: number
  /** composante z de la normale : > 0 = face visible */
  depth: number
}

interface HeadGaze {
  /** lacet, degres, positif = regarde a droite */
  yaw: number
  /** tangage, degres, positif = regarde en haut */
  pitch: number
  /** roulis, degres, inclinaison de la tete */
  roll: number
}

const deg = (d: number) => (d * Math.PI) / 180

/** Fait tourner deux vecteurs d'un repere orthonorme dans leur plan commun. */
function spin(u: Vec3, v: Vec3, angle: number): [Vec3, Vec3] {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [
    [u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s],
    [v[0] * c - u[0] * s, v[1] * c - u[1] * s, v[2] * c - u[2] * s]
  ]
}

/**
 * Repere de la tete puis des deux yeux.
 * Repere ecran : x a droite, y vers le bas, z vers le spectateur.
 * L'indice 0 est l'oeil interieur, l'indice 1 l'oeil exterieur.
 */
function eyePoses(gaze: HeadGaze, scale: number, split = EYE_SPLIT): [EyePose, EyePose] {
  let f: Vec3 = [0, 0, 1]
  let right: Vec3 = [1, 0, 0]
  let down: Vec3 = [0, 1, 0]

  // lacet : forward bascule vers right
  ;[f, right] = spin(f, right, deg(gaze.yaw))
  // tangage : forward bascule vers le haut (donc a l'oppose de down)
  ;[down, f] = spin(down, f, deg(gaze.pitch))
  // roulis : la tete penche dans son propre plan
  ;[right, down] = spin(right, down, deg(gaze.roll))

  const build = (side: number): EyePose => {
    const [ef, er] = spin(f, right, deg(split * side))
    return {
      x: ef[0] * scale,
      y: ef[1] * scale,
      a: er[0],
      b: er[1],
      c: down[0],
      d: down[1],
      depth: ef[2]
    }
  }

  return [build(-1), build(1)]
}

/**
 * Vie au repos : derive lente du regard, saccades, clignements.
 *
 * Fonction pure du temps (aucun etat interne), donc pause, reprise et saut a
 * une date arbitraire donnent toujours la meme image. Les valeurs sont des
 * ECARTS a ajouter a la pose de l'etat courant.
 */
interface Liveliness {
  dYaw: number
  dPitch: number
  dRoll: number
  /** 1 = oeil ouvert, 0 = ferme (ecrasement vertical en repere ecran) */
  lid: number
  driftX: number
  driftY: number
  breath: number
}

const BLINK_RNG = createRng(0x5eed)
/** Calendrier de clignements pre-tire : deterministe et sans etat. */
const BLINKS: number[] = (() => {
  const out: number[] = []
  let t = 1.4
  while (t < 900) {
    out.push(t)
    // 1.9 a 4.6 s entre deux clignements, plus un double clignement parfois
    t += 1.9 + BLINK_RNG() * 2.7
    if (BLINK_RNG() < 0.18) {
      out.push(t)
      t += 0.24
    }
  }
  return out
})()

/** Mesure : 1 a 2 frames a 10 fps. */
const BLINK_DUR = 0.18

function blinkLid(t: number): number {
  for (let i = 0; i < BLINKS.length; i++) {
    const start = BLINKS[i]!
    if (t < start) break
    const k = (t - start) / BLINK_DUR
    if (k >= 0 && k <= 1) {
      // fermeture rapide, reouverture un peu plus lente
      return k < 0.45 ? 1 - k / 0.45 : (k - 0.45) / 0.55
    }
  }
  return 1
}

interface LivelinessOptions {
  wander?: number
  blink?: boolean
  float?: boolean
}

function liveliness(t: number, opt: LivelinessOptions = {}): Liveliness {
  const { wander = 1, blink = true, float = true } = opt

  // Periodes premieres entre elles : la derive ne se repete jamais a l'oeil.
  return {
    dYaw: (loopNoise(t, 11.3, 0.4) * 5.5 + loopNoise(t, 3.7, 2.1) * 1.6) * wander,
    dPitch: (loopNoise(t, 9.1, 1.3) * 4.2 + loopNoise(t, 4.3, 0.7) * 1.3) * wander,
    dRoll: loopNoise(t, 13.7, 3.2) * 2.2 * wander,
    lid: blink ? blinkLid(t) : 1,
    // Au repos la video est quasiment immobile (centre stable a +-0.003, rayon
    // constant) : toute la vie passe par le regard et les clignements. On garde
    // juste de quoi ne pas figer completement l'image.
    driftX: float ? loopNoise(t, 7.9, 1.9) * 0.006 : 0,
    driftY: float ? loopNoise(t, 5.3, 0.3) * 0.007 : 0,
    // La largeur est constante, seule la hauteur respire tres legerement.
    breath: float ? 1 + Math.sin((t / 3.4) * Math.PI * 2) * 0.005 : 1
  }
}

/**
 * Le clignement est un ecrasement VERTICAL en repere ecran autour du centre de
 * l'oeil (mesure : la largeur de bbox est conservee, la hauteur tombe a ~0.35),
 * pas un retrecissement le long de l'axe incline de la gelule. On le compose
 * donc apres la matrice tangente, en n'affectant que les sorties en y.
 */
function blinkScale(lid: number): number {
  return 0.06 + 0.94 * clamp(lid)
}

// ── expressions.ts ──────────────────────────────────────────────────────────

/**
 * Expression de repos du bot.
 *
 * Le visage ne tient qu'à deux gélules, donc tout se joue sur quatre leviers :
 * l'orientation de la tête, l'écart des yeux, leurs proportions, et
 * l'inclinaison propre de chaque œil. C'est ce dernier qui permet la colère et
 * la tristesse : elles demandent des inclinaisons EN MIROIR (les hauts qui
 * convergent ou divergent), impossible avec le seul roulis de tête qui incline
 * les deux yeux du même côté.
 *
 * Seul l'état de repos porte cette expression. Les états expressifs de la vidéo
 * (clin d'œil, yeux écarquillés, notification) gardent la leur : c'est elle
 * qu'on est venu reproduire.
 *
 * Les amplitudes s'appuient sur bible-strong-avatar-lab, qui expose le même
 * modèle (tête X/Y/Z, largeur et hauteur par œil, écart, angle par œil) : chez
 * eux la largeur va de 0,8 à 2,7 fois le neutre, la hauteur de 0,3 à 1,5, et
 * les angles jusqu'à ±80°. On reste dans cette enveloppe.
 */
/** Enumeres pour que la couche i18n verifie leurs traductions a la compilation. */
type ExpressionId =
  | 'neutre'
  | 'attentif'
  | 'surpris'
  | 'excite'
  | 'heureux'
  | 'hilare'
  | 'colere'
  | 'triste'
  | 'effraye'
  | 'mefiant'
  | 'confus'
  | 'curieux'
  | 'fier'
  | 'timide'
  | 'blase'
  | 'somnolent'

interface BotExpression {
  id: ExpressionId
  gaze: HeadGaze
  split: number
  eyes: [EyeCfg, EyeCfg]
}

/** `tilt` en degrés, positif = le haut de la gélule part vers la droite. */
const eye = (w: number, h: number, tilt = 0, open = 1): EyeCfg => ({ w, h, tilt, open })

/** Les deux yeux identiques, inclinaisons en miroir si `tilt` est fourni. */
const pair = (w: number, h: number, tilt = 0, open = 1): [EyeCfg, EyeCfg] => [
  eye(w, h, tilt, open),
  eye(w, h, -tilt, open)
]

const EXPRESSIONS: BotExpression[] = [
  {
    // la pose relevée image par image sur la vidéo de référence
    id: 'neutre',
    gaze: { ...REST_GAZE },
    split: EYE_SPLIT,
    eyes: [eye(EYE_W, EYE_H), eye(EYE_W, EYE_H)]
  },
  {
    id: 'attentif',
    gaze: { yaw: 4, pitch: 5, roll: -4 },
    split: 16,
    eyes: pair(0.21, 0.44)
  },
  {
    id: 'surpris',
    gaze: { yaw: 3, pitch: -3, roll: 0 },
    split: 19,
    eyes: pair(0.45, 0.47)
  },
  {
    id: 'excite',
    gaze: { yaw: 6, pitch: -14, roll: 0 },
    split: 19.5,
    eyes: pair(0.4, 0.56, -10)
  },
  {
    // yeux plissés en arc : les hauts convergent légèrement
    id: 'heureux',
    gaze: { yaw: 5, pitch: 9, roll: 0 },
    split: 17,
    eyes: pair(0.27, 0.17, 14)
  },
  {
    id: 'hilare',
    gaze: { yaw: 4, pitch: 14, roll: 0 },
    split: 18,
    eyes: pair(0.34, 0.13, 20)
  },
  {
    // hauts des yeux qui convergent fort vers le centre + yeux étrécis
    id: 'colere',
    gaze: { yaw: 3, pitch: 7, roll: 0 },
    split: 17,
    eyes: pair(0.34, 0.15, 30)
  },
  {
    // l'inverse : les hauts divergent, et le regard tombe
    id: 'triste',
    gaze: { yaw: 3, pitch: -13, roll: 0 },
    split: 16,
    eyes: pair(0.22, 0.4, -28)
  },
  {
    id: 'effraye',
    gaze: { yaw: 2, pitch: -20, roll: 0 },
    split: 20.5,
    eyes: pair(0.4, 0.6)
  },
  {
    // un œil franchement plus fermé que l'autre
    id: 'mefiant',
    gaze: { yaw: 12, pitch: 6, roll: -6 },
    split: 16,
    eyes: [eye(0.21, 0.4), eye(0.22, 0.15)]
  },
  {
    // asymétrique sur les deux axes : tailles ET inclinaisons dépareillées.
    // L'œil plissé est volontairement plat (rapport 1,6) : à un rapport proche
    // de 1 il serait rond, et son inclinaison ne se verrait pas.
    id: 'confus',
    gaze: { yaw: -14, pitch: 3, roll: 8 },
    split: 16.5,
    eyes: [eye(0.2, 0.44, -18), eye(0.28, 0.17, 14)]
  },
  {
    // la tête penche : c'est le roulis qui porte la curiosité
    id: 'curieux',
    gaze: { yaw: 16, pitch: -9, roll: -15 },
    split: 16.5,
    eyes: [eye(0.24, 0.46, -8), eye(0.2, 0.38, -8)]
  },
  {
    id: 'fier',
    gaze: { yaw: 5, pitch: 17, roll: 0 },
    split: 17,
    eyes: pair(0.3, 0.15, 18)
  },
  {
    id: 'timide',
    gaze: { yaw: -19, pitch: -14, roll: -7 },
    split: 14,
    eyes: pair(0.17, 0.3)
  },
  {
    // fentes horizontales et regard qui part sur le côté
    id: 'blase',
    gaze: { yaw: -22, pitch: 2, roll: 0 },
    split: 16,
    eyes: pair(0.3, 0.12)
  },
  {
    // paupières à moitié tombées : on passe par `open`, donc l'écrasement
    // vertical à l'écran, le même mécanisme que le clignement
    id: 'somnolent',
    gaze: { yaw: 6, pitch: -9, roll: -3 },
    split: 16,
    eyes: pair(0.2, 0.42, 0, 0.42)
  }
]

const EXPRESSION_BY_ID = new Map<string, BotExpression>(EXPRESSIONS.map((e) => [e.id, e]))
const DEFAULT_EXPRESSION = 'neutre'

const lerpEyeCfg = (a: EyeCfg, b: EyeCfg, t: number): EyeCfg => ({
  w: lerp(a.w, b.w, t),
  h: lerp(a.h, b.h, t),
  tilt: lerp(a.tilt ?? 0, b.tilt ?? 0, t),
  open: lerp(a.open, b.open, t)
})

/** Interpolation de deux expressions : le changement se fait en glissant. */
function blendExpression(a: BotExpression, b: BotExpression, t: number): BotExpression {
  return {
    id: b.id,
    gaze: {
      yaw: lerp(a.gaze.yaw, b.gaze.yaw, t),
      pitch: lerp(a.gaze.pitch, b.gaze.pitch, t),
      roll: lerp(a.gaze.roll, b.gaze.roll, t)
    },
    split: lerp(a.split, b.split, t),
    eyes: [lerpEyeCfg(a.eyes[0], b.eyes[0], t), lerpEyeCfg(a.eyes[1], b.eyes[1], t)]
  }
}

// ── decor.ts ──────────────────────────────────────────────────────────

/* ------------------------------------------------------------------ couleurs */

/**
 * Les anneaux ne sont pas des couleurs plates : la video montre une roue de
 * teintes complete a luminosite constante, avec un degrade le long de chaque
 * trace. Mesure : S 45-62 %, L 50-67 %.
 */
function wheel(hue: number, s = 0.55, l = 0.62): string {
  const h = ((hue % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  const hex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/* ------------------------------------------------------------- types de rendu */

interface DotRender {
  x: number
  y: number
  r: number
  opacity: number
  /** couleur explicite ; par defaut le rendu prend celle du corps */
  color?: string
  /**
   * Brume de profondeur : 0 = fondu dans le fond, 1 = couleur du corps pleine.
   * Le melange se fait au rendu, qui seul connait la couleur choisie.
   */
  depth?: number
  /**
   * Forme non circulaire, en unites de rayon de boule et centree sur l'origine
   * (le point du "!" penche est une goutte, pas un disque). Quand elle est
   * fournie, `r` n'est plus utilise pour le trace.
   */
  d?: string
  /** rotation appliquee a `d`, en degres */
  rot?: number
}

/**
 * Ce qu'un etat declare : la geometrie de l'arc reste en unites de rayon de
 * boule, c'est le moteur (seul a connaitre l'echelle du viewBox) qui la
 * rasterise. Sans ca les etats devraient connaitre le viewBox.
 */
interface ArcSpec {
  id: string
  seed: ArcSeed
  t: number
  opacity: number
}

interface ArcRender {
  id: string
  /** portion devant le corps */
  front: string
  /** portion derriere le corps (dessinee avant, donc masquee par la silhouette) */
  back: string
  width: number
  opacity: number
  /** degrade de teinte le long du trace */
  grad: { x1: number; y1: number; x2: number; y2: number; stops: string[] }
}

/* --------------------------------------------------------- arc elliptique 3D */

interface ArcSeed {
  /** demi-grand axe, en unites de rayon de boule */
  a: number
  /** aplatissement b/a : mesure <= 0.45, les plans d'orbite sont vus par la tranche */
  k: number
  /** inclinaison du grand axe a l'ecran, radians */
  tilt: number
  /** tours par seconde */
  speed: number
  phase: number
  /** fraction du tour reellement tracee */
  sweep: number
  hue: number
  hueSpan: number
  width: number
  cx: number
  cy: number
}

/**
 * Projette un cercle 3D incline en orthographique.
 *
 * Le cercle vit dans le plan engendre par u (dans l'ecran) et v (qui plonge
 * dans la profondeur). La composante z sert a couper l'arc en deux : la moitie
 * arriere est dessinee avant le corps, donc occultee par lui. C'est ce vrai tri
 * en profondeur qui fait lire les anneaux comme des orbites et pas comme un
 * dessin plat.
 */
function arcRender(seed: ArcSeed, t: number, scale: number, id: string, opacity = 1): ArcRender {
  const spin = seed.phase + t * seed.speed * TAU
  const cu = Math.cos(seed.tilt)
  const su = Math.sin(seed.tilt)
  const kz = Math.sqrt(Math.max(0, 1 - seed.k * seed.k))

  const N = 64
  const span = seed.sweep * TAU
  let front = ''
  let back = ''
  let prev: boolean | null = null

  for (let i = 0; i <= N; i++) {
    const th = spin + (i / N) * span
    const ct = Math.cos(th)
    const st = Math.sin(th)
    // u = (cos tilt, sin tilt, 0) ; v = (-sin tilt * k, cos tilt * k, kz)
    const x = seed.a * (ct * cu + st * -su * seed.k) + seed.cx
    const y = seed.a * (ct * su + st * cu * seed.k) + seed.cy
    const z = seed.a * st * kz

    const behind = z < 0
    const sx = r2(x * scale)
    const sy = r2(y * scale)
    const cmd = behind !== prev ? 'M' : 'L'
    if (behind) back += `${cmd}${sx} ${sy}`
    else front += `${cmd}${sx} ${sy}`
    prev = behind
  }

  const gx = Math.cos(seed.tilt) * seed.a * scale
  const gy = Math.sin(seed.tilt) * seed.a * scale
  return {
    id,
    front,
    back,
    width: seed.width * scale,
    opacity,
    grad: {
      x1: r2(seed.cx * scale - gx),
      y1: r2(seed.cy * scale - gy),
      x2: r2(seed.cx * scale + gx),
      y2: r2(seed.cy * scale + gy),
      stops: [wheel(seed.hue), wheel(seed.hue + seed.hueSpan * 0.5), wheel(seed.hue + seed.hueSpan)]
    }
  }
}

/* ---------------------------------------------------------------- anneaux */

const RING_RNG = createRng(0xa11ce)

/**
 * 6 anneaux, demi-grand axe 1.30-1.40 (donc nettement plus grands que la
 * boule), aplatissement toujours <= 0.45, epaisseur 0.055, ~3.3 tours/s.
 */
const RINGS: ArcSeed[] = Array.from({ length: 6 }, (_, i) => ({
  a: 1.3 + RING_RNG() * 0.1,
  k: 0.05 + RING_RNG() * 0.4,
  tilt: (i / 6) * Math.PI + RING_RNG() * 0.5,
  speed: 3 + RING_RNG() * 0.7,
  phase: RING_RNG() * TAU,
  sweep: 0.6 + RING_RNG() * 0.25,
  hue: (i * 360) / 6 + RING_RNG() * 30,
  hueSpan: 60 + RING_RNG() * 60,
  width: 0.05 + RING_RNG() * 0.012,
  cx: 0,
  cy: 0.1
}))

/**
 * Bouquet d'arcs emboites qui balaie le triangle juste avant les orbites.
 * Vus quasiment par la tranche (d'ou la forme en epingle a cheveux), rmax 1.37.
 */
const SWOOSH: ArcSeed[] = Array.from({ length: 4 }, (_, i) => ({
  a: 0.78 + i * 0.2,
  k: 0.05 + i * 0.02,
  tilt: -0.62 + i * 0.05,
  speed: 0.3,
  phase: 0.06 * i,
  sweep: 0.4,
  hue: 95 + i * 62,
  hueSpan: 100,
  width: 0.05,
  cx: 0,
  cy: -0.12
}))

/* ------------------------------------------------------------- 3 points */

/** x mesures : -0.557 / -0.013 / +0.532, y = 0. */
const DOT_X = [-0.557, -0.013, 0.532] as const
const DOT_R = 0.165
const DOT_PEAK = 1.25

/* ------------------------------------------------------------ particules */

const P_RNG = createRng(0xbeef)

/** 5 particules, une nouvelle toutes les 0.2 s, duree de vie 0.55 s. */
const PARTICLES = Array.from({ length: 5 }, (_, i) => ({
  birth: i * 0.2,
  angle: P_RNG() * TAU,
  rho: 0.58 + P_RNG() * 0.18
}))

/**
 * Les particules ne partent pas en ligne droite : elles spiralent vers le
 * centre (rayon x0.75 par frame, angle +100 deg/s) en grossissant, et passent
 * derriere le noyau ou elles sont avalees.
 */
function particles(t: number, scale: number): DotRender[] {
  const out: DotRender[] = []
  for (const p of PARTICLES) {
    const u = t - p.birth
    if (u < 0 || u > 0.62) continue
    const rho = p.rho * Math.pow(0.75, u * 10)
    const a = p.angle + (u * 100 * Math.PI) / 180
    out.push({
      x: Math.cos(a) * rho * scale,
      y: Math.sin(a) * rho * scale,
      r: (0.04 + 0.028 * clamp(u / 0.55)) * scale,
      depth: clamp(1 - rho / 0.8),
      opacity: clamp(u / 0.06) * clamp((0.62 - u) / 0.08)
    })
  }
  return out
}

/* ------------------------------------------------------------------ comete */

/**
 * Contrairement a l'intuition, le point ne traverse pas l'ecran : il reste au
 * centre et c'est la trainee qui l'orbite. Ellipse a = 0.85, b = 0.15,
 * grand axe incline de +34deg, 4 rubans, ~210 deg/s.
 */
const COMET_RNG = createRng(0xc0e7)
const COMET_RIBBONS: ArcSeed[] = Array.from({ length: 4 }, (_, i) => {
  const d = i - 1.5
  return {
    a: 0.85 * (1 + d * 0.03),
    // meme aplatissement a +-5 % pres : les rubans forment un faisceau serre
    k: (0.15 / 0.85) * (1 + d * 0.16),
    tilt: (34 * Math.PI) / 180 + d * 0.035,
    speed: 210 / 360,
    // dephasage mesure : 10 a 20 degres entre rubans, pas davantage
    phase: -i * 0.045 + COMET_RNG() * 0.012,
    sweep: 0.34,
    hue: i * 85 + COMET_RNG() * 20,
    hueSpan: 80,
    width: 0.095,
    cx: 0,
    cy: 0
  }
})

/** Rayon du point de la comete, mesure a 0.129. */
const COMET_DOT = 0.129

/* --------------------------------------------------- pastille notification */

/** Bleu releve au pixel. */
const NOTIF_BLUE = '#2496e8'
/** La pastille est posee exactement sur la circonference, a -42deg. */
const NOTIF_ANGLE = -42
const NOTIF_DIST = 1.003
/** Rayon au repos ; le pop culmine 14 % au-dessus. */
const NOTIF_R = 0.15
const NOTIF_POP = 1.14
/**
 * L'encoche est un disque concentrique a la pastille, soustrait du corps.
 * La marge est constante (0.054 R) et suit l'echelle du corps.
 */
const NOTIF_MARGIN = 0.054

// ── skins.ts ──────────────────────────────────────────────────────────

/**
 * Formes et couleurs proposees par le personnalisateur du bot.
 *
 * A la difference des silhouettes d'animation (`profiles.ts`), celles-ci ne sont
 * PAS relevees sur la video : elles sont construites analytiquement d'apres la
 * grille du personnalisateur d'origine. Deux sources distinctes, donc, et c'est
 * volontaire — les etats animes doivent rester fideles a la video, les formes de
 * base sont un choix d'utilisateur.
 */

/**
 * Les identifiants sont enumeres plutot que deduits du tableau : c'est ce qui
 * permet a la couche i18n de verifier A LA COMPILATION que chaque forme a bien
 * sa traduction dans les trois langues (`t(\`shapes.${id}\`)` ne compile que si
 * la cle existe). Un `as const` sur le tableau aurait le meme effet mais
 * rendrait `radii` en lecture seule, alors que le moteur le passe tel quel.
 */
type ShapeId =
  | 'cercle'
  | 'galet'
  | 'squircle'
  | 'capsule'
  | 'triangle'
  | 'hexagone'
  | 'nuage'
  | 'goutte'

interface BotShape {
  id: ShapeId
  radii: number[]
}

/** Ramene le rayon maximal a `max` pour que toutes les formes pesent pareil a l'oeil. */
function normalize(radii: number[], max = 1): number[] {
  const peak = Math.max(...radii)
  if (peak <= 0) return radii
  const k = max / peak
  return radii.map((r) => r * k)
}

const SKINS_ANGLES = Array.from({ length: PROFILE_SAMPLES }, (_, i) => (i / PROFILE_SAMPLES) * Math.PI * 2)

/** Galet : cercle deforme par deux harmoniques basses, donc irregulier mais lisse. */
const pebble = normalize(
  SKINS_ANGLES.map((a) => 1 + 0.075 * Math.cos(2 * a + 0.5) + 0.035 * Math.cos(3 * a + 2.1)),
  1.02
)

/** Nuage : union de bosses, large en bas, deux lobes en haut. */
const cloud = normalize(
  unionOfCirclesProfile([
    { x: -0.44, y: 0.2, r: 0.54 },
    { x: 0.46, y: 0.2, r: 0.5 },
    { x: 0.02, y: 0.3, r: 0.6 },
    { x: -0.24, y: -0.3, r: 0.48 },
    { x: 0.3, y: -0.24, r: 0.44 }
  ]),
  1.02
)

/** Goutte : gros disque en bas, pointe effilee en haut. */
const droplet = normalize(
  profileFromPolygon(hullOfCircles(0, 0.28, 0.66, 0, -0.96, 0.05), 0, 0),
  1.04
)

/** Capsule couchee : enveloppe de deux disques cote a cote. */
const capsule = profileFromPolygon(hullOfCircles(-0.42, 0, 0.62, 0.42, 0, 0.62), 0, 0)

const SHAPES: BotShape[] = [
  { id: 'cercle', radii: new Array(PROFILE_SAMPLES).fill(1) },
  { id: 'galet', radii: pebble },
  // 1.15 et pas 1.02 : sur une superellipse le rayon maximal est la diagonale,
  // donc normaliser dessus donne une forme qui parait plus petite que le cercle.
  { id: 'squircle', radii: normalize(superellipseProfile(4.2), 1.15) },
  { id: 'capsule', radii: capsule },
  // -90deg : un sommet vers le haut de l'ecran (y est oriente vers le bas)
  { id: 'triangle', radii: regularPolygonProfile(3, 1.12, 0.34, -90) },
  // 0deg : sommets a gauche et a droite, donc aretes du haut et du bas plates
  { id: 'hexagone', radii: regularPolygonProfile(6, 1.04, 0.26, 0) },
  { id: 'nuage', radii: cloud },
  { id: 'goutte', radii: droplet }
]

// Map indexee par `string` et non par `ShapeId` : les appelants interrogent avec
// une valeur relue du localStorage ou d'une prop, donc non validee.
const SHAPE_BY_ID = new Map<string, BotShape>(SHAPES.map((s) => [s.id, s]))
const DEFAULT_SHAPE = 'cercle'

type ColorId =
  | 'encre'
  | 'creme'
  | 'brun'
  | 'rouge'
  | 'orange'
  | 'ambre'
  | 'vert'
  | 'turquoise'
  | 'bleu'
  | 'violet'
  | 'rose'
  | 'gris'

interface BotColor {
  id: ColorId
  hex: string
}

/** Palette du personnalisateur d'origine. */
const COLORS: BotColor[] = [
  { id: 'encre', hex: '#0a0a0c' },
  { id: 'brun', hex: '#8b5e3c' },
  { id: 'rouge', hex: '#e8483f' },
  { id: 'orange', hex: '#f08a24' },
  { id: 'ambre', hex: '#f0b429' },
  { id: 'vert', hex: '#3ecf8e' },
  { id: 'turquoise', hex: '#2fbfa0' },
  { id: 'bleu', hex: '#3b93f0' },
  { id: 'violet', hex: '#8b5cf6' },
  { id: 'rose', hex: '#e152b0' },
  { id: 'gris', hex: '#a3a3a3' },
  { id: 'creme', hex: '#f1efe9' }
]

const COLOR_BY_ID = new Map<string, BotColor>(COLORS.map((c) => [c.id, c]))
const DEFAULT_COLOR = 'encre'

/** Melange deux couleurs hex. Sert a la brume de profondeur des particules. */
function mixHex(from: string, to: string, t: number): string {
  const parse = (h: string) => {
    const v = parseInt(h.slice(1), 16)
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
  }
  const a = parse(from)
  const b = parse(to)
  const c = a.map((x, i) => Math.round(x + (b[i]! - x) * t))
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`
}

// ── states.ts ──────────────────────────────────────────────────────────

interface EyeCfg {
  /** largeur locale (axe court de la gelule), en unites de rayon de boule */
  w: number
  /** hauteur locale (axe long) */
  h: number
  /** 1 = ouvert, 0 = ferme */
  open: number
  /**
   * Inclinaison propre de la gelule, en degres, positif = le haut part a
   * droite. Appliquee APRES le repere tangent de la sphere. Sans elle, les deux
   * yeux penchent forcement du meme cote (le roulis de tete) et la colere comme
   * la tristesse, qui demandent des inclinaisons en miroir, sont hors de portee.
   */
  tilt?: number
}

interface Pose {
  /** silhouette du corps, en unites de rayon de boule */
  sil: Silhouette
  /** decalage global du corps ET des yeux */
  offX: number
  offY: number
  gaze: HeadGaze
  /** demi-ecart des yeux sur la sphere, en degres */
  split: number
  /** [oeil interieur, oeil exterieur] */
  eyes: [EyeCfg, EyeCfg]
  /** opacite des yeux : sert aux etats sans visage */
  eyeAlpha: number
  bodyAlpha: number
  dots: DotRender[]
  arcs: ArcSpec[]
  notif: { x: number; y: number; r: number; notch: number } | null
  /** true = le decor passe derriere le corps (particules de l'eclatement) */
  dotsBehind: boolean
}

const pairPose = (w: number, h: number): [EyeCfg, EyeCfg] => [
  { w, h, open: 1 },
  { w, h, open: 1 }
]

function base(over: Partial<Pose> = {}): Pose {
  return {
    sil: circle(1),
    offX: 0,
    offY: 0,
    gaze: { ...REST_GAZE },
    split: EYE_SPLIT,
    eyes: pairPose(EYE_W, EYE_H),
    eyeAlpha: 1,
    bodyAlpha: 1,
    dots: [],
    arcs: [],
    notif: null,
    dotsBehind: false,
    ...over
  }
}

/* --------------------------------------------------- formes non radiales */

/**
 * Barre du "!" vertical : enveloppe convexe de deux cercles.
 * Mesure : cercle haut (0, -0.505) r 0.132, cercle bas (0, +0.130) r 0.075,
 * flancs rectilignes. Elle est donc tronconique (rapport haut/bas 1.76).
 */
const BAR_UPRIGHT_CY = -0.1875
const BAR_UPRIGHT = profileFromPolygon(
  hullOfCircles(0, -0.505, 0.132, 0, 0.13, 0.075),
  0,
  BAR_UPRIGHT_CY
)

/** Barre du "!" penche : capsule pure (largeur constante 0.269, longueur 0.776). */
const BAR_ITALIC = profileFromPolygon(hullOfCircles(0, -0.2535, 0.1345, 0, 0.2535, 0.1345), 0, 0)

const barUpright = (pose: Partial<Silhouette> = {}): Silhouette => ({
  radii: [...BAR_UPRIGHT],
  rot: 0,
  cx: 0,
  cy: BAR_UPRIGHT_CY,
  sx: 1,
  sy: 1,
  ...pose
})

const barItalic = (pose: Partial<Silhouette> = {}): Silhouette => ({
  radii: [...BAR_ITALIC],
  rot: 0,
  cx: 0,
  cy: 0,
  sx: 1,
  sy: 1,
  ...pose
})

/**
 * Le point du "!" penche n'est pas un disque : c'est une goutte, bout rond
 * (r 0.118) du cote de la barre et pointe effilee a l'oppose, longueur 0.300
 * dans l'axe du glyphe. Centree sur le barycentre du bout rond.
 */
const TEAR = polyPath(hullOfCircles(0, 0, 0.118, 0, 0.172, 0.012))

/**
 * Le triangle ne tourne pas sur lui-meme : son centre decrit un cercle de
 * rayon 0.213 autour de l'origine (mesure). C'est ce decalage qui donne
 * l'impression qu'il bascule au lieu de pivoter sur place.
 */
const TRI_ORBIT = 0.213

function spinningTriangle(rot: number): Silhouette {
  return silhouette('triangle', {
    rot,
    cx: -TRI_ORBIT * Math.sin(rot),
    cy: TRI_ORBIT * Math.cos(rot)
  })
}

/* ------------------------------------------------------------------ etats */

type StateId =
  | 'idle'
  | 'thinking'
  | 'wink'
  | 'wide'
  | 'alert'
  | 'notify'
  | 'exclaim'
  | 'sleep'
  | 'egg'
  | 'hexagon'
  | 'play'
  | 'orbit'
  | 'burst'
  | 'comet'
  /** transition d'interface, pas une animation du catalogue : hors `SEQUENCE` */
  | 'swirl'

interface StateDef {
  id: StateId
  /** duree de maintien quand la sequence complete est jouee */
  duration: number
  /**
   * duree en dessous de laquelle l'animation est coupee avant d'aboutir : le
   * "!" ne revient pas, le corps reste eclate. Elle se lit dans les constantes
   * de `pose` ci-dessous, elle ne se choisit pas. Absente = l'etat ignore le
   * temps ou boucle, n'importe quelle duree lui va (voir `MIN_BLOCK`).
   */
  minDuration?: number
  /** duree du morph d'entree */
  morph: number
  /** true = l'entree est masquee par un clignement, comme dans la video */
  blinkIn: boolean
  /**
   * true = le corps est la silhouette "au repos", donc remplacable par la forme
   * choisie dans le personnalisateur. Les etats qui dessinent leur propre forme
   * (le "!", les points, l'oeuf, le triangle...) valent false : c'est cette forme
   * la qui EST l'animation.
   */
  baseBody: boolean
  /**
   * true = l'etat porte le visage "au repos", donc remplacable par l'expression
   * choisie. Seul `idle` : les autres etats a visage ont une expression relevee
   * sur la video, c'est precisement ce qu'on reproduit.
   */
  baseFace: boolean
  pose(local: number): Pose
}

/** Onde de pulsation qui parcourt les trois points de gauche a droite. */
function dotPulse(t: number, index: number): number {
  const p = ((((t - index * 0.5) / 1.5) % 1) + 1) % 1
  const k = p < 0.5 ? 0.5 - 0.5 * Math.cos(p * TAU) : 0
  return clamp(k * 2)
}

const STATES: StateDef[] = [
  {
    id: 'idle',
    duration: 2.4,
    morph: 0.45,
    blinkIn: false,
    baseFace: true,
    baseBody: true,
    pose: () => base()
  },

  {
    id: 'thinking',
    duration: 2.6,
    morph: 0.4,
    baseFace: false,
    baseBody: false,
    blinkIn: true,
    pose: (t) => {
      const mid = dotPulse(t, 1)
      // Les points lateraux sortent des flancs de la boule : dans la video ils
      // restent fusionnes avec elle 1-2 frames avant de se detacher.
      const emerge = 0.3 + 0.7 * easings.easeOutCubic(clamp(t / 0.3))
      return base({
        // la boule DEVIENT le point du milieu : le morph reste continu
        sil: circle(DOT_R * (1 + (DOT_PEAK - 1) * mid), { cx: DOT_X[1]! }),
        eyeAlpha: 0,
        dots: [0, 2].map((i) => {
          const k = dotPulse(t, i)
          return {
            x: DOT_X[i]! * emerge,
            y: 0,
            r: DOT_R * (1 + (DOT_PEAK - 1) * k),
            opacity: 0.55 + 0.45 * k
          }
        })
      })
    }
  },

  {
    id: 'wink',
    duration: 1.6,
    morph: 0.3,
    blinkIn: true,
    baseFace: false,
    baseBody: true,
    pose: () =>
      base({
        gaze: { yaw: -5.37, pitch: 4.55, roll: 6.7 },
        split: 16.25,
        // L'oeil ferme n'est pas l'oeil ouvert ecrase : c'est un tiret
        // horizontal PLUS LARGE que l'oeil ouvert (0.447 contre 0.236).
        eyes: [
          { w: 0.236, h: 0.464, open: 1 },
          { w: 0.447, h: 0.089, open: 1 }
        ]
      })
  },

  {
    id: 'wide',
    duration: 1.8,
    morph: 0.55,
    blinkIn: true,
    baseFace: false,
    baseBody: true,
    pose: () =>
      base({
        gaze: { yaw: 6.92, pitch: -21.96, roll: 11.6 },
        split: 18.43,
        eyes: pairPose(0.356, 0.875)
      })
  },

  {
    id: 'alert',
    duration: 2.4,
    // le "!" revient en place a 1.6 + 0.4
    minDuration: 2,
    morph: 0.45,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    pose: (t) => {
      // Course mesuree : -0.087 -> +0.732 en 1.5 s, ease-in-out, micro-overshoot.
      const p = clamp(t / 1.5)
      const travel = easings.easeInOutCubic(p) * 0.82 - 0.087
      const back = t > 1.6 ? clamp((t - 1.6) / 0.4) : 0
      const x = travel * (1 - back) + 0.1 * back
      // Vibration secondaire a 2.5 Hz, barre et point en opposition de phase.
      const buzz = Math.sin(t * 2.5 * TAU) * 0.005
      const tilt = (17.7 * Math.PI) / 180
      return base({
        sil: barItalic({ rot: tilt, cx: x, cy: -0.325 - buzz }),
        eyeAlpha: 0,
        dots: [
          {
            // le point suit l'axe du glyphe, a 0.580 du centre de la barre
            x: x - Math.sin(tilt) * 0.58,
            y: -0.325 + Math.cos(tilt) * 0.58 + buzz * 2.8,
            r: 0.118,
            d: TEAR,
            rot: (tilt * 180) / Math.PI,
            opacity: 1
          }
        ]
      })
    }
  },

  {
    id: 'notify',
    duration: 2.2,
    morph: 0.5,
    blinkIn: true,
    baseFace: false,
    baseBody: true,
    pose: (t) => {
      // Pop du point bleu : pic a +14 % vers 0.3 s puis stabilisation.
      const p = clamp(t / 0.45)
      const pop = 1 + (NOTIF_POP - 1) * Math.sin(p * Math.PI) * (1 - p * 0.35)
      const r = NOTIF_R * (p < 1 ? pop : 1)
      const a = (NOTIF_ANGLE * Math.PI) / 180
      return base({
        // le regard part a l'oppose de la pastille
        gaze: { yaw: -21.94, pitch: -5.82, roll: -12.2 },
        split: 18.89,
        eyes: pairPose(0.505, 0.498),
        notif: {
          x: Math.cos(a) * NOTIF_DIST,
          y: Math.sin(a) * NOTIF_DIST,
          r,
          notch: r + NOTIF_MARGIN
        }
      })
    }
  },

  {
    id: 'exclaim',
    duration: 2,
    morph: 0.45,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    pose: () =>
      base({
        sil: barUpright(),
        eyeAlpha: 0,
        dots: [{ x: -0.012, y: 0.526, r: 0.113, opacity: 1 }]
      })
  },

  {
    id: 'sleep',
    duration: 2.4,
    morph: 0.5,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    pose: (t) =>
      base({
        // Rebond vertical mesure : +-0.19 autour de +0.11, periode 0.6 s.
        sil: circle(0.1585, { cy: 0.11 + Math.sin(t * (TAU / 0.6)) * 0.19 }),
        eyeAlpha: 0
      })
  },

  {
    id: 'egg',
    duration: 1.8,
    morph: 0.4,
    baseFace: false,
    baseBody: false,
    blinkIn: true,
    pose: () =>
      base({
        sil: silhouette('egg'),
        gaze: { yaw: 19.97, pitch: 26.01, roll: -17.1 },
        // les yeux se resserrent comme le corps
        split: 11.07,
        eyes: pairPose(0.164, 0.385)
      })
  },

  {
    id: 'hexagon',
    duration: 1.6,
    morph: 0.4,
    baseFace: false,
    baseBody: false,
    blinkIn: true,
    pose: () =>
      base({
        sil: silhouette('hexagon'),
        gaze: { yaw: 23.11, pitch: 24.42, roll: -13.3 },
        split: 13.37,
        eyes: pairPose(0.177, 0.411)
      })
  },

  {
    id: 'play',
    duration: 2,
    morph: 0.5,
    baseFace: false,
    baseBody: false,
    blinkIn: true,
    pose: (t) => {
      // Le triangle reste quasi immobile pendant que le bouquet le traverse.
      const fade = clamp(t / 0.35) * clamp((2.2 - t) / 0.5)
      return base({
        sil: spinningTriangle(0),
        gaze: { yaw: 12, pitch: -8, roll: -6 },
        split: 15,
        eyes: pairPose(0.18, 0.34),
        // le bouquet balaie de la droite vers la gauche par-dessus le triangle
        arcs: SWOOSH.map((s, i) => ({
          id: `sw${i}`,
          seed: { ...s, cx: 0.45 - t * 0.42 },
          t,
          opacity: fade
        }))
      })
    }
  },

  {
    id: 'orbit',
    duration: 3.4,
    // le corps a fini de se relacher du triangle vers la boule a 1.6 + 0.9
    minDuration: 2.5,
    morph: 0.6,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    pose: (t) => {
      // Rotation mesuree : rampe sur 0.35 s puis 1.25 tour/s (sens antihoraire).
      const ramp = easings.easeInOutCubic(clamp(t / 0.35))
      const rot = -TAU * 1.25 * t * ramp
      // Le corps se relache du triangle vers la boule pendant l'orbite.
      const back = easings.easeInOutCubic(clamp((t - 1.6) / 0.9))
      const tri = spinningTriangle(rot)
      const ball = circle(1, { rot })
      const sil: Silhouette = {
        radii: tri.radii.map((r, i) => r + (ball.radii[i]! - r) * back),
        rot,
        cx: tri.cx * (1 - back),
        cy: tri.cy * (1 - back),
        sx: 1,
        sy: 1
      }
      const fade = clamp(t / 0.8) * clamp((3.6 - t) / 0.9)
      return base({
        sil,
        // les yeux filent autour de la sphere ~3x plus vite que la silhouette
        gaze: {
          yaw: REST_GAZE.yaw + Math.sin(t * 6.5) * 65 * (1 - back),
          pitch: -4 + back * 32,
          roll: -13
        },
        eyes: pairPose(0.18, 0.34 + back * 0.07),
        // les anneaux entrent un par un sur 0.8 s
        arcs: RINGS.map((s, i) => ({
          id: `rg${i}`,
          seed: s,
          t,
          opacity: fade * clamp((t - i * 0.13) / 0.3)
        }))
      })
    }
  },

  {
    /**
     * Entree dans la vue des reglages.
     *
     * SEUL etat qui n'est pas releve sur la video : il est CHOISI, comme la
     * couleur `--ink`. Il emprunte le vocabulaire d'`orbit` — les memes anneaux,
     * avec leurs parametres mesures — mais coupe court : 1 s au lieu de 3,4, la
     * moitie des anneaux, et aucun triangle.
     *
     * Les deux drapeaux a `true` sont tout l'interet de cet etat :
     *
     * - `baseBody` laisse la forme choisie remplacer le corps, donc la vue peut
     *   imposer le cercle et le galet ou la goutte y MORPHENT au lieu de sauter ;
     * - `baseFace` fait porter le visage de repos, donc le suivi du curseur
     *   s'applique des cette entree. Un etat qui aurait sa propre pose de regard
     *   (comme `orbit`) rendrait la main a l'etat suivant en pleine course, et
     *   les yeux sauteraient d'un coup a la reprise.
     *
     * Il n'est volontairement PAS dans `SEQUENCE` : ce n'est pas une animation du
     * catalogue, c'est une transition d'interface.
     */
    id: 'swirl',
    // un peu plus que le tour du regard (`TURN_TIME`, 1,1 s) : les yeux doivent
    // etre poses a gauche avant que les anneaux ne s'effacent
    duration: 1.3,
    minDuration: 1.3,
    morph: 0.3,
    baseFace: true,
    baseBody: true,
    // le morph de forme est masque par un clignement, comme partout ailleurs
    blinkIn: true,
    pose: (t) =>
      base({
        // trois anneaux sur les six d'`orbit` : la moitie du bouquet suffit a le
        // reconnaitre, et c'est autant d'arcs en moins a rasteriser par image
        arcs: RINGS.slice(0, 3).map((s, i) => ({
          id: `sw${i}`,
          seed: s,
          t,
          // ils entrent l'un apres l'autre puis s'effacent avant la fin du bloc,
          // pour que la reprise au repos se fasse sur une image deja propre
          opacity: clamp((t - i * 0.06) / 0.14) * clamp((1.22 - t) / 0.34)
        }))
      })
  },

  {
    id: 'burst',
    duration: 2.6,
    // le corps est recompose a 1.7 + 0.7
    minDuration: 2.4,
    morph: 0.4,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    pose: (t) => {
      // Effondrement mesure : 1.0 -> 0.166 en 0.7 s, ease-out, sans rebond.
      const collapse = 1 - 0.834 * easings.easeOutQuint(clamp(t / 0.7))
      const regrow = easings.easeOutQuint(clamp((t - 1.7) / 0.7))
      return base({
        sil: circle(collapse + (1 - collapse) * regrow),
        eyeAlpha: clamp((t - 1.85) / 0.4),
        dots: particles(t, 1),
        dotsBehind: true
      })
    }
  },

  {
    id: 'comet',
    duration: 2.4,
    // le point se recompose a 1.85 + 0.6 = 2.45, soit 0.05 s apres la coupe de
    // la video : ce reliquat se termine pendant le fondu suivant, comme dans la
    // reference. On ne descend donc pas sous la duree mesuree.
    minDuration: 2.4,
    morph: 0.45,
    baseFace: false,
    baseBody: false,
    blinkIn: false,
    pose: (t) => {
      const collapse = 1 - (1 - COMET_DOT) * easings.easeOutQuint(clamp(t / 0.55))
      const regrow = easings.easeOutQuint(clamp((t - 1.85) / 0.6))
      const fade = clamp((t - 0.15) / 0.25) * clamp((1.95 - t) / 0.3)
      return base({
        // Le point derive de 0.035 vers le bas puis remonte (wobble mesure).
        sil: circle(collapse + (1 - collapse) * regrow, {
          cy: Math.sin(clamp(t / 1.7) * Math.PI) * 0.035
        }),
        eyeAlpha: clamp((t - 2) / 0.35),
        arcs: COMET_RIBBONS.map((s, i) => ({ id: `cm${i}`, seed: s, t, opacity: fade }))
      })
    }
  }
]

const STATE_BY_ID = new Map(STATES.map((s) => [s.id, s]))

/** Ordre de lecture de la sequence complete, calque sur la video de reference. */
/**
 * Date, en temps local, ou chaque etat est le plus lisible : c'est la pose que
 * montrent les vignettes et la planche. Rendu deterministe, donc comparable
 * d'une execution a l'autre. Le type force a couvrir tout nouvel etat.
 */
const POSES: Record<StateId, number> = {
  idle: 1,
  thinking: 1.1,
  wink: 0.8,
  wide: 0.8,
  alert: 0.75,
  notify: 0.9,
  exclaim: 0.8,
  sleep: 0.45,
  egg: 0.8,
  hexagon: 0.8,
  play: 0.9,
  orbit: 1.2,
  swirl: 0.5,
  burst: 0.45,
  comet: 1.15
}

const SEQUENCE: StateId[] = [
  'idle',
  'thinking',
  'wink',
  'wide',
  'alert',
  'notify',
  'exclaim',
  'sleep',
  'egg',
  'hexagon',
  'play',
  'orbit',
  'burst',
  'comet'
]

// ── eyefit.ts ──────────────────────────────────────────────────────────
/**
 * Ou poser le visage sur une forme du personnalisateur.
 *
 * Les yeux vivent sur une sphere, et `radiusAtAngle` les recolle au contour reel au
 * prorata du rayon local. Ce prorata place bien leur CENTRE, mais l'oeil a une taille :
 * la marge qui lui reste devant le bord est multipliee par le meme facteur, donc une
 * silhouette etroite dans sa direction le pousse contre le bord jusqu'a ce que le
 * masque l'ouvre vers l'exterieur. La gelule apparaissait comme une encoche dans le
 * corps sur `capsule`, `triangle`, `nuage` et `goutte`.
 *
 * Ce module resout le probleme UNE FOIS, au chargement, et rend une table de decalages.
 * Ce choix est l'essentiel du correctif, bien plus que la geometrie qui suit :
 *
 * Resolue dans la boucle de rendu, la correction reagit a tout ce qui bouge a soixante
 * images par seconde — la derive du regard, le pointeur, l'expression en cours de
 * morph, le bord le plus proche qui change, l'oeil le plus contraint qui change. Sept
 * variantes ont ete ecrites ainsi et toutes produisaient un artefact de mouvement
 * visible : tremblement permanent, saut de direction de 26 unites quand le bord de
 * reference basculait, grossissement brusque quand la taille entrait dans le calcul.
 * Le defaut n'etait dans aucune de leurs geometries, il etait dans le fait de resoudre
 * par image.
 *
 * Le reste du moteur ne travaille pas comme ca : les poses sont DECLAREES et il ne fait
 * que les interpoler avec des courbes connues. Un decalage tabule rentre dans ce moule.
 * Il ne bouge pas quand le regard derive ni quand le pointeur bouge, et sur un changement
 * de forme ou d'expression il ne fait qu'aller d'une entree de table a l'autre, sur la
 * courbe de ce morph. Le tremblement devient impossible par construction, au lieu d'etre
 * repousse : interpoler entre deux constantes est monotone, alors que re-resoudre le
 * probleme sur un regard en cours d'interpolation ne l'est pas.
 *
 * Corollaire agreable : le solveur n'a plus aucune contrainte de continuite, puisqu'il ne
 * tourne pas pendant l'animation. Il peut donc sonder tout un faisceau de directions et
 * couvrir le pire cas de la derive du regard, ce qu'une version par image ne pouvait pas
 * se permettre.
 *
 * La table est une constante de module, batie a l'import a partir de donnees pures :
 * meme nature que le calendrier de clignements de `face.ts`, deterministe et sans etat,
 * donc sans effet sur la purete de `engine.sample(t)`.
 */


/** Rayon de reference du solveur. Le decalage rendu est en unites de ce rayon. */
const R = 100

/**
 * Amplitudes maximales de la vie au repos, lues sur `liveliness` : `loopNoise` est
 * borne a 1 en valeur absolue, donc ces sommes sont des bornes exactes et non des
 * estimations.
 *
 * Il faut les couvrir, sinon la correction est juste sur la pose nominale et fausse une
 * seconde plus tard : 7 degres de lacet deplacent l'oeil d'une douzaine d'unites sur une
 * boule de rayon 100. C'est precisement ce qui faisait deborder `capsule` + `effraye`
 * alors qu'une mesure a un seul instant le declarait bon.
 */
const DERIVE_YAW = 5.5 + 1.6
const DERIVE_PITCH = 4.2 + 1.3
/** Flottement du centre, en unites de rayon de boule. */
const DERIVE_X = 0.006
const DERIVE_Y = 0.007

/** Le visage d'une pose, ce dont le solveur a besoin pour placer ses gelules. */
interface Visage {
  gaze: Pose['gaze']
  split: number
  eyes: Pose['eyes']
}

/**
 * Une gelule prete a etre mesuree : le segment de son axe, et de quoi calculer le rayon
 * a degager DANS UNE DIRECTION donnee.
 *
 * Une gelule est exactement un segment epaissi d'un disque de rayon `r`. Son image par la
 * matrice tangente est donc un segment epaissi d'une ELLIPSE, et le rayon a degager
 * depend de la direction : c'est la fonction d'appui de cette ellipse, `r * |A^T u|`.
 *
 * Prendre a la place sa plus grande valeur singuliere serait conservateur mais faux dans
 * la seule direction qui compte, et ca se paie cher : la marge de reference sur le cercle
 * ressortait NEGATIVE, donc la demande devenait sans dents et 34 combinaisons
 * continuaient de deborder.
 */
interface Empreinte {
  /** centre, en unites de viewBox */
  x: number
  y: number
  /** demi-vecteur de l'axe */
  ax: number
  ay: number
  /** rayon du disque local, avant transformation */
  r: number
  /** colonnes de la matrice tangente, pour la fonction d'appui */
  m: [number, number, number, number]
}

/**
 * Empreintes des deux yeux d'un visage, posees sur un profil.
 *
 * Une gelule est exactement un segment epaissi d'un disque de rayon `r`. Son image par
 * la matrice tangente est donc un segment epaissi d'une ELLIPSE, et un disque du rayon
 * de son grand axe la couvre : d'ou la plus grande valeur singuliere. La mesure reste
 * ainsi conservatrice au sens strict, une marge positive garantissant que la gelule est
 * dedans.
 *
 * Le clignement n'y est pas : un oeil ferme n'a pas besoin qu'on lui fasse de la place.
 */
function empreintes(visage: Visage, sil: Pose['sil'], radii: number[]): Empreinte[] {
  const out: Empreinte[] = []
  const poses = eyePoses(visage.gaze, R, visage.split)
  for (let i = 0; i < 2; i++) {
    const e = poses[i]!
    if (e.depth <= 0.02) continue
    const cfg = visage.eyes[i]!
    const phi = ((cfg.tilt ?? 0) * Math.PI) / 180
    const cp = Math.cos(phi)
    const sp = Math.sin(phi)
    const ax = e.a * cp + e.c * sp
    const ay = e.b * cp + e.d * sp
    const cx = -e.a * sp + e.c * cp
    const cy = -e.b * sp + e.d * cp

    const hw = Math.max(cfg.w * R, 0.01) / 2
    const hh = Math.max(cfg.h * R, 0.01) / 2
    const r = Math.min(hw, hh)
    // l'axe est celui de la plus grande dimension
    const long = hh > hw
    const demi = long ? hh - r : hw - r
    // le prorata du rayon local, exactement comme le fait le moteur
    const fit = radiusAtAngle(radii, Math.atan2(e.y, e.x) - sil.rot)
    out.push({
      x: e.x * fit,
      y: e.y * fit,
      ax: (long ? cx : ax) * demi,
      ay: (long ? cy : ay) * demi,
      r,
      m: [ax, ay, cx, cy]
    })
  }
  return out
}

/**
 * Approche la plus courte entre un contour et un segment : la distance, et le vecteur
 * qui va du contour vers le segment — le sens qui degage.
 *
 * Les deux sortent de la MEME passe. Les calculer separement doublait le seul vrai cout
 * de ce module, qui est ce balayage.
 */
function approche(pts: Point[], x0: number, y0: number, x1: number, y1: number) {
  const sx = x1 - x0
  const sy = y1 - y0
  const len2 = sx * sx + sy * sy
  let best = Infinity
  let vx = 0
  let vy = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!
    let t = len2 > 0 ? ((p.x - x0) * sx + (p.y - y0) * sy) / len2 : 0
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const ex = x0 + t * sx - p.x
    const ey = y0 + t * sy - p.y
    const d2 = ex * ex + ey * ey
    if (d2 < best) {
      best = d2
      vx = ex
      vy = ey
    }
  }
  const d = Math.sqrt(best)
  return { d, ux: d > 1e-9 ? vx / d : 0, uy: d > 1e-9 ? vy / d : 0 }
}

/** Une epreuve : des gelules a faire tenir dans un contour, et le contour de reference. */
interface Epreuve {
  empreintes: Empreinte[]
  reference: Empreinte[]
  contour: Point[]
  calContour: Point[]
}

/**
 * Flottement du centre au repos, en unites de viewBox. Il est ajoute au rayon de la
 * gelule : moins d'une unite, donc l'absorber ainsi coute moins cher que de multiplier les
 * epreuves par ses quatre coins.
 */
const FLOTTEMENT = Math.hypot(DERIVE_X, DERIVE_Y) * R

/** Marge de la gelule la plus serree, et le sens qui la degage. */
function pire(pts: Point[], emps: Empreinte[], tx: number, ty: number) {
  let marge = Infinity
  let ux = 0
  let uy = 0
  for (const e of emps) {
    const x = e.x + tx
    const y = e.y + ty
    const a = approche(pts, x - e.ax, y - e.ay, x + e.ax, y + e.ay)
    // fonction d'appui de l'ellipse dans la direction de l'approche
    const [m0, m1, m2, m3] = e.m
    const rayon =
      e.r * Math.hypot(m0 * a.ux + m1 * a.uy, m2 * a.ux + m3 * a.uy) + FLOTTEMENT
    if (a.d - rayon < marge) {
      marge = a.d - rayon
      ux = a.ux
      uy = a.uy
    }
  }
  return { marge, ux, uy }
}

/**
 * Directions sondees et pas de la dichotomie. Le produit des deux est le cout de
 * construction de la table, seul chiffre a surveiller ici.
 */
const DIRECTIONS = 12
const DICHOTOMIE = 8

/**
 * Le decalage a poser sur les deux yeux pour cette forme, cet etat et cette expression.
 *
 * Une TRANSLATION commune aux deux yeux, donc une isometrie : ecart entre les yeux,
 * tailles et inclinaisons sont conserves au pixel. Le visage est seulement pose un peu
 * plus bas sur un corps qui n'a pas de place en haut, ce qui est le geste qu'on ferait a
 * la main. Les variantes qui bornaient chaque oeil separement ecartaient la paire, et
 * celles qui mettaient le visage a l'echelle rapetissaient les yeux — visiblement.
 *
 * La marge visee est celle du profil D'ORIGINE, pas un degagement strict : sur le cercle
 * l'oeil exterieur frole deja le bord, 17,3 unites pour une boule de rayon 100, et c'est
 * voulu, c'est ce qui donne le volume. Elle est plafonnee par ce que la forme offre en son
 * centre, sinon la demande est intenable sur un corps plat.
 *
 * RECHERCHE DIRECTIONNELLE et non descente. On cherche la translation de plus petite
 * norme qui tient, donc on sonde une couronne de directions et on dichotomie la distance
 * le long de chacune. Une descente de gradient a ete ecrite d'abord et elle ne converge
 * pas : degager la paire d'un bord la rapproche de l'autre, si bien qu'elle tatonne et ne
 * fait que garder son meilleur essai — passer ses tours de 40 a 18 suffisait a faire
 * reapparaitre 34 debordements. Ici le resultat ne depend pas d'une convergence : chaque
 * direction est resolue exactement, au pas de dichotomie pres.
 */
function resous(epreuves: Epreuve[]): { x: number; y: number } {
  if (!epreuves.length) return { x: 0, y: 0 }

  /** La marge la plus serree sur toutes les epreuves, pour une translation donnee. */
  const marge = (tx: number, ty: number) => {
    let m = Infinity
    for (const ep of epreuves) m = Math.min(m, pire(ep.contour, ep.empreintes, tx, ty).marge)
    return m
  }

  // Marge exigee : la plus serree que le profil d'origine tolere, sur toutes les
  // epreuves. Puis plafonnee par le plus degage que la forme puisse offrir a la paire,
  // son centre.
  let requis = Infinity
  for (const ep of epreuves) {
    requis = Math.min(requis, pire(ep.calContour, ep.reference, 0, 0).marge)
  }
  /*
   * La course doit pouvoir atteindre le centre du corps : `wide` a des gelules de 87
   * unites de long, et sur un triangle elles ne tiennent que vers le milieu, a une
   * cinquantaine d'unites de leur place nominale. Une course fixe les laissait dehors.
   */
  let mx = 0
  let my = 0
  const emps = epreuves[0]!.empreintes
  for (const e of emps) {
    mx -= e.x / emps.length
    my -= e.y / emps.length
  }
  const course = Math.max(0.35 * R, Math.hypot(mx, my) * 1.25)

  // Plafond de la demande : ce que la forme offre en son centre, toujours atteignable.
  requis = Math.min(requis, marge(mx, my))

  /*
   * Deja bon : le cas du cercle, et de toute forme assez large. La gelule doit RENTRER
   * en plus de n'etre pas plus serree que sur le profil d'origine — sans cette seconde
   * condition, une forme ou rien ne rentre satisfait la premiere de facon degeneree et
   * on abandonnait. `wide` a des gelules de 87 unites de long, `notify` de 50 de
   * diametre : sur un triangle ou une goutte elles debordent quoi qu'on fasse, et il
   * faut alors viser le moins pire, pas renoncer.
   */
  const depart = marge(0, 0)
  if (depart >= requis && depart >= 0) return { x: 0, y: 0 }
  const cible = Math.max(requis, 0)

  let meilleurX = 0
  let meilleurY = 0
  let meilleureNorme = Infinity
  // repli quand rien ne rentre : la translation qui degage le plus, sondee au passage
  let secoursX = 0
  let secoursY = 0
  let secours = depart

  for (let d = 0; d < DIRECTIONS; d++) {
    const a = (d / DIRECTIONS) * Math.PI * 2
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    if (marge(ux * course, uy * course) < cible) {
      // cette direction ne mene nulle part ; on garde quand meme le meilleur degagement
      // pas de solution par la, mais peut-etre un meilleur degagement
      for (const k of [0.3, 0.6, 1]) {
        const m = marge(ux * course * k, uy * course * k)
        if (m > secours) {
          secours = m
          secoursX = ux * course * k
          secoursY = uy * course * k
        }
      }
      continue
    }
    // la plus courte distance qui tient, le long de cette direction
    let bas = 0
    let haut = course
    for (let i = 0; i < DICHOTOMIE; i++) {
      const mid = (bas + haut) / 2
      if (marge(ux * mid, uy * mid) >= cible) haut = mid
      else bas = mid
    }
    if (haut < meilleureNorme) {
      meilleureNorme = haut
      meilleurX = ux * haut
      meilleurY = uy * haut
    }
  }

  const x = meilleureNorme === Infinity ? secoursX : meilleurX
  const y = meilleureNorme === Infinity ? secoursY : meilleurY
  // rendu en unites de RAYON DE BOULE : le moteur le remet a son echelle
  return { x: +(x / R).toFixed(6), y: +(y / R).toFixed(6) }
}

/**
 * Le visage a couvrir : celui de l'expression si l'etat l'accepte, le sien sinon.
 *
 * UNE entree de table par expression, et non un pire cas commun a toutes. Un pire cas
 * paraissait plus sur — un decalage constant ne peut pas bouger quand l'expression change
 * — mais il est intenable : sur une capsule, `neutre` a les yeux hauts et demande a
 * descendre quand `effraye` les a bas et demande a monter. Aucune translation unique ne
 * satisfait les deux, et la mesure le confirme (4 debordements de 4,8 unites).
 *
 * Une entree par expression n'est pas moins fluide pour autant : le moteur interpole
 * entre DEUX CONSTANTES, ce qui est monotone par construction. Ce qui tremblait, c'etait
 * de re-resoudre le probleme sur un regard en cours d'interpolation.
 */
function visageDe(def: StateDef, pose: Pose, expr: BotExpression | null): Visage {
  if (def.baseFace && expr) return { gaze: expr.gaze, split: expr.split, eyes: expr.eyes }
  return { gaze: pose.gaze, split: pose.split, eyes: pose.eyes }
}

/** Les dates a echantillonner dans un etat : une seule si sa pose ne bouge pas. */
function dates(def: StateDef): number[] {
  /** Tout ce dont le solveur se sert : si rien ne bouge, une date suffit. */
  const signature = (p: Pose) =>
    JSON.stringify([p.gaze, p.split, p.eyes, p.sil.rot, p.sil.cx, p.sil.cy, p.sil.sx, p.sil.sy])
  if (signature(def.pose(0)) === signature(def.pose(def.duration))) return [0]
  const n = 3
  return Array.from({ length: n }, (_, i) => (i / (n - 1)) * def.duration)
}

/** Le decalage d'une forme sur un etat et une expression, derive comprise. */
function decalagePour(
  def: StateDef,
  radii: number[],
  expr: BotExpression | null
): { x: number; y: number } {
  const epreuves: Epreuve[] = []
  for (const t of dates(def)) {
    const pose = def.pose(t)
    const contour = toPoints({ ...pose.sil, radii }, R)
    const calContour = toPoints(pose.sil, R)
    const v = visageDe(def, pose, expr)
    // Les quatre coins de la derive bornent la pose nominale, qui est leur centre : la
    // tester en plus ne changerait aucune marge et coute une epreuve sur cinq.
    const coins: Visage[] = []
    for (const dy of [-DERIVE_YAW, DERIVE_YAW]) {
      for (const dp of [-DERIVE_PITCH, DERIVE_PITCH]) {
        coins.push({
          ...v,
          gaze: { yaw: v.gaze.yaw + dy, pitch: v.gaze.pitch + dp, roll: v.gaze.roll }
        })
      }
    }
    for (const c of coins) {
      epreuves.push({
        empreintes: empreintes(c, pose.sil, radii),
        reference: empreintes(c, pose.sil, pose.sil.radii),
        contour,
        calContour
      })
    }
  }
  return resous(epreuves)
}

/** Zero, la valeur commune a tout ce qui n'a rien a corriger. */
const NUL = { x: 0, y: 0 } as const

/** Clef d'une entree : l'etat, et l'expression quand l'etat l'accepte. */
const clef = (state: StateId, expr: string | null) => `${state}|${expr ?? ''}`

/**
 * Table des decalages, batie a l'import : une entree par (forme, etat a corps de base,
 * expression). Seuls `idle` et `swirl` portent le visage de repos, donc seuls eux se
 * declinent par expression — les trois autres etats a corps de base ont un visage releve
 * sur la video et une seule entree.
 *
 * Clef par REFERENCE du tableau de rayons, ce qui est deja la convention du moteur : ses
 * gardes `radii === this.shape` et `expression === this.expr` reposent sur la meme
 * stabilite. Un profil inconnu, ou `null`, ne corrige rien — l'API accepte n'importe quel
 * tableau et le moteur n'a pas a dependre de la prudence de ses appelants.
 */
function batir(): Map<number[], Map<string, { x: number; y: number }>> {
  return new Map(
  SHAPES.map((forme) => {
    const par = new Map<string, { x: number; y: number }>()
    for (const def of STATES) {
      if (!def.baseBody) continue
      const expressions = def.baseFace ? [null, ...EXPRESSIONS] : [null]
      for (const expr of expressions) {
        par.set(clef(def.id, expr?.id ?? null), decalagePour(def, forme.radii, expr))
      }
    }
    return [forme.radii, par]
  })
  )
}

const DECALAGES = batir()

/**
 * Decalage a appliquer aux deux yeux pour cette forme sur cet etat, en unites de rayon
 * de boule — le moteur le remet a son echelle.
 *
 * Vaut zero des que la forme n'est pas au catalogue, ce qui couvre `null` et le cercle :
 * sur le cercle les deux profils sont le meme, donc la marge est deja celle exigee et la
 * descente sort au premier tour. La forme relevee sur la video ne bouge donc pas, sans
 * cas particulier.
 */
function decalageDesYeux(
  radii: number[] | null,
  state: StateId,
  expr: string | null
): { x: number; y: number } {
  if (!radii) return NUL
  const par = DECALAGES.get(radii)
  if (!par) return NUL
  // un etat sans visage de repos n'a qu'une entree, quelle que soit l'expression
  return par.get(clef(state, expr)) ?? par.get(clef(state, null)) ?? NUL
}

/** Pour les tests : de quoi verifier la table sans refaire la geometrie. */
/** Pour les tests : de quoi chronometrer la construction de la table. */
const POUR_TESTS = { batir }

// ── engine.ts ──────────────────────────────────────────────────────────

interface RenderedEye {
  d: string
  matrix: string
  alpha: number
}

interface BotFrame {
  bodyPath: string
  bodyAlpha: number
  eyes: RenderedEye[]
  dots: DotRender[]
  /** true = les points passent derriere le corps (particules de l'eclatement) */
  dotsBehind: boolean
  arcs: ArcRender[]
  notif: { x: number; y: number; r: number } | null
  notch: { x: number; y: number; r: number } | null
}

/**
 * Ou le bot porte son regard quand quelque chose d'exterieur le pilote — le
 * pointeur de la souris, aujourd'hui.
 *
 * `yaw` et `pitch` sont des directions ABSOLUES, qui remplacent celles de la pose
 * a mesure que `mix` monte. Deux raisons, chacune un piege deja tombe :
 *
 * - c'est le MOTEUR qui doit faire ce melange, pas l'appelant, parce que lui seul
 *   connait la pose A CET INSTANT. Un appelant qui compenserait l'orientation de
 *   l'expression lirait sa valeur d'arrivee pendant que le morph est encore en
 *   cours, et les yeux sautaient a chaque changement d'humeur ;
 * - et il faut que ce soit absolu sur les DEUX axes. En relatif, la hauteur des
 *   yeux suivait celle de chaque expression — « neutre » regarde a +28,6deg quand
 *   les autres sont entre -9 et +9 — donc les yeux tombaient d'un coup au premier
 *   changement d'humeur. Ce qui fait le caractere d'une expression pendant le
 *   suivi, c'est la FORME de ses yeux (plisses, ronds, dissymetriques), pas
 *   l'endroit ou elle regarde : celui-la, c'est le curseur qui le decide.
 *
 * `mix` dit a quel point l'exterieur commande la DIRECTION (0 = pas du tout).
 *
 * `wander` dit, separement, ce qui reste de derive automatique. Les deux ne se
 * confondent pas : quand le pointeur bouge, la derive doit s'eteindre — cumulees,
 * le bot aurait l'air de chercher le curseur sans jamais le tenir. Mais quand il
 * n'y a PAS de pointeur (arrivee au clavier, au tactile, ou souris sortie de la
 * fenetre), la tete doit rester tournee ET continuer de vivre. Les confondre
 * figeait le regard des que la vue s'ouvrait.
 *
 * `spin` est un tour a parcourir EN CHEMIN, en degres, qu'on fait fondre vers 0
 * avec l'arrivee. Comme les yeux vivent sur une sphere, un tour les fait passer
 * derriere la boule et revenir de l'autre cote — et `-360deg` etant le meme
 * angle que `0`, il ne change rien a l'endroit ou ils se posent.
 */
interface Look {
  yaw: number
  pitch: number
  mix: number
  spin: number
  wander: number
}

const NO_LOOK: Look = { yaw: 0, pitch: 0, mix: 0, spin: 0, wander: 1 }

const lerpLook = (a: Look, b: Look, t: number): Look => ({
  yaw: lerp(a.yaw, b.yaw, t),
  pitch: lerp(a.pitch, b.pitch, t),
  mix: lerp(a.mix, b.mix, t),
  spin: lerp(a.spin, b.spin, t),
  wander: lerp(a.wander, b.wander, t)
})

const lerpEye = (a: Pose['eyes'][number], b: Pose['eyes'][number], t: number) => ({
  w: lerp(a.w, b.w, t),
  h: lerp(a.h, b.h, t),
  open: lerp(a.open, b.open, t),
  tilt: lerp(a.tilt ?? 0, b.tilt ?? 0, t)
})

/** Interpolation de deux poses. Le decor se croise en opacite, pas en geometrie. */
function blendPose(a: Pose, b: Pose, t: number): Pose {
  const out = 1 - t
  return {
    sil: blend(a.sil, b.sil, t),
    offX: lerp(a.offX, b.offX, t),
    offY: lerp(a.offY, b.offY, t),
    gaze: {
      yaw: lerp(a.gaze.yaw, b.gaze.yaw, t),
      pitch: lerp(a.gaze.pitch, b.gaze.pitch, t),
      roll: lerp(a.gaze.roll, b.gaze.roll, t)
    },
    split: lerp(a.split, b.split, t),
    eyes: [lerpEye(a.eyes[0], b.eyes[0], t), lerpEye(a.eyes[1], b.eyes[1], t)],
    eyeAlpha: lerp(a.eyeAlpha, b.eyeAlpha, t),
    bodyAlpha: lerp(a.bodyAlpha, b.bodyAlpha, t),
    dots: [
      ...a.dots.map((d) => ({ ...d, opacity: d.opacity * out })),
      ...b.dots.map((d) => ({ ...d, opacity: d.opacity * t }))
    ],
    arcs: [
      ...a.arcs.map((r) => ({ ...r, id: `a${r.id}`, opacity: r.opacity * out })),
      ...b.arcs.map((r) => ({ ...r, id: `b${r.id}`, opacity: r.opacity * t }))
    ],
    // la pastille appartient a un seul des deux etats, elle ne se melange pas
    notif: t < 0.5 ? a.notif : b.notif,
    dotsBehind: t < 0.5 ? a.dotsBehind : b.dotsBehind
  }
}

/**
 * Moteur sans horloge : `sample(t)` est une fonction pure du temps.
 *
 * Consequence pratique : pause, reprise, ralenti et saut a une date arbitraire
 * donnent exactement la meme image, et le rendu est testable sans DOM.
 */
class BotEngine {
  /** rayon de la boule au repos, en unites de viewBox */
  readonly scale: number

  private cur: StateId
  private prev: StateId | null = null
  /**
   * Pose de depart FIGEE, posee seulement quand un changement d'etat arrive alors qu'un
   * fondu est deja en cours. Cf. `setState`.
   */
  private departFige: Pose | null = null
  private tCur = 0
  private tPrev = 0
  private blinkAt = -10
  private pts: Point[] = []
  private shape: number[] | null = null
  private shapePrev: number[] | null = null
  private shapeAt = -10
  private expr: BotExpression | null = null
  private exprPrev: BotExpression | null = null
  private exprAt = -10
  private look: Look = NO_LOOK
  private lookPrev: Look = NO_LOOK
  private lookAt = -10
  /** duree de rattrapage en cours ; voir `LOOK_MORPH`, sa valeur par defaut */
  private lookMorph = 0.24

  /** duree du morph quand on change la forme du corps */
  static readonly SHAPE_MORPH = 0.45

  /**
   * Duree de rattrapage du regard vers la cible. Plus court que `SHAPE_MORPH` :
   * un regard qui suit doit paraitre attentif, pas visqueux. Comme la cible est
   * reposee a chaque mouvement de souris, c'est cette duree qui donne au suivi
   * son inertie — le regard n'atteint jamais tout a fait un curseur qui bouge.
   */
  static readonly LOOK_MORPH = 0.24

  constructor(
    scale = 100,
    initial: StateId = 'idle',
    shape: number[] | null = null,
    expression: BotExpression | null = null
  ) {
    this.scale = scale
    this.cur = initial
    this.shape = shape
    this.expr = expression
  }

  /**
   * Expression de repos choisie dans le personnalisateur. Comme la forme, elle
   * glisse vers la nouvelle valeur au lieu de sauter.
   */
  setExpression(expression: BotExpression | null, now = 0) {
    if (expression === this.expr) return
    this.exprPrev = this.expr
    this.expr = expression
    this.exprAt = now
  }

  /** Expression effective a l'instant `now`, morph en cours compris. */
  private exprAtTime(now: number): BotExpression | null {
    const to = this.expr
    const from = this.exprPrev
    if (!to || !from) return to
    const k = (now - this.exprAt) / BotEngine.SHAPE_MORPH
    if (k >= 1) return to
    return blendExpression(from, to, easings.easeOutQuint(clamp(k)))
  }

  /**
   * Forme choisie dans le personnalisateur. Elle ne remplace le corps que sur
   * les etats au repos (`baseBody`) : sur les autres, la silhouette EST
   * l'animation et ne doit pas etre ecrasee.
   *
   * Le changement se fait en morph, pas d'un coup : comme toutes les formes sont
   * echantillonnees aux memes angles, il suffit d'interpoler les rayons.
   */
  setShape(radii: number[] | null, now = 0) {
    if (radii === this.shape) return
    this.shapePrev = this.shape
    this.shape = radii
    this.shapeAt = now
  }

  /**
   * Forme effective a l'instant `now`, morph en cours compris.
   *
   * Ne remet PAS `shapePrev` a null en fin de morph : `sample` doit rester une
   * fonction pure du temps, donc relire une date passee doit redonner l'image
   * intermediaire. On garde juste une reference de plus.
   */
  private shapeAtTime(now: number): number[] | null {
    const to = this.shape
    const from = this.shapePrev
    if (!to || !from) return to
    const k = (now - this.shapeAt) / BotEngine.SHAPE_MORPH
    if (k >= 1) return to
    const t = easings.easeOutQuint(clamp(k))
    // alloue seulement pendant le morph ; hors morph on rend le tableau tel quel
    return to.map((r, i) => lerp(from[i] ?? r, r, t))
  }

  /**
   * Nouvelle cible de regard, `null` pour revenir a celui de l'etat.
   *
   * Elle repart de la valeur COURANTE, et non de la cible precedente comme
   * `setShape` : cette methode est appelee a chaque mouvement de pointeur, et
   * repartir de l'ancienne cible ferait reculer le regard d'un cran avant
   * chaque rattrapage — le suivi tremblerait au lieu de glisser.
   *
   * Meme contrat que `setShape` par ailleurs : l'etat externe entre par un
   * setter horodate, jamais par une variable lue pendant `sample`, sinon le
   * moteur cesse d'etre une fonction pure du temps.
   */
  setLook(look: Look | null, now: number, morph = BotEngine.LOOK_MORPH) {
    /*
     * Une cible non finie est refusee. Le moteur GARDE la derniere : un `NaN`
     * pose une seule fois se propagerait a chaque image et le bot ne se
     * reposerait plus jamais. C'est arrive pour de vrai — un
     * `getBoundingClientRect` sur une boite de taille nulle donne `0 / 0` chez
     * l'appelant. Celui-la est corrige, mais le moteur n'a pas a dependre de la
     * prudence de ses appelants pour rester rejouable.
     */
    if (look && !Number.isFinite(look.yaw + look.pitch + look.mix + look.spin + look.wander)) {
      return
    }
    this.lookPrev = this.lookAtTime(now)
    this.look = look ?? NO_LOOK
    this.lookAt = now
    this.lookMorph = morph
  }

  /** Regard effectif a l'instant `now`, rattrapage en cours compris. */
  private lookAtTime(now: number): Look {
    const k = (now - this.lookAt) / this.lookMorph
    if (k >= 1) return this.look
    return lerpLook(this.lookPrev, this.look, easings.easeOutQuint(clamp(k)))
  }

  private posed(
    def: StateDef,
    t: number,
    shape: number[] | null,
    expr: BotExpression | null
  ): Pose {
    let pose = def.pose(t)
    if (def.baseBody && shape) {
      // on garde la pose (rotation, decalage, squash) et on n'echange que le profil
      pose = { ...pose, sil: { ...pose.sil, radii: shape } }
    }
    if (def.baseFace && expr) {
      pose = { ...pose, gaze: expr.gaze, split: expr.split, eyes: expr.eyes }
    }
    return pose
  }

  /**
   * Decalage des yeux a l'instant `now` pour un etat donne, en unites de rayon de boule.
   *
   * Il est LU dans une table et interpole, jamais recalcule : `eyefit.ts` explique
   * pourquoi cette distinction est tout le correctif. Ici il ne reste qu'a l'interpoler
   * sur l'axe de la forme, avec exactement la courbe et la duree du morph de silhouette
   * — c'est la meme cause, donc ce doit etre le meme mouvement.
   *
   * On interroge la table sur les BORNES du morph (`shapePrev` et `shape`) et non sur le
   * profil que rend `shapeAtTime` : celui-la est un tableau neuf alloue a chaque image,
   * donc sans identite, et il n'existe dans aucune table.
   */
  private decalageAtTime(now: number, state: StateId): { x: number; y: number } {
    /**
     * Un axe de morph : on lit la table sur ses deux BORNES et on interpole avec sa
     * courbe. Jamais sur la valeur interpolee — celle-la n'a pas d'identite et n'existe
     * dans aucune table, et c'est en la lui donnant a manger que les versions
     * precedentes tremblaient.
     */
    const surAxe = (
      debut: number,
      duree: number,
      a: { x: number; y: number },
      b: { x: number; y: number }
    ) => {
      if (a === b) return b
      const k = (now - debut) / duree
      if (k >= 1) return b
      const t = easings.easeOutQuint(clamp(k))
      return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }
    }

    // axe de l'expression, pour chacune des deux formes en presence
    const parForme = (radii: number[] | null) =>
      surAxe(
        this.exprAt,
        BotEngine.SHAPE_MORPH,
        decalageDesYeux(radii, state, this.exprPrev?.id ?? null),
        decalageDesYeux(radii, state, this.expr?.id ?? null)
      )

    // puis axe de la forme
    return surAxe(
      this.shapeAt,
      BotEngine.SHAPE_MORPH,
      parForme(this.shapePrev),
      parForme(this.shape)
    )
  }

  get state(): StateId {
    return this.cur
  }

  /**
   * Repart sur `id` SANS etat precedent, comme un moteur neuf pose sur cet etat.
   *
   * C'est ce que veut dire « rembobiner » pour ce moteur. `setState` seul ne peut pas le
   * faire : il garde l'etat quitte pour le fondre, ce qui est exactement son role en
   * lecture, et exactement ce qu'il ne faut pas quand on revient au debut d'une sequence.
   * Rejouer l'image 0 apres une passe complete melangeait le premier etat avec le DERNIER,
   * et l'GIF s'ouvrait sur une boule sans yeux — la comete a un `eyeAlpha` nul.
   *
   * `sample` reste une fonction pure du temps : comme `setState`, ceci est un setter DATE,
   * appele par le pilote de la sequence, jamais pendant un echantillonnage.
   */
  reset(id: StateId, now: number) {
    this.cur = id
    this.prev = null
    this.departFige = null
    this.tCur = now
    this.tPrev = now
    this.blinkAt = -10
  }

  /**
   * Origine du fondu en cours : la pose figee s'il y en a une, sinon l'etat quitte evalue
   * a son propre temps ecoule — donc encore en train de s'animer, ce qui est voulu.
   */
  private origine(
    now: number,
    shape: number[] | null,
    expr: BotExpression | null
  ): Pose | null {
    if (this.departFige) return this.departFige
    if (!this.prev) return null
    const prevDef = STATE_BY_ID.get(this.prev)!
    return this.posed(prevDef, Math.max(0, now - this.tPrev), shape, expr)
  }

  /**
   * Pose composite a l'instant `now`, fondu en cours compris : exactement ce que `sample`
   * melange, avant la couche de vie au repos et de regard. Extraite pour que `setState`
   * puisse la figer.
   */
  private poseComposee(now: number): Pose {
    const def = STATE_BY_ID.get(this.cur)!
    const shape = this.shapeAtTime(now)
    const expr = this.exprAtTime(now)
    const pose = this.posed(def, Math.max(0, now - this.tCur), shape, expr)
    const since = now - this.tCur
    if (since >= def.morph) return pose
    const origine = this.origine(now, shape, expr)
    if (!origine) return pose
    return blendPose(origine, pose, easings.easeOutQuint(clamp(since / def.morph)))
  }

  /**
   * Changement d'etat, date.
   *
   * Le moteur ne garde qu'UNE case d'historique, donc un changement qui arrive pendant un
   * fondu remplacait l'origine du melange par la pose PLEINE de l'etat qu'on quittait, au
   * lieu de l'image partiellement melangee qui etait a l'ecran. Mesure sur
   * `idle -> wide -> idle` a 100 ms : 35,9 px de saut contre 8,0 px de mouvement normal.
   *
   * On fige donc la pose composite courante et on melange depuis elle. Continu par
   * construction, quel que soit le nombre de changements enchaines.
   *
   * Et SEULEMENT dans ce cas. Figer a chaque changement arreterait net l'animation de
   * l'etat qu'on quitte pendant tout le fondu — le « ! » d'`alert` se figerait en pleine
   * course — alors qu'il n'y a rien a corriger hors morph : l'etat quitte y est deja
   * exactement l'image affichee. La lecture d'un montage, dont les blocs durent au moins
   * le plus long fondu (`MIN_BLOCK`), ne fige donc jamais rien et rend au bit ce qu'elle
   * rendait.
   */
  setState(id: StateId, now: number) {
    if (id === this.cur) return
    const morph = STATE_BY_ID.get(this.cur)!.morph
    const enPleinFondu = this.prev !== null && now - this.tCur < morph
    this.departFige = enPleinFondu ? this.poseComposee(now) : null
    this.prev = this.cur
    this.tPrev = this.tCur
    this.cur = id
    this.tCur = now
    // Dans la video, chaque changement de forme est masque par un clignement.
    if (STATE_BY_ID.get(id)?.blinkIn) this.blinkAt = now
  }

  sample(now: number): BotFrame {
    const R = this.scale
    const def = STATE_BY_ID.get(this.cur)!
    const shape = this.shapeAtTime(now)
    const expr = this.exprAtTime(now)
    let pose = this.posed(def, Math.max(0, now - this.tCur), shape, expr)
    let decalage = this.decalageAtTime(now, this.cur)

    // --- transition -------------------------------------------------------
    const since = now - this.tCur
    // L'etat precedent n'est jamais purge : `since < def.morph` suffit a
    // l'ignorer une fois le fondu passe, et l'oublier rendrait le moteur non
    // rejouable — relire une date d'avant la fin du fondu ne le retrouverait
    // plus. C'est l'optimisation qui parait innocente et qui casse tout.
    const origine = since < def.morph ? this.origine(now, shape, expr) : null
    if (origine) {
      // Ease-out exponentiel : c'est la courbe mesuree sur la video. Le corps
      // n'a pas d'overshoot (seuls la pastille et l'ouverture des yeux en ont).
      // Le ratio est borne : relire une date ANTERIEURE au changement d'etat
      // donnerait un ratio negatif, que l'ease-out extrapole — la silhouette
      // part alors trente fois trop loin.
      const ratio = easings.easeOutQuint(clamp(since / def.morph))
      pose = blendPose(origine, pose, ratio)
      // Le decalage des yeux suit la MEME courbe que la silhouette qui le motive. Il vient
      // de l'etat quitte, que `setState` renseigne toujours en meme temps que l'origine —
      // le test est la pour le typage, pas pour un cas reel.
      const quitte = this.prev
      if (quitte) {
        const avant = this.decalageAtTime(now, quitte)
        decalage = {
          x: lerp(avant.x, decalage.x, ratio),
          y: lerp(avant.y, decalage.y, ratio)
        }
      }
    }

    // --- vie au repos -----------------------------------------------------
    const alive = pose.eyeAlpha > 0.01
    const look = this.lookAtTime(now)
    const life = liveliness(now, { wander: alive ? look.wander : 0, blink: alive })

    const gaze = {
      // Les deux visees REMPLACENT celles de la pose au lieu de s'y ajouter (voir
      // `Look`), et le tour se retranche en chemin. La derive s'ajoute APRES le
      // melange, sinon la cible l'annulerait en meme temps que la pose — or elle
      // doit survivre a une tete tournee sans pointeur.
      yaw: lerp(pose.gaze.yaw, look.yaw, look.mix) + life.dYaw - look.spin,
      pitch: lerp(pose.gaze.pitch, look.pitch, look.mix) + life.dPitch,
      // le roulis, lui, ne suit rien : la tete du bot est penchee de -13deg dans
      // la video, et la faire rouler avec le curseur casse cette signature
      roll: pose.gaze.roll + life.dRoll
    }

    // clignement declenche par le changement d'etat, en plus du calendrier
    const forced = clamp((now - this.blinkAt) / 0.2)
    const forcedLid = forced < 1 ? Math.abs(forced * 2 - 1) : 1
    const lid = Math.min(life.lid, forcedLid)

    const offX = pose.offX + life.driftX
    const offY = pose.offY + life.driftY

    // --- corps ------------------------------------------------------------
    const sil: Silhouette = {
      ...pose.sil,
      cx: pose.sil.cx + offX,
      cy: pose.sil.cy + offY,
      sy: pose.sil.sy * life.breath
    }
    const bodyPath = closedPath(toPoints(sil, R, this.pts))

    // --- yeux -------------------------------------------------------------
    // Les yeux vivent sur une sphere de rayon 1 ; des que la silhouette n'est
    // plus un cercle, on les ramene au prorata du rayon reel dans leur
    // direction, sinon ils debordent et le masque les coupe.
    const bodyRadius = (x: number, y: number) =>
      radiusAtAngle(pose.sil.radii, Math.atan2(y, x) - pose.sil.rot)

    const eyes: RenderedEye[] = []
    if (pose.eyeAlpha > 0.01) {
      const poses = eyePoses(gaze, R, pose.split)
      for (let i = 0; i < 2; i++) {
        const e = poses[i]!
        if (e.depth <= 0.02) continue
        const cfg = pose.eyes[i]!
        const fit = bodyRadius(e.x, e.y)
        // Inclinaison propre de l'oeil : on compose le repere tangent avec une
        // rotation dans le plan de l'oeil (Basis x Rot). C'est ce qui permet des
        // inclinaisons en miroir entre les deux yeux.
        const phi = ((cfg.tilt ?? 0) * Math.PI) / 180
        const cp = Math.cos(phi)
        const sp = Math.sin(phi)
        const ax = e.a * cp + e.c * sp
        const ay = e.b * cp + e.d * sp
        const cx2 = -e.a * sp + e.c * cp
        const cy2 = -e.b * sp + e.d * cp
        // Le clignement s'applique APRES tout ca : c'est un ecrasement vertical
        // a l'ecran, pas le long de l'axe de la gelule.
        const k = blinkScale(Math.min(lid, cfg.open))
        eyes.push({
          d: capsulePath(cfg.w * R, cfg.h * R),
          matrix: `matrix(${r2(ax)},${r2(ay * k)},${r2(cx2)},${r2(cy2 * k)},${r2(e.x * fit + (offX + decalage.x) * R)},${r2(e.y * fit + (offY + decalage.y) * R)})`,
          alpha: pose.eyeAlpha * clamp(e.depth / 0.12)
        })
      }
    }

    // --- decor ------------------------------------------------------------
    const dots = pose.dots
      .filter((p) => p.opacity > 0.01 && p.r > 0.0005)
      .map((p) => ({ ...p, x: (p.x + offX) * R, y: (p.y + offY) * R, r: p.r * R }))

    // la pastille est posee sur le contour : elle suit donc la forme aussi
    const nFit = pose.notif ? bodyRadius(pose.notif.x, pose.notif.y) : 1
    const nx = pose.notif ? (pose.notif.x * nFit + offX) * R : 0
    const ny = pose.notif ? (pose.notif.y * nFit + offY) * R : 0
    const notif = pose.notif ? { x: nx, y: ny, r: pose.notif.r * R } : null
    const notch = pose.notif ? { x: nx, y: ny, r: pose.notif.notch * R } : null

    return {
      bodyPath,
      bodyAlpha: pose.bodyAlpha,
      eyes,
      dots,
      dotsBehind: pose.dotsBehind,
      // Les etats declarent des arcs en unites de rayon de boule ; le moteur
      // est le seul a connaitre l'echelle du viewBox, donc c'est lui qui trace.
      arcs: pose.arcs
        .filter((a) => a.opacity > 0.01)
        .map((a) => arcRender(a.seed, a.t, R, a.id, a.opacity)),
      notif,
      notch
    }
  }
}




      // =========================================================
      // bloub live avatars — the x.ai bot avatar, rendered at runtime.
      //
      // The engine above (merged verbatim from tools/bloub) samples a frame
      // per tick; eyes are holes punched through the body via a mask, so the
      // silhouette clips them for free. The flat measured look is kept, with
      // two soft-light additions for volume: a radial gloss on the body and a
      // top-lit tile background. Bots gaze at the pointer (the engine mixes
      // the look itself); without a pointer they drift and blink on their own.
      // =========================================================

      /** One state per avatar slot; pick by bot id so it is stable across reloads. */
      const BLOUB_STATES = ['idle', 'thinking', 'wink', 'play', 'notify', 'wide', 'orbit', 'egg'] as const

      /** bloub palette, deep tones only — pale inks would swallow the white eyes. */
      const BLOUB_INKS = ['#0a0a0c', '#8b5e3c', '#e8483f', '#f08a24', '#f0b429', '#3ecf8e', '#2fbfa0', '#3b93f0', '#8b5cf6', '#e152b0']

      /** Engine half-extent that must fit the tile: compact states reach ~1.15 radii, arc states 1.58 (rings/swoosh). */
      const BLOUB_WORLD: Record<string, number> = { orbit: 158 }
      const BLOUB_TILE = 128

      /** Body ink with soft-light shading: highlight top-left, core, darker rim. */
      function bloubGlossStops(ink: string): string[] {
        return [mixHex(ink, '#ffffff', 0.26), ink, mixHex(ink, '#000000', 0.3)]
      }

      function bloubFrameSvg(engine: BotEngine, now: number, ink: string, uid: string, world: number): string {
        const frame = engine.sample(now)
        const half = BLOUB_TILE / 2
        const paper = '#f9f9f9'
        const bg = mixHex(paper, ink, 0.14)
        const scale = (half - 4) / world
        const vb = half / scale
        const n2 = (v: number) => Math.round(v * 100) / 100
        const attr = (v: unknown) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
        const gloss = bloubGlossStops(ink)
        const defs: string[] = []
        defs.push(`<mask id="${uid}m" maskUnits="userSpaceOnUse" x="${-n2(vb)}" y="${-n2(vb)}" width="${n2(vb * 2)}" height="${n2(vb * 2)}">` +
          `<path d="${attr(frame.bodyPath)}" fill="#fff"/>` +
          frame.eyes.map((eye) =>
            `<path d="${attr(eye.d)}" transform="${attr(eye.matrix)}" opacity="${n2(eye.alpha)}" fill="#000"/>`).join('') +
          (frame.notch ? `<circle cx="${n2(frame.notch.x)}" cy="${n2(frame.notch.y)}" r="${n2(frame.notch.r)}" fill="#000"/>` : '') +
          `</mask>`)
        defs.push(`<radialGradient id="${uid}g" gradientUnits="userSpaceOnUse" cx="${n2(-28)}" cy="${n2(-36)}" r="${n2(150)}">` +
          gloss.map((c, i) => `<stop offset="${[0, 0.52, 1][i]}" stop-color="${c}"/>`).join('') +
          `</radialGradient>`)
        defs.push(`<linearGradient id="${uid}b" x1="0" y1="${-half}" x2="0" y2="${half}" gradientUnits="userSpaceOnUse">` +
          `<stop offset="0" stop-color="${mixHex(bg, '#ffffff', 0.35)}"/><stop offset="1" stop-color="${bg}"/></linearGradient>`)
        for (const arc of frame.arcs) {
          defs.push(`<linearGradient id="${uid}a${attr(arc.id)}" gradientUnits="userSpaceOnUse" ` +
            `x1="${n2(arc.grad.x1)}" y1="${n2(arc.grad.y1)}" x2="${n2(arc.grad.x2)}" y2="${n2(arc.grad.y2)}">` +
            arc.grad.stops.map((c, i) => `<stop offset="${i / (arc.grad.stops.length - 1)}" stop-color="${c}"/>`).join('') +
            `</linearGradient>`)
        }
        const dotAttrs = (dot: { x: number; y: number; r: number; opacity: number; color?: string; depth?: number; d?: string; rot?: number }) => {
          const fill = dot.color ?? (dot.depth === undefined ? ink : mixHex(paper, ink, dot.depth))
          const common = `fill="${fill}" opacity="${n2(dot.opacity)}"`
          return dot.d
            ? `<path ${common} d="${attr(dot.d)}" transform="translate(${n2(dot.x)} ${n2(dot.y)}) rotate(${n2(dot.rot ?? 0)}) scale(${RAYON})"/>`
            : `<circle ${common} cx="${n2(dot.x)}" cy="${n2(dot.y)}" r="${n2(dot.r)}"/>`
        }
        const arcPaths = (side: 'back' | 'front') => frame.arcs.map((arc) =>
          `<path d="${attr(arc[side])}" stroke="url(#${uid}a${attr(arc.id)})" stroke-width="${n2(arc.width)}" opacity="${n2(arc.opacity)}"/>`).join('')
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-half} ${-half} ${BLOUB_TILE} ${BLOUB_TILE}" fill="none" shape-rendering="auto" aria-hidden="true">` +
          `<defs>${defs.join('')}</defs>` +
          `<rect x="${-half}" y="${-half}" width="${BLOUB_TILE}" height="${BLOUB_TILE}" fill="url(#${uid}b)"/>` +
          `<g transform="scale(${n2(scale)})">` +
          (frame.arcs.length ? `<g fill="none" stroke-linecap="round">${arcPaths('back')}</g>` : '') +
          (frame.dotsBehind ? `<g>${frame.dots.map(dotAttrs).join('')}</g>` : '') +
          `<g opacity="${n2(frame.bodyAlpha)}">` +
          `<path d="${attr(frame.bodyPath)}" fill="${paper}"/>` +
          `<g mask="url(#${uid}m)"><rect x="${-n2(vb)}" y="${-n2(vb)}" width="${n2(vb * 2)}" height="${n2(vb * 2)}" fill="url(#${uid}g)"/>` +
          // specular sheen, clipped to the body by the same mask
          `<ellipse cx="${n2(-34)}" cy="${n2(-46)}" rx="${n2(30)}" ry="${n2(20)}" fill="#ffffff" opacity="0.15"/></g></g>` +
          (!frame.dotsBehind ? `<g>${frame.dots.map(dotAttrs).join('')}</g>` : '') +
          (frame.notif ? `<circle cx="${n2(frame.notif.x)}" cy="${n2(frame.notif.y)}" r="${n2(frame.notif.r)}" fill="${NOTIF_BLUE}"/>` : '') +
          (frame.arcs.length ? `<g fill="none" stroke-linecap="round">${arcPaths('front')}</g>` : '') +
          `</g></svg>`
      }

      /** Shared pointer state: one listener, every avatar gazes from its own rect. */
      const bloubGaze = { x: 0, y: 0, active: false }
      document.addEventListener('mousemove', (ev) => {
        bloubGaze.x = ev.clientX
        bloubGaze.y = ev.clientY
        bloubGaze.active = true
      }, { passive: true })
      document.documentElement.addEventListener('mouseleave', () => { bloubGaze.active = false })

      /**
       * One clock for every live avatar: a single rAF loop at ~30 fps (path
       * morphing does not need more, and sidebar rows should not burn a core).
       * The loop stops itself when the last avatar unregisters; rAF also parks
       * itself while the tab is hidden.
       */
      const bloubTicks = new Set<(now: number) => void>()
      let bloubRaf = 0
      let bloubLast = 0
      function bloubLoop(ms: number): void {
        bloubRaf = 0
        if (bloubTicks.size === 0) return
        if (ms - bloubLast >= 32) {
          bloubLast = ms
          const t = ms / 1000
          for (const tick of bloubTicks) tick(t)
        }
        bloubRaf = requestAnimationFrame(bloubLoop)
      }
      function bloubEnsureClock(): void {
        if (bloubRaf === 0) bloubRaf = requestAnimationFrame(bloubLoop)
      }

      /** Gaze target in engine Look terms, from one avatar's rect to the pointer. */
      function bloubLook(engine: BotEngine, rect: DOMRect | null, now: number): void {
        if (!bloubGaze.active || rect === null || rect.width === 0) {
          engine.setLook(null, now) // back to the pose's own gaze, drift on
          return
        }
        const nx = Math.max(-1, Math.min(1, (bloubGaze.x - (rect.left + rect.width / 2)) / 300))
        const ny = Math.max(-1, Math.min(1, (bloubGaze.y - (rect.top + rect.height / 2)) / 300))
        // screen y grows downward, pitch grows upward
        engine.setLook({ yaw: nx * 16, pitch: 10 - ny * 13, mix: 1, spin: 0, wander: 0 }, now)
      }

      function BloubAvatar(p: { seed: string; size: number }): any {
        const ref = React.useRef(null)
        React.useEffect(() => {
          const el = ref.current
          if (el === null) return
          const hue = hueOf(p.seed)
          const state = BLOUB_STATES[hue % BLOUB_STATES.length]
          const world = BLOUB_WORLD[state] ?? 115
          const engine = new BotEngine(RAYON, state, null, null)
          const ink = BLOUB_INKS[(hue * 5 + 3) % BLOUB_INKS.length]
          const uid = `b${hue.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
          const phase = (hue % 97) * 0.61 // desynchronise blinking across bots
          const reduce = typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches
          let rect: DOMRect | null = null
          let rectAt = 0
          let disposed = false
          const draw = (t: number) => {
            if (!disposed && ref.current !== null) ref.current.innerHTML = bloubFrameSvg(engine, t + phase, ink, uid, world)
          }
          draw(0.35)
          if (reduce) return () => { disposed = true }
          const tick = (t: number) => {
            if (t - rectAt > 0.3 || rect === null) {
              rectAt = t
              rect = ref.current !== null ? ref.current.getBoundingClientRect() : null
            }
            bloubLook(engine, rect, t)
            draw(t)
          }
          bloubTicks.add(tick)
          bloubEnsureClock()
          return () => { disposed = true; bloubTicks.delete(tick) }
        }, [p.seed])
        return e('span', {
          className: 'dbs-avatar dbs-avatarRound',
          style: { width: p.size, height: p.size },
          ref,
          'aria-hidden': true,
        })
      }


      /** Stable hue from an id, so an avatar keeps its colour across reloads. */
      function hueOf(id: string): number {
        let h = 0
        for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 360
        return h
      }

      function Avatar(p: { agent: any; size?: number; round?: boolean }) {
        const a = p.agent
        const size = p.size ?? 20
        const style: any = { width: size, height: size }
        // Conversation avatars are round (native chat look); the sidebar keeps
        // the native squircle via the base class.
        const shape = p.round === true || a.isGroup === true ? ' dbs-avatarRound' : (a.isGroup ? ' dbs-group' : '')
        // Bots without a custom avatar live-render the bloub blob (merged
        // engine above); groups keep the initials fallback, custom avatars win.
        if (typeof a.avatarDataUrl === 'string' && a.avatarDataUrl !== '') {
          return e('span', { className: 'dbs-avatar' + shape, style },
            e('img', { src: a.avatarDataUrl, alt: '' }))
        }
        if (a.isGroup !== true) {
          return e(BloubAvatar, { seed: String(a.id ?? a.name ?? 'bot'), size })
        }
        style.background = typeof a.avatarColor === 'string' && a.avatarColor !== ''
          ? a.avatarColor
          : `hsl(${String(hueOf(a.id))} 52% 46%)`
        if (size >= 24) style.fontSize = '13px'
        const initial = (a.name ?? '').trim().slice(0, 1) || '·'
        return e('span', {
          className: 'dbs-avatar' + shape, style, 'aria-hidden': true,
        }, initial)
      }

      /** Chevron matching the shipped project row (fills in if the icon moves). */
      function Chevron(p: { open: boolean }) {
        const cls = 'dbs-arrow' + (p.open ? ' dbs-arrowOpen' : '')
        const native = NATIVE.IconTriangleRightFillRegular ?? NATIVE.IconTriangleRightFill14
        return e('span', { className: 'dbs-chevron ' + cls },
          native !== undefined
            ? e(native, {})
            : e('svg', { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': true },
                e('path', { d: 'M4.25 2.83v8.34c0 .49.59.74.94.39l4.17-4.17a.75.75 0 0 0 0-1.06L5.19 2.16c-.35-.35-.94-.1-.94.39Z', fill: 'currentColor' })))
      }

      /**
       * Pushpin glyph for pinned conversations (置顶会话). Not in the
       * primitives set we can rely on at runtime, so ship the Material
       * push_pin path inline (currentColor, scales via viewBox).
       */
      function PinGlyph(props?: { size?: number }): any {
        const size = props?.size ?? 12
        return e('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true, fill: 'currentColor' },
          e('path', { d: 'M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z' }))
      }

      // =========================================================
      // Bots nav group.
      // =========================================================
      function BotsGroup() {
        const s = useStore()

        // Hidden agents are hidden: the gateway owns that flag and the sidebar
        // has to honour it, same as every other sdk-bots surface.
        // 置顶会话 sort: pinned conversations float to the top of their
        // section (群聊/单聊 stay separate), keeping the user's pin order;
        // everything else keeps the recency ordering.
        const pinnedIds = Array.isArray(s.pinnedIds) ? s.pinnedIds : []
        const pinRank = (id: string): number => {
          const idx = pinnedIds.indexOf(id)
          return idx === -1 ? Number.MAX_SAFE_INTEGER : idx
        }
        const visible = (s.agents as any[])
          .filter((a) => a.isHiddenFromSidebar !== true)
          .slice()
          .sort((a, b) => {
            const pa = pinRank(a.id)
            const pb = pinRank(b.id)
            if (pa !== pb) return pa - pb
            return (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)
          })
        const pinned = new Set(pinnedIds)
        const groups = visible.filter((a) => a.isGroup)
        const singles = visible.filter((a) => !a.isGroup)
        const connected = s.info?.ok === true

        function row(a: any) {
          const busy = a.isComposingMessage === true || a.isRunning === true
          // Plugin-owned count first (the gateway's own unreadCount is
          // desktop-app semantics and never accumulates on a headless host).
          const unread = Number(s.unreadCounts?.[a.id] ?? a.unreadCount ?? 0)
          return e('div', {
            key: a.id,
            className: 'dbs-srow' + (s.chatAgentId === a.id ? ' dbs-selected' : ''),
            'data-menu': s.rowMenu === a.id ? 'true' : 'false',
            role: 'treeitem',
            'aria-selected': s.chatAgentId === a.id,
            tabIndex: 0,
            onClick: () => openChat(a.id),
            onKeyDown: (ev: any) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openChat(a.id) } },
            title: a.description !== '' ? a.name + ' — ' + a.description : a.name,
          },
            e(Avatar, { agent: a }),
            e('span', { className: 'dbs-title' }, a.name),
            pinned.has(a.id)
              ? e('span', { className: 'dbs-rowPin', title: t('action.pin') }, PinGlyph({ size: 11 }))
              : null,
            busy && StateDot !== null
              ? e(StateDot, { state: 'ongoing', size: 10 })
              : a.awaitingUserResponse !== null && a.awaitingUserResponse !== undefined && StateDot !== null
                ? e(StateDot, { state: 'warning', size: 10 })
                : unread > 0
                  ? e('span', { className: 'dbs-badge' }, unread > 99 ? '99+' : String(unread))
                  : null,
            // 更多操作: a single-item menu (删除) replaces the bare trash
            // button — same affordance as the section headers, room to grow.
            // The trigger paints NO hover background (user request): color
            // shift only, so the reveal stays quiet.
            e('button', {
              type: 'button', className: 'dbs-rowMore',
              title: t('list.more'), 'aria-label': t('list.more') + ' ' + a.name,
              onClick: (ev: any) => {
                ev.stopPropagation()
                if (s.rowMenu === a.id) { patch({ rowMenu: null }); return }
                // Two-item menu (~68px) anchored below the trigger: flip it
                // above the row when the viewport can't fit it — otherwise
                // the last row's menu is clipped by .dbs-botsBody overflow.
                const rect = (ev.currentTarget as any).getBoundingClientRect()
                patch({ rowMenu: a.id, rowMenuFlip: window.innerHeight - rect.bottom < 96 })
              },
            }, Ico('IconEllipsisOutline16', { size: 14 })),
            s.rowMenu === a.id
              ? e(React.Fragment, null,
                  e('div', { style: { position: 'fixed', inset: 0, zIndex: 39 }, onClick: () => patch({ rowMenu: null }) }),
                  e('div', { className: 'dbs-secMenu dbs-rowMenu' + (s.rowMenuFlip ? ' dbs-flipUp' : ''), onClick: (ev: any) => { ev.stopPropagation() } },
                    e('button', {
                      className: 'dbs-secMenuItem', type: 'button',
                      onClick: () => { patch({ rowMenu: null }); setPin(a.id, !pinned.has(a.id)) },
                    }, e('span', { className: 'dbs-pinMenuIco' }, PinGlyph({ size: 14 })), pinned.has(a.id) ? t('action.unpin') : t('action.pin')),
                    e('button', {
                      className: 'dbs-secMenuItem', type: 'button',
                      onClick: () => { patch({ rowMenu: null, confirmDelete: { id: a.id, name: a.name, isGroup: a.isGroup === true } }) },
                    }, Ico('IconTrashOutline16', { size: 14 }), t('action.delete'))))
              : null)
        }

        /**
         * Section header + rows. The header always renders (even when the
         * section is empty) so the far-right + is reachable from where you
         * are: creating the first bot or group never requires a trip to the
         * footer. `addAction` opens the same system-style modal as before.
         */
        function sectionRows(label: string, list: any[], addAction: { title: string; onClick: () => void }, menuKind: string, menuItems: Array<{ label: string; onClick: () => void }>, icon: any) {
          const menuOpen = s.sectionMenu === menuKind
          // Group-header collapse contract, mirrored from 「工作区｜Bots」:
          // chevron + whole-row click toggle, body suppressed when closed.
          const isOpen = s.sectionsOpen?.[menuKind] !== false
          const toggle = (): void => {
            patch({ sectionMenu: null, sectionsOpen: { ...(s.sectionsOpen ?? {}), [menuKind]: !isOpen } })
          }
          return e('div', { key: label, className: 'dbs-secGroup', 'data-open': isOpen ? 'true' : 'false' },
            e('div', {
              className: 'dbs-navBodyErr dbs-secHead', role: 'button', tabIndex: 0, 'aria-expanded': isOpen,
              'data-menu': menuOpen ? 'true' : 'false',
              // Native sectionHeader outdent: label at x=16 (12 sidebar
              // padding + 4), aligned with the group headers. The previous
              // 12px here pushed section labels 8px right of the native
              // baseline, making both sections read horizontally off.
              // Native sectionHeader: padding-left 4, gap 4, and no right
              // padding — the -4px bleed in .dbs-secHead is what carries the
              // row out to the sidebar edge.
              style: { padding: '0 4px', display: 'flex', alignItems: 'center', gap: 4 },
              onClick: toggle,
              onKeyDown: (ev: any) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle() } },
            },
              e(Chevron, { open: isOpen }),
              e('span', { className: 'dbs-slot' }, icon),
              e('span', { style: { flex: 1 } }, label),
              // Native workspace pattern: header actions appear on hover
              // (.dbs-rowActions is hover-gated in .dbs-secHead CSS); their
              // clicks must not fold the section with them.
              e('div', {
                className: 'dbs-rowActions', style: { alignItems: 'center', gap: 2 },
                onClick: (ev: any) => { ev.stopPropagation() },
              },
                e(Button, {
                  variant: 'ghost', size: 'sm', title: addAction.title, 'aria-label': addAction.title,
                  icon: Ico('IconPlusOutline16', { size: 14 }),
                  onClick: addAction.onClick,
                }),
                e(Button, {
                  variant: 'ghost', size: 'sm', title: t('list.more'), 'aria-label': t('list.more'),
                  icon: Ico('IconEllipsisOutline16', { size: 14 }),
                  onClick: () => patch({ sectionMenu: menuOpen ? null : menuKind }),
                })),
              menuOpen
                ? e(React.Fragment, null,
                    e('div', { style: { position: 'fixed', inset: 0, zIndex: 39 }, onClick: () => patch({ sectionMenu: null }) }),
                    e('div', { className: 'dbs-secMenu', onClick: (ev: any) => { ev.stopPropagation() } },
                      menuItems.map((item) => e('button', {
                        key: item.label, className: 'dbs-secMenuItem', type: 'button',
                        onClick: () => { patch({ sectionMenu: null }); item.onClick() },
                      }, item.label))))
                : null),
            isOpen ? list.map(row) : null)
        }

        // No footer: the gateway status moved to the Bots group-header dot's
        // hover tooltip (0.2.8) — see SidebarNav's StateDot `title`.
        return e('div', { className: 'dbs-navBody dbs-botsBody' },
          s.error !== null
            ? e('div', { className: 'dbs-error', onClick: () => patch({ error: null }) }, s.error)
            : null,
          !s.agentsLoaded
            ? e('div', { className: 'dbs-navBodyErr' }, t('list.loading'))
            : visible.length === 0
              ? s.agents.length > 0
                ? // Every agent exists but none is sidebar-visible: say so and
                  // offer the one-click restore — "还没有 Bot" would be a lie.
                  e('div', { className: 'dbs-navBodyErr' },
                    t('list.empty.hidden'),
                    e('button', {
                      className: 'dbs-unhideAll', type: 'button',
                      onClick: () => { void unhideAll() },
                    }, t('list.unhideAll')))
                : connected
                  ? null // truly zero agents: the section headers' ＋ speaks for itself
                  : e('div', { className: 'dbs-navBodyErr' }, t('gateway.offlineHint'))
              : null,
          s.agentsLoaded
            ? sectionRows(t('section.groups'), groups, {
                title: t('group.new'),
                onClick: () => patch({ create: 'group', createName: '', createMembers: {}, createWorking: false, error: null }),
              }, 'groups', [
                { label: t('group.new'), onClick: () => patch({ create: 'group', createName: '', createMembers: {}, createWorking: false, error: null }) },
                { label: t('list.refresh'), onClick: () => { void refreshAgents() } },
              ], e(PeopleGlyph, null))
            : null,
          s.agentsLoaded
            ? sectionRows(t('section.singles'), singles, {
                title: t('bot.new'),
                onClick: () => patch({ create: 'bot', createName: '', createDesc: '', createWorking: false, error: null }),
              }, 'singles', [
                { label: t('bot.new'), onClick: () => patch({ create: 'bot', createName: '', createDesc: '', createWorking: false, error: null }) },
                { label: t('list.refresh'), onClick: () => { void refreshAgents() } },
              ], Ico('IconUserOutline16', { size: 14 }))
            : null)
      }

      // =========================================================
      // Sidebar nav: 「工作区」 and 「Bots」 as two collapsible groups.
      // =========================================================
      function SidebarNav(p: {
        wide?: boolean
        expandSidebar?: () => void
        useSessions?: any
        useWorkspaces?: any
        useSessionPendingInteraction?: any
      }) {
        // `props` delivered to the registration includes the shell's standard
        // kit; the three workspace/session hooks here are forwarded to the
        // shipped browser we shadow, since newer dsh stopped exposing them on
        // hostFace().
        const wide = p.wide !== false
        const s = useStore()

        // One controller owns the data lifecycle for every Bots surface.
        React.useEffect(() => {
          void refreshAgents(); void refreshInfo(); void refreshPins(); syncUnread()
          return ring.subscribe((channels) => {
            if (channels.has('agents') || channels.has('agent-upserted')) void refreshAgents()
            if (channels.has('host-settings')) void refreshInfo()
            if (channels.has('transcript')) syncUnread()
          })
        }, [])

        if (!wide) {
          // Rail: the shipped browser draws its own icon column (search, add
          // workspace); we append one Bots control instead of replacing it.
          const busy = (s.agents as any[]).some((a) => a.isComposingMessage === true || a.isRunning === true)
          const unread = (s.agents as any[])
            .filter((a) => a.isHiddenFromSidebar !== true)
            .reduce((n: number, a: any) => n + Number(s.unreadCounts?.[a.id] ?? a.unreadCount ?? 0), 0)
          return e('div', { className: 'dbs-railWrap' },
            e(DelegatedBrowser, { ...p, wide: false }),
            e('div', { className: 'dbs-rail' },
              e('button', {
                type: 'button', className: 'dbs-railBtn', title: unread > 0 ? t('nav.bots.unread', { n: unread }) : t('nav.bots'),
                'aria-label': t('nav.bots.aria'), 'data-active': busy || unread > 0,
                onClick: () => {
                  patch({ open: { ...s.open, bots: true } })
                  if (p.expandSidebar) p.expandSidebar()
                },
              }, Ico('IconAgentPresetOutline16', { size: 18 }) ?? '·')))
        }

        // Accordion: expanding one nav group collapses the other. The sidebar
        // is one column of attention, not two stacked browsers — collapsing a
        // group stays a plain collapse, only the expand is exclusive.
        function toggleNav(key: 'workspaces' | 'bots', isOpen: boolean): any {
          if (isOpen) return { ...s.open, [key]: false }
          const other: 'workspaces' | 'bots' = key === 'workspaces' ? 'bots' : 'workspaces'
          return { ...s.open, [key]: true, [other]: false }
        }

        function group(key: 'workspaces' | 'bots', title: string, iconName: string, body: any, trailing?: any) {
          const isOpen = s.open[key] !== false
          return e('div', { className: 'dbs-navGroup', 'data-open': isOpen },
            e('div', {
              className: 'dbs-prow', role: 'button', tabIndex: 0, 'aria-expanded': isOpen,
              onClick: () => patch({ open: toggleNav(key, isOpen) }),
              onKeyDown: (ev: any) => {
                if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); patch({ open: toggleNav(key, isOpen) }) }
              },
            },
              e(Chevron, { open: isOpen }),
              e('span', { className: 'dbs-slot' }, Ico(iconName, { size: 16 })),
              e('span', { className: 'dbs-title' }, title),
              trailing ?? null),
            isOpen ? body : null)
        }

        return e('div', { className: 'dbs-nav' },
          group('workspaces', t('nav.workspaces'), 'IconFolderClose16',
            // Native workspace navigation selects its own main panel.
            e('div', {
              className: 'dbs-navBody',
            }, e(DelegatedBrowser, { ...p, wide }))),
          group('bots', t('nav.bots'), 'IconAgentPresetOutline16', e(BotsGroup, null),
            StateDot !== null
              ? e('span', {
                  title: s.info?.ok === true ? t('gateway.online', { port: s.info.port }) : t('gateway.offline'),
                  style: { display: 'inline-flex', alignItems: 'center', flex: 'none' },
                }, e(StateDot, { state: s.info?.ok === true ? 'done' : 'failed', size: 8 }))
              : null))
      }

      // =========================================================
      // Chat surface.
      // =========================================================

      // =========================================================
      // Message clocks.
      //
      // Formatted out of our own dictionary rather than `Intl.DateTimeFormat`,
      // because the language every other string in this plugin follows is the
      // shell's preference — not the browser's. 24-hour, tabular digits, same
      // as the shipped surfaces.
      // =========================================================

      /** `HH:MM` for the message row. */
      function clockOf(ms: number): string {
        const d = new Date(ms)
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
      }

      /** Local midnight index, so "same day" ignores the wall clock. */
      function dayIndexOf(ms: number): number {
        return Math.floor((ms - new Date(ms).getTimezoneOffset() * 60000) / 86400000)
      }

      /** 今天 / 昨天 / 8 月 30 日 / 2025 年 8 月 30 日 — the divider label. */
      function dayLabelOf(ms: number): string {
        const today = dayIndexOf(Date.now())
        const day = dayIndexOf(ms)
        if (day === today) return t('time.today')
        if (day === today - 1) return t('time.yesterday')
        const d = new Date(ms)
        const params = { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }
        return d.getFullYear() === new Date().getFullYear() ? t('time.date', params) : t('time.dateFull', params)
      }

      /** Day + clock, for the hover title on a bare `HH:MM`. */
      function stampOf(ms: number): string {
        return dayLabelOf(ms) + ' ' + clockOf(ms)
      }

      /** Readable timestamp of an entry, or null when the gateway sent none. */
      function timeOf(entry: any): number | null {
        const ms = entry?.timestampMs
        return typeof ms === 'number' && Number.isFinite(ms) ? ms : null
      }

      /**
       * The reply clock under one message. Visible stamp carries the full
       * date (Y-M-D HH:MM) per product call; the hover title keeps the
       * locale-friendly "M 月 D 日 HH:MM" form.
       *
       * Suppressed while the entry is still streaming: a half-written turn has
       * no reply time yet, and stamping the tail would make the number twitch
       * on every chunk.
       */
      function MsgTime(p: { entry: any }) {
        const ms = timeOf(p.entry)
        if (ms === null || p.entry.isStreaming === true) return null
        const d = new Date(ms)
        const p2 = (n: number) => String(n).padStart(2, '0')
        return e('span', { className: 'dbs-msgTime', title: stampOf(ms) },
          d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + clockOf(ms))
      }

      // ---- Media references: bot-written local files in message text. ----
      // Images render inline (host readImage → data URL, session-cached);
      // documents/media render as a click-to-open chip (host openFile). The
      // host enforces the real boundary — gateway data dir only, ≤8MB, image
      // extension allowlist — so the client regexes are UX filters, not trust.
      const MEDIA_IMG_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i
      const MEDIA_FILE_RE = /\.(pdf|mp3|wav|m4a|mp4|mov|zip|csv|xlsx|docx|pptx|md|txt|json)$/i
      const MEDIA_PATH_RE = /\/[^\s，。；、！？：；""''（）【】《》<>"'`\\|]+/g
      const MEDIA_MAX_REFS = 6
      const mediaUrlCache = new Map<string, string>()

      /** Sticky variant of MEDIA_PATH_RE: matches a file path starting
       * exactly at the cursor, for in-place substitution while scanning. */
      const MEDIA_FILE_AT_RE = new RegExp(MEDIA_PATH_RE.source, 'y')

      /** Split message text into segments where FILE references become
       * inline FileChips at their original position (images keep the preview
       * block below). Shared by the markdown inline pass and plain text. */
      function inlineFileChips(text: string): any[] {
        if (typeof text !== 'string' || text.indexOf('/') === -1) return [text]
        const out: any[] = []
        let last = 0
        for (const m of text.matchAll(MEDIA_PATH_RE)) {
          const p = m[0].replace(/[.,;:!?、。，；：！？）)】\]>}]+$/, '')
          if (p.length < 4 || p.startsWith('//')) continue
          if (MEDIA_IMG_RE.test(p) || !MEDIA_FILE_RE.test(p)) continue
          const start = m.index
          if (start > last) out.push(text.slice(last, start))
          out.push(e(FileChip, { key: p + ':' + String(start), path: p }))
          last = start + p.length
        }
        if (out.length === 0) return [text]
        if (last < text.length) out.push(text.slice(last))
        return out
      }

      function mediaPathsOf(text: string): string[] {
        if (typeof text !== 'string' || text.indexOf('/') === -1) return []
        const out: string[] = []
        for (const m of text.matchAll(MEDIA_PATH_RE)) {
          const p = m[0].replace(/[.,;:!?、。，；：！？）)】\]>}]+$/, '')
          if (p.length < 4 || p.startsWith('//')) continue // //… = URL fragment
          if (!MEDIA_IMG_RE.test(p) && !MEDIA_FILE_RE.test(p)) continue
          if (out.indexOf(p) !== -1) continue
          out.push(p)
          if (out.length >= MEDIA_MAX_REFS) break
        }
        return out
      }

      function FileChip(p: { path: string }) {
        const [failed, setFailed] = React.useState(false)
        const base = p.path.slice(p.path.lastIndexOf('/') + 1) || p.path
        const open = () => { botsCall('openFile', { path: p.path }).catch(() => setFailed(true)) }
        return e('span', {
          className: 'dbs-fileChip', title: p.path, role: 'button', tabIndex: 0,
          onClick: open,
          onKeyDown: (ev: any) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open() } },
        },
          Ico('IconFolderClose16', { size: 12 }),
          e('span', { className: 'dbs-fileChipName' }, base),
          failed === true ? e('span', { className: 'dbs-meta' }, t('media.openFailed')) : null)
      }

      function MediaImage(p: { path: string }) {
        const [url, setUrl] = React.useState(mediaUrlCache.get(p.path) ?? null)
        const [err, setErr] = React.useState(false)
        React.useEffect(() => {
          if (mediaUrlCache.has(p.path)) return
          let alive = true
          botsCall<{ mime: string; dataBase64: string }>('readImage', { path: p.path })
            .then((r: { mime: string; dataBase64: string }) => {
              const u = 'data:' + r.mime + ';base64,' + r.dataBase64
              mediaUrlCache.set(p.path, u)
              if (alive) setUrl(u)
            })
            .catch(() => { if (alive) setErr(true) })
          return () => { alive = false }
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [p.path])
        if (url !== null) {
          return e('img', {
            className: 'dbs-mediaImg', src: url, alt: p.path, title: p.path,
            onClick: () => { botsCall('openFile', { path: p.path }).catch(() => undefined) },
          })
        }
        if (err === true) return e(FileChip, { path: p.path })
        return e('span', { className: 'dbs-mediaLoading' }, Ico('IconLoadingOutline16', { size: 14 }))
      }

      /** Image previews only — file references render as inline chips inside
       * the message text itself (inlineFileChips), never as a block. */
      function MediaRefs(p: { text: string }) {
        const imgs = mediaPathsOf(p.text).filter((r: string) => MEDIA_IMG_RE.test(r))
        if (imgs.length === 0) return null
        return e('div', { className: 'dbs-mediaRefs' },
          imgs.map((r: string) => e(MediaImage, { key: r, path: r })))
      }

      /**
       * Two-person glyph for the 群聊 section: the primitives set has no
       * group icon (verified against the shell bundle), so this follows the
       * inline-SVG policy used by SettingsGlyph — 1.5px outline strokes.
       */
      function PeopleGlyph(): any {
        return e('svg', { viewBox: '0 0 16 16', width: '14', height: '14', 'aria-hidden': true },
          e('g', { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' },
            e('circle', { cx: 6.1, cy: 5.1, r: 2.6 }),
            e('path', { d: 'M1.7 13.6c0-2.8 2-4.8 4.4-4.8s4.4 2 4.4 4.8' }),
            e('path', { d: 'M10.7 2.9a2.7 2.7 0 0 1 0 4.6' }),
            e('path', { d: 'M11.9 9.1c1.6.7 2.6 2.3 2.6 4.5' })))
      }

      /**
       * Settings glyph — three sliders, drawn inline (the primitives package
       * exposes no verified gear export; same policy as SendUpIcon).
       */
      function SettingsGlyph(): any {
        return e('svg', { viewBox: '0 0 16 16', width: '16', height: '16', 'aria-hidden': true },
          e('g', { stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' },
            e('line', { x1: 2, y1: 4, x2: 14, y2: 4 }),
            e('line', { x1: 2, y1: 8, x2: 14, y2: 8 }),
            e('line', { x1: 2, y1: 12, x2: 14, y2: 12 })),
          e('g', { fill: 'currentColor' },
            e('circle', { cx: 10, cy: 4, r: 2 }),
            e('circle', { cx: 5.5, cy: 8, r: 2 }),
            e('circle', { cx: 11.5, cy: 12, r: 2 })))
      }

      // ---- Tool rows & thinking, rebuilt on the native row anatomy ----
      // The shipped chat renders every tool call and the reasoning stream as
      // one-line disclosure rows: a 16px leading glyph, the tool name, a 2×2
      // dot separator, a tertiary summary, and a sweep highlight while the
      // row is running. Variant→glyph table mirrors the shipped VARIANT_ICONS.

      const TOOL_VARIANTS: Array<{ variant: string; re: RegExp; icon: string }> = [
        { variant: 'search', re: /^(WebSearch|WebFetch|Search|Grep|Glob|Find|Query)/i, icon: 'IconSearchOutline16' },
        { variant: 'read', re: /^(Read|Browse|Open|View|Peek)/i, icon: 'IconBrowseOutline16' },
        { variant: 'bash', re: /^(Shell|Bash|Terminal|Exec|PowerShell|Cmd)/i, icon: 'IconApiOutline14' },
        { variant: 'write', re: /^(Write|Edit|Patch|Apply|Save)/i, icon: 'IconEditOutline16' },
        { variant: 'code', re: /^(Code|Agent|Task|Subagent|Spawn)/i, icon: 'IconCodeOutline16' },
      ]
      function toolVariantOf(name: string): { variant: string; icon: string } {
        for (const v of TOOL_VARIANTS) if (v.re.test(name)) return { variant: v.variant, icon: v.icon }
        return { variant: 'others', icon: 'IconSparkle16' }
      }

      /** Native duration labels (formatDurationMs): under a second in
       * milliseconds, 1–10s with two decimals, beyond that one decimal. */
      function formatDurationMs(ms: number | null | undefined): string {
        if (ms == null || !Number.isFinite(ms) || ms < 0) return ''
        if (ms < 1e3) return `${Math.round(ms)}ms`
        return (ms / 1e3).toFixed(ms < 1e4 ? 2 : 1) + 's'
      }

      /** Native turn-clock labels (formatRunDuration): whole seconds, or
       * minutes with the seconds zero-padded — "35秒" / "1分35秒". */
      function formatRunDuration(ms: number | null | undefined): string {
        if (ms == null || !Number.isFinite(ms) || ms < 0) return ''
        const total = Math.max(0, Math.floor(ms / 1e3))
        const minutes = Math.floor(total / 60)
        const seconds = total % 60
        return minutes > 0
          ? t('duration.minutes', { minutes, seconds: String(seconds).padStart(2, '0') })
          : t('duration.seconds', { seconds })
      }

      /** Unified-diff detection + stat over a tool's output text. Write/Edit
       * results carry real diffs; when one is present the row shows the native
       * `+N -M` suffix and the body renders with native diff tinting. */
      function parseDiffStat(text: string): { added: number; removed: number } | null {
        if (typeof text !== 'string' || text.indexOf('@@') === -1) return null
        let added = 0
        let removed = 0
        let sawHunk = false
        for (const line of text.split('\n')) {
          if (line.startsWith('@@')) { sawHunk = true; continue }
          if (!sawHunk) continue
          if (line.startsWith('+++') || line.startsWith('---')) continue
          if (line.startsWith('+')) added += 1
          else if (line.startsWith('-')) removed += 1
        }
        return sawHunk && (added > 0 || removed > 0) ? { added, removed } : null
      }

      /** One diff line per output line, classified for native tinting. */
      function diffLines(text: string): Array<{ kind: string; text: string }> | null {
        if (parseDiffStat(text) === null) return null
        return text.split('\n').map((line) => ({
          kind: line.startsWith('@@') || line.startsWith('+++') || line.startsWith('---')
            ? 'meta'
            : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx',
          text: line === '' ? ' ' : line,
        }))
      }

      /** Pair every tool-call with its result: one row per call (the native
       * model), carrying the paired output and the wall-clock duration.
       * Raw SendMessage calls are dropped — the gateway already projects
       * those into chat messages; a stray result without its call (tail
       * truncation) still renders on its own. */
      function mergeToolRuns(entries: any[]): any[] {
        const out: any[] = []
        const pending: any[] = []
        for (const en of entries) {
          if (en.display !== 'tool') { out.push(en); continue }
          if (en.toolName === 'SendMessage' || en.toolName === 'send_message') continue
          if (en.kind === 'tool-call') { pending.push(en); continue }
          if (en.kind === 'tool-result') {
            const idx = pending.findIndex((x: any) => x.toolName === en.toolName)
            const call = idx >= 0 ? pending.splice(idx, 1)[0] : null
            const durationMs = call != null && call.timestampMs != null && en.timestampMs != null
              ? Math.max(0, en.timestampMs - call.timestampMs)
              : null
            out.push({
              ...(call ?? en),
              kind: 'tool-run',
              toolOutput: String(en.content ?? ''),
              durationMs,
              toolStatus: en.toolStatus ?? call?.toolStatus ?? 'ok',
            })
            continue
          }
          out.push(en)
        }
        // Calls that never settled still render, as running rows.
        for (const call of pending) out.push({ ...call, kind: 'tool-run' })
        return out
      }

      function ToolCard(p: { entry: any }) {
        const [open, setOpen] = React.useState(false)
        const en = p.entry
        const name = String(en.toolName ?? '') || t('tool.fallbackName')
        const { variant, icon } = toolVariantOf(name)
        const running = en.toolStatus === 'running'
        const failed = en.toolStatus === 'error'
        const body = String(en.toolOutput ?? '') !== '' ? String(en.toolOutput) : String(en.content ?? '')
        const expandable = body.trim() !== ''
        const summary = String(en.toolSummary ?? '').trim()
        const duration = formatDurationMs(en.durationMs)
        // File changes: a unified diff in the output yields the native `+N -M`
        // suffix and per-line tinting in the expanded body.
        const stat = parseDiffStat(body)
        const dl = diffLines(body)
        const lead = (running || failed) && StateDot !== null
          ? e(StateDot, { state: running ? 'ongoing' : 'error', size: 8 })
          : Ico(icon, { size: 14 })
        const stamp = (() => { const ms = en.timestampMs; return ms == null ? undefined : stampOf(ms) })()
        return e('div', { className: 'dbs-toolRow', 'data-variant': variant, 'data-state': running ? 'running' : failed ? 'error' : 'ok' },
          e('div', {
            className: 'dbs-toolRowLine', title: stamp,
            ...(expandable ? {
              role: 'button' as const, tabIndex: 0,
              onClick: () => setOpen(!open),
              onKeyDown: (ev: any) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setOpen(!open) } },
            } : {}),
          },
            e('span', { className: 'dbs-toolLead' }, lead),
            e('span', { className: 'dbs-toolTitle' }, name),
            summary !== '' ? e('span', { className: 'dbs-toolSep', 'aria-hidden': true }) : null,
            summary !== '' ? e('span', { className: 'dbs-toolSummary', title: summary }, summary) : null,
            duration !== '' ? e('span', { className: 'dbs-toolDuration' }, duration) : null,
            stat !== null ? e('span', { className: 'dbs-diffStat' }, `+${stat.added} -${stat.removed}`) : null,
            expandable ? e('span', { className: 'dbs-toolChevron' }, Ico(open ? 'IconChevronDownOutline14' : 'IconChevronRightOutline14', { size: 14 })) : null),
          open && expandable
            ? e('div', { className: 'dbs-toolBody' },
                dl !== null
                  ? e('div', { className: 'dbs-diff' }, dl.map((l: any, i: number) => e('span', {
                      key: i, className: 'dbs-diffLine', 'data-kind': l.kind,
                    }, l.text)))
                  : [ ...inlineFileChips(body), e(MediaRefs, { key: 'media', text: body }) ])
            : null)
      }

      /** Copy-to-clipboard, shaped like the shipped MessageIconActions: the
       * shell's own clipboard writer when it exposes one, a one-second
       * check-mark confirmation after a successful write, and a silent no-op
       * when neither writer is available (never a fake success). */
      function CopyAction(p: { text: string }) {
        const [copied, setCopied] = React.useState(false)
        const timer = React.useRef(null)
        React.useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current) }, [])
        const label = copied ? t('action.copied') : t('action.copy')
        const done = (ok: boolean): void => {
          if (!ok || timer.current !== null) return
          setCopied(true)
          timer.current = setTimeout(() => { timer.current = null; setCopied(false) }, 1000)
        }
        const copy = (): void => {
          const write = NATIVE.writeClipboard
          if (typeof write === 'function') {
            Promise.resolve(write(p.text)).then((ok: any) => done(ok === true)).catch(() => done(false))
            return
          }
          const clip = typeof navigator === 'undefined' ? null : navigator.clipboard
          if (clip == null || typeof clip.writeText !== 'function') return
          clip.writeText(p.text).then(() => done(true)).catch(() => done(false))
        }
        return e('button', {
          type: 'button', className: 'dbs-action', onClick: copy,
          title: label, 'aria-label': label,
        }, Ico(copied ? 'IconCheckOutline16' : 'IconCopyOutline16', { size: 15 }))
      }

      /** Hover-revealed action row: the message clock plus its actions, the
       * way the shipped MessageIconActions carries both. */
      function MessageActions(p: { entry: any }) {
        const text = String(p.entry?.content ?? '')
        return e('div', { className: 'dbs-actions' },
          e('span', { className: 'dbs-actionTime' }, e(MsgTime, { entry: p.entry })),
          text.trim() !== '' ? e(CopyAction, { text }) : null)
      }

      /** Thinking as the shipped ReasoningRow: a one-line disclosure with the
       * think glyph and a follow-the-tail summary while streaming; expands to
       * the full reasoning text, indented to align under the glyph. */
      function ThinkingRow(p: { entry: any }) {
        const [open, setOpen] = React.useState(false)
        const en = p.entry
        const text = String(en.content ?? '')
        const running = en.isStreaming === true
        const lines = text.split('\n').filter((l: string) => l.trim() !== '')
        // The native summary strips markdown bold so `**` noise never shows
        // in the one-line preview.
        const summary = (running ? (lines[lines.length - 1] ?? '') : (lines[0] ?? '')).replaceAll('**', '')
        const duration = formatDurationMs(en.durationMs)
        return e('div', { className: 'dbs-thinkRow', 'data-state': running ? 'running' : 'ok' },
          e('button', {
            type: 'button', className: 'dbs-toolRowLine', 'aria-expanded': open,
            onClick: () => setOpen(!open),
          },
            e('span', { className: 'dbs-toolLead' }, Ico('IconThinkOutline14', { size: 14 })),
            e('span', { className: 'dbs-toolTitle' }, t('chat.thinking')),
            summary !== '' ? e('span', { className: 'dbs-toolSep', 'aria-hidden': true }) : null,
            summary !== '' ? e('span', { className: 'dbs-toolSummary', 'data-follow-end': running || undefined }, summary) : null,
            duration !== '' ? e('span', { className: 'dbs-toolDuration' }, duration) : null,
            e('span', { className: 'dbs-toolChevron' }, Ico(open ? 'IconChevronDownOutline14' : 'IconChevronRightOutline14', { size: 14 }))),
          open ? e('div', { className: 'dbs-thinkBody' }, text) : null)
      }

      /** Native turn rail (TurnNavigatorRail): right-edge ticks, one per user
       * turn, that jump the stream. Positions come from measured anchors so
       * the rail matches the transcript instead of assuming an even spread. */
      function TurnRail(p: { marks: any[]; activeId: string | null; busy: boolean; onGo: (id: string) => void }) {
        const last = p.marks.length > 0 ? p.marks[p.marks.length - 1].id : null
        const fading = p.marks.length > 6
        return e('div', { className: 'dbs-rail' },
          e('div', {
            className: 'dbs-railScroll'
              + (fading ? ' dbs-railFadeTop dbs-railFadeBottom' : ''),
          },
            e('div', { className: 'dbs-railMarks' },
              p.marks.map((m: any) => e('button', {
                key: m.id, type: 'button', className: 'dbs-railMark',
                style: { top: (m.ratio * 100).toFixed(3) + '%' },
                'data-active': m.id === p.activeId ? 'true' : undefined,
                'data-busy': p.busy && m.id === last ? 'true' : undefined,
                title: m.label, 'aria-label': m.label,
                onClick: () => p.onGo(m.id),
              })))))
      }

      function Entry(p: { entry: any; isGroup: boolean; agent: any; compact?: boolean }) {
        const en = p.entry
        // User-uploaded image: the gateway stores the file and emits a separate
        // `user-attachment` entry beside the caption text, so an image message
        // reads as two stacked bubbles — like every native IM. Rendered through
        // the same host readImage pipe as bot images (allowlist stays the
        // boundary); clicking opens the file, as everywhere else.
        if (en.display === 'attachment') {
          if (typeof en.filePath !== 'string' || en.filePath === '') return null
          return e('div', { className: 'dbs-userRow' },
            e('div', { className: 'dbs-userStack' },
              e('div', { className: 'dbs-bubble dbs-bubbleImg' },
                e(MediaImage, { path: en.filePath }))),
            e('div', { className: 'dbs-actions' }, e('span', { className: 'dbs-actionTime' }, e(MsgTime, { entry: en }))))
        }
        if (en.display === 'user') {
          return e('div', { className: 'dbs-userRow' },
            e('div', { className: 'dbs-userStack' },
              e('div', { className: 'dbs-bubble' },
                e(MessageText, { text: en.content }),
                e(MediaRefs, { text: en.content }))),
            e(MessageActions, { entry: en }))
        }
        if (en.display === 'tool') return e(ToolCard, { entry: en })
        if (en.display === 'thinking') return e(ThinkingRow, { entry: en })
        if (en.display === 'event') {
          if (en.content === '') return null
          return e('div', { className: 'dbs-meta', style: { textAlign: 'center' } }, en.content)
        }
        // Single-bot chats: the native transcript renders no author header at
        // all — the assistant voice IS the room. Only group rooms carry the
        // avatar + name attribution (below), where multiple authors make it
        // load-bearing.
        if (p.isGroup !== true) {
          return e('div', { className: 'dbs-botRow' },
            e('div', { className: 'dbs-mdRow' },
              e(MarkdownText, { text: en.content, streaming: en.isStreaming === true }),
              en.isStreaming === true ? e('span', { className: 'dbs-caret' }) : null,
              en.isStreaming === true ? null : e(MediaRefs, { text: en.content })),
            e(MessageActions, { entry: en }))
        }
        // Compact continuation of the same author's run: the header already
        // stands above; only the reply clock rides along, right-aligned and
        // quiet — the way native IMs chain quick follow-ups under one name.
        if (p.compact === true) {
          return e('div', { className: 'dbs-botRow', 'data-compact': 'true' },
            e('div', { className: 'dbs-mdRow' },
              e(MarkdownText, { text: en.content, streaming: en.isStreaming === true }),
              en.isStreaming === true ? e('span', { className: 'dbs-caret' }) : null,
              en.isStreaming === true ? null : e(MediaRefs, { text: en.content })),
            e(MessageActions, { entry: en }))
        }
        // Bot message: avatar + prominent per-author name + full-datetime in
        // one header row, so multi-member rooms read at a glance.
        const authorKnown = typeof en.authorId === 'string' && en.authorId !== ''
        const memberAgent = authorKnown ? agentById(en.authorId) : null
        const avAgent = memberAgent ?? {
          id: authorKnown ? en.authorId : (p.agent?.id ?? 'bot'),
          name: en.authorName ?? p.agent?.name ?? '',
          avatarColor: memberAgent?.avatarColor,
          avatarDataUrl: memberAgent?.avatarDataUrl,
          isGroup: false,
        }
        const displayName = p.isGroup ? en.authorName : p.agent?.name
        return e('div', { className: 'dbs-botRow' },
          e('div', { className: 'dbs-author' },
            // Attribution stays, but at native weight: a small avatar and the
            // secondary-type name — no coloured bold header, which is what made
            // the stream read as a chat app instead of the DSH transcript.
            e(Avatar, { agent: avAgent, size: 18, round: true }),
            displayName != null && displayName !== ''
              ? e('span', { className: 'dbs-authorName' }, displayName)
              : null),
          e('div', { className: 'dbs-mdRow' },
            e(MarkdownText, { text: en.content, streaming: en.isStreaming === true }),
            en.isStreaming === true ? e('span', { className: 'dbs-caret' }) : null,
            en.isStreaming === true ? null : e(MediaRefs, { text: en.content })),
          e(MessageActions, { entry: en }))
      }


      const goalDrafts = new Map<string, { requestId: string; objective: string; criteria: string; interval: number }>()
      function goalStatusLabel(status: string): string {
        const labels: Record<string, string> = {
          scheduled: t('goal.scheduled'), running: t('goal.running'), paused: t('goal.paused'),
          blocked: t('goal.blocked'), review: t('goal.review'), completed: t('goal.completed'),
          cancelled: t('goal.cancelled'), attention: t('goal.attention'),
        }
        return labels[status] ?? status
      }
      function GoalPanel(p: { agentId: string }) {
        const initial = goalDrafts.get(p.agentId) ?? { requestId: crypto.randomUUID(), objective: '', criteria: '', interval: 1 }
        const [draft, setDraft] = React.useState(initial)
        const [goals, setGoals] = React.useState(null as any[] | null)
        const [error, setError] = React.useState(null as string | null)
        const [busy, setBusy] = React.useState(false)
        const [revising, setRevising] = React.useState(null as string | null)
        const [feedback, setFeedback] = React.useState('')
        const [ending, setEnding] = React.useState(null as string | null)
        const alive = React.useRef(true)
        const generation = React.useRef(0)
        const reading = React.useRef(false)
        const mutating = React.useRef(false)
        function updateDraft(next: any) {
          const value = { ...draft, ...next }
          setDraft(value); goalDrafts.set(p.agentId, value)
        }
        async function refresh() {
          if (reading.current || mutating.current) return
          reading.current = true
          const version = generation.current
          try {
            const rows = await botsCall<any[]>('goals', { agentId: p.agentId })
            if (alive.current && version === generation.current) setGoals(rows)
          } catch (err: any) {
            if (alive.current && version === generation.current) setError(errText(err))
          } finally { reading.current = false }
        }
        React.useEffect(() => {
          alive.current = true
          void refresh()
          // Goal ledgers are files, not transcript events. Poll only while
          // this view is open; scheduling lives entirely in the engine.
          const timer = setInterval(() => { if (!document.hidden) void refresh() }, 10000)
          const onFocus = () => { void refresh() }
          window.addEventListener('focus', onFocus)
          return () => { alive.current = false; clearInterval(timer); window.removeEventListener('focus', onFocus) }
        }, [])
        async function mutate(method: string, request: any) {
          if (mutating.current) return
          mutating.current = true; generation.current += 1
          setBusy(true); setError(null)
          try {
            const rows = await botsCall<any[]>(method, { agentId: p.agentId, ...request })
            if (!alive.current) return
            setGoals(rows); setRevising(null); setEnding(null); setFeedback('')
            if (method === 'createGoal') {
              goalDrafts.delete(p.agentId)
              setDraft({ requestId: crypto.randomUUID(), objective: '', criteria: '', interval: 1 })
            }
          } catch (err: any) { if (alive.current) setError(errText(err)) }
          finally { mutating.current = false; if (alive.current) { setBusy(false); void refresh() } }
        }
        const action = (goal: any, command: string) => void mutate('goalAction', { goalId: goal.id, action: command, feedback })
        const open = goals?.some((g: any) => !['completed', 'cancelled'].includes(g.status))
        return e('section', { className: 'dbs-goalPanel', 'aria-label': t('goal.title'), 'aria-busy': busy },
          e('div', { className: 'dbs-goalContent' },
            e('div', { className: 'dbs-goalHeader' }, e('h2', null, t('goal.title')),
              e(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => { setError(null); void refresh() } }, t('goal.refresh'))),
            e('div', { className: 'dbs-meta' }, t('goal.intro')),
            error !== null ? e('div', { className: 'dbs-error', role: 'alert' }, error) : null,
            goals === null ? e('div', { role: 'status' }, t('goal.loading')) : null,
            ...(goals ?? []).map((goal: any) => e('article', { key: goal.id, className: 'dbs-goalCard' },
              e('div', { className: 'dbs-goalStatus', role: 'status' }, goalStatusLabel(goal.status)),
              e('h3', null, goal.objective),
              e('div', { className: 'dbs-meta' }, t('goal.progress', {
                done: goal.acceptance.filter((c: any) => c.done).length, total: goal.acceptance.length, cycle: goal.cycle,
              })),
              e('ul', { className: 'dbs-goalCriteria' }, ...goal.acceptance.map((c: any) => e('li', { key: c.id },
                e('span', { 'aria-hidden': true }, c.done ? '✓' : '○'), e('span', null, c.text)))),
              goal.nextRunAt ? e('div', { className: 'dbs-meta' }, t('goal.next', { time: new Date(goal.nextRunAt).toLocaleString() })) : null,
              goal.note ? e('div', { className: 'dbs-meta', style: { whiteSpace: 'pre-wrap' } }, goal.note) : null,
              e('details', { open: goal.status === 'review' || undefined },
                e('summary', null, t('goal.checkpoint')), e('pre', null, goal.checkpoint ?? t('goal.noEvidence'))),
              goal.status === 'review' ? e('div', { className: 'dbs-meta' }, t('goal.reviewHint')) : null,
              e('div', { className: 'dbs-goalActions' },
                goal.setupPending ? e(Button, { variant: 'primary', size: 'sm', disabled: busy, onClick: () => void mutate('createGoal', { requestId: goal.id, objective: goal.objective, acceptance: goal.acceptance.map((c: any) => c.text), intervalMinutes: goal.intervalMinutes }) }, t('goal.retrySetup')) : null,
                ['scheduled', 'running', 'attention', 'blocked', 'review'].includes(goal.status)
                  ? e(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => action(goal, 'pause') }, t('goal.pause')) : null,
                ['paused', 'blocked'].includes(goal.status)
                  ? e(Button, { variant: 'primary', size: 'sm', disabled: busy, onClick: () => action(goal, 'resume') }, t('goal.resume')) : null,
                goal.status === 'review' && goal.acceptance.every((c: any) => c.done)
                  ? e(Button, { variant: 'primary', size: 'sm', disabled: busy, onClick: () => action(goal, 'complete') }, t('goal.complete')) : null,
                ['review', 'blocked', 'paused'].includes(goal.status)
                  ? e(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => setRevising(revising === goal.id ? null : goal.id) }, t('goal.revise')) : null,
                !['completed', 'cancelled'].includes(goal.status)
                  ? e(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => setEnding(goal.id) }, t('goal.cancel')) : null),
              revising === goal.id ? e('form', { className: 'dbs-goalForm', onSubmit: (ev: any) => { ev.preventDefault(); action(goal, 'revise') } },
                e('label', null, t('goal.feedback'), e('textarea', { autoFocus: true, required: true, maxLength: 8000, value: feedback, disabled: busy, onChange: (ev: any) => setFeedback(ev.target.value) })),
                e('div', null, e(Button, { type: 'submit', variant: 'primary', size: 'sm', disabled: busy || !feedback.trim() }, t('goal.sendFeedback')))) : null,
              ending === goal.id ? e('div', { className: 'dbs-goalActions' },
                e('span', null, t('goal.cancelConfirm')),
                e(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => setEnding(null) }, t('goal.keep')),
                e(Button, { variant: 'primary', size: 'sm', disabled: busy, onClick: () => action(goal, 'cancel') }, t('goal.cancel'))) : null,
              goal.runs.length ? e('details', null, e('summary', null, t('goal.history')),
                ...goal.runs.map((run: any) => e('div', { key: run.id, className: 'dbs-goalRun' },
                  new Date(run.startedAt).toLocaleString(), ' · ', run.status === 'ok' ? t('goal.runOk') : run.status === 'error' ? t('goal.runError') : t('goal.running'),
                  run.detail ? e('div', null, run.detail) : null))) : null)),
            goals !== null && !open ? e('form', { className: 'dbs-goalCard dbs-goalForm', onSubmit: (ev: any) => {
              ev.preventDefault(); goalDrafts.set(p.agentId, draft)
              void mutate('createGoal', { requestId: draft.requestId, objective: draft.objective, acceptance: draft.criteria.split('\n').map((v: string) => v.trim()).filter(Boolean), intervalMinutes: draft.interval })
            } },
              e('h3', null, t('goal.new')),
              e('label', null, t('goal.objective'), e('textarea', { value: draft.objective, required: true, maxLength: 8000, disabled: busy, onChange: (ev: any) => updateDraft({ objective: ev.target.value }) })),
              e('label', null, t('goal.criteria'), e('textarea', { value: draft.criteria, required: true, maxLength: 40000, disabled: busy, onChange: (ev: any) => updateDraft({ criteria: ev.target.value }) })),
              e('label', null, t('goal.interval'), e('select', { className: 'dbs-select', value: draft.interval, disabled: busy, onChange: (ev: any) => updateDraft({ interval: Number(ev.target.value) }) },
                ...[1, 5, 15, 30].map(n => e('option', { key: n, value: n }, t('goal.minutes', { n }))))),
              e('div', null, e(Button, { type: 'submit', variant: 'primary', size: 'sm', disabled: busy || !draft.objective.trim() || !draft.criteria.trim() }, busy ? t('goal.working') : t('goal.start')))) : null))
      }

      function ChatView(p: { agentId: string }) {
        const s = useStore()
        const [entries, setEntries] = React.useState(null)
        const [goalTab, setGoalTab] = React.useState(false)
        const [input, setInput] = React.useState('')
        const [sending, setSending] = React.useState(false)
        const [stopping, setStopping] = React.useState(false)
        const [error, setError] = React.useState(null)
        const [mention, setMention] = React.useState(null) // {query, index} | null
        // Pending image attachments (multimodal): read to base64 the moment
        // they are picked or pasted so the preview is byte-exact what gets
        // sent; cleared on a successful send. Not part of draftMemory — a
        // half-picked image is not a draft.
        const [pendingImages, setPendingImages] = React.useState([])
        // Elapsed wall clock of the active turn, ticking once a second — the
        // number the native turn status prints beside its shimmering label.
        const [elapsedMs, setElapsedMs] = React.useState(null)
        const fileRef = React.useRef(null)
        const mentionRef = React.useRef(null)
        const scrollRef = React.useRef(null)
        const inputRef = React.useRef(null)
        // True between compositionstart/end: an IME candidate window owns the
        // keyboard while it is open and must never see our Enter binding.
        // `until` keeps the guard hot for 10ms after compositionend — Safari
        // fires that event *after* the Enter keydown that commits the
        // candidate, so a bare boolean would let a confirmation Enter slip
        // through as a send (the native composer's recentlyComposing window).
        const imeRef = React.useRef({ active: false, until: 0 })

        const agent = agentById(p.agentId)
        const isGroup = agent?.isGroup === true
        // Authoritative, from the gateway — never a local "I just sent, so it
        // must be running" guess, which had no path back to false.
        const composing = agent?.isComposingMessage === true || agent?.isRunning === true

        async function loadTranscript() {
          try {
            const r: any = await botsCall('transcriptTail', { id: p.agentId, limit: 80 })
            setEntries(Array.isArray(r?.entries) ? r.entries : [])
          } catch (err: any) { setError(String(err?.message ?? err)) }
        }

        React.useEffect(() => {
          setEntries(null); setError(null); setMention(null)
          // Picked-but-unsent images belong to the chat they were picked in;
          // switching conversations discards them (the text draft persists).
          setPendingImages([])
          // Native persisted-draft contract: reopening the same chat restores
          // the unsent draft (kept in memory for the plugin lifetime); a
          // fresh conversation starts empty.
          setInput(draftMemory.get(p.agentId) ?? '')
          void loadTranscript()
          // While this conversation is open it is being read: arrivals for it
          // must not leave a badge on the row the user is looking at. The
          // host bump lands first, our debounced markRead cancels it out.
          let readTimer: any = null
          const scheduleRead = (): void => {
            if (readTimer !== null) return
            readTimer = setTimeout(() => {
              readTimer = null
              patch({ unreadCounts: { ...state.unreadCounts, [p.agentId]: 0 } })
              void botsCall('markRead', { id: p.agentId, atMs: Date.now() }).catch(() => {})
            }, 1200)
          }
          const unsub = ring.subscribe((channels, events) => {
            if (channels.has('transcript') || channels.has('client-side-tool-v2')) void loadTranscript()
            if (channels.has('transcript') && Array.isArray(events)) {
              for (const ev of events) {
                const payload = ev?.data
                if (payload?.type !== 'appended' && payload?.type !== 'snapshot') continue
                if (String(payload?.agentId ?? payload?.activeAgentId ?? '') === p.agentId) { scheduleRead(); break }
              }
            }
          })
          return () => {
            // A pending read timer dies with the view — a message that landed
            // as the user left stays unread.
            if (readTimer !== null) { clearTimeout(readTimer); readTimer = null }
            unsub()
          }
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [p.agentId])

        // Elapsed clock for the active turn: starts when the run starts and
        // clears with it, so the number always describes THIS turn.
        React.useEffect(() => {
          if (!composing) { setElapsedMs(null); return }
          const started = Date.now()
          setElapsedMs(0)
          const tick = setInterval(() => setElapsedMs(Date.now() - started), 1000)
          return () => clearInterval(tick)
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [composing])

        // The composer takes focus when a conversation opens, and keeps its
        // height in step with programmatic edits (send, mention completion,
        // agent switch) — user typing is fitted inline, without a frame gap.
        React.useEffect(() => {
          const node = inputRef.current
          if (node === null || node === undefined) return undefined
          node.focus()
          return undefined
        }, [p.agentId])

        React.useEffect(() => { fitInput() }, [input, p.agentId])

        // Stick-to-bottom: follow new output only while the reader already
        // sits at the tail; the moment they scroll up to reread, the thread
        // stops yanking them down and a jump-to-latest pill appears instead —
        // the native conversation contract.
        const stickRef = React.useRef(true)
        const railQueuedRef = React.useRef(false)
        const [showJump, setShowJump] = React.useState(false)
        // The native conversation root publishes its measured width as
        // --dsh-conversation-column-width so the content column resolves
        // clamp(680px, column*.64, 920px); this panel is a layout-panel
        // sibling of that root, so it mirrors the same publication here.
        const viewRef = React.useRef(null)
        React.useEffect(() => {
          const el: any = viewRef.current
          if (el === null || el === undefined || typeof ResizeObserver === 'undefined') return
          const publish = (): void => { el.style.setProperty('--dsh-conversation-column-width', `${el.offsetWidth}px`) }
          publish()
          const ro = new ResizeObserver(publish)
          ro.observe(el)
          return () => ro.disconnect()
        }, [])
        // A fresh conversation starts pinned at its tail: without this reset,
        // leaving chat A scrolled up (stick=false) opened chat B parked at top.
        React.useEffect(() => {
          stickRef.current = true
          setShowJump(false)
        }, [p.agentId])
        function onScrollBody(): void {
          const el: any = scrollRef.current
          if (el === null || el === undefined) return
          const distance = el.scrollHeight - el.scrollTop - el.clientHeight
          stickRef.current = distance < 80
          const next = distance > 240
          setShowJump((prev: boolean) => (prev === next ? prev : next))
          // The active turn tick tracks the reading position (native rail).
          // Coalesced to one rAF: measuring every anchor per scroll event
          // would read layout dozens of times a frame for nothing.
          if (railQueuedRef.current || typeof el.querySelectorAll !== 'function') return
          railQueuedRef.current = true
          const measure = (): void => {
            railQueuedRef.current = false
            const anchorTop = el.getBoundingClientRect().top + 32
            let current: string | null = null
            const nodes: any[] = Array.from(el.querySelectorAll('[data-turn-start="true"]'))
            for (const n of nodes) {
              if (n.getBoundingClientRect().top <= anchorTop) current = String(n.getAttribute('data-eid') ?? '')
            }
            setActiveTurn((prev: string | null) => (prev === current ? prev : current))
          }
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(measure)
          else measure()
        }
        function jumpToLatest(): void {
          const el = scrollRef.current
          if (el !== null && el !== undefined) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
        }
        React.useEffect(() => {
          // Instant pin, the native conversation contract: entering a chat
          // lands ON the bottom in one frame. A smooth scroll here animated
          // the whole transcript past on every open, and a follow-up message
          // glided when it should just appear.
          const el = scrollRef.current
          if (el === null || el === undefined) return
          if (stickRef.current) el.scrollTo({ top: el.scrollHeight, behavior: 'auto' })
        }, [entries, composing])

        const memberNames = React.useMemo(() => {
          if (!isGroup) return []
          const ids: string[] = agent?.memberIds ?? []
          return ids
            .map((id) => (state.agents as any[]).find((a) => a.id === id))
            .filter((a) => a !== undefined)
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [isGroup, agent, s.agents])

        /**
         * Grow the textarea to its content, the way the shipped card does:
         * one row when empty, taller line by line, and `.dbs-composerScroll`
         * caps it at `--dsh-composer-text-max-height`. A fixed-height textarea
         * scrolled its own body instead — the one thing the native card never
         * does — so a long draft became a 1-line peephole.
         */
        function fitInput(node?: any): void {
          const el = node ?? inputRef.current
          if (el === null || el === undefined) return
          // Modern engines grow the box themselves via `field-sizing: content`
          // (what the native contenteditable composer does by construction).
          // Measuring here as well would pin an explicit height and take the
          // auto-sizing back out, so the JS path is only for older engines.
          const cssApi: any = typeof globalThis === 'undefined' ? undefined : (globalThis as any).CSS
          if (cssApi !== undefined && typeof cssApi.supports === 'function'
            && cssApi.supports('field-sizing', 'content')) {
            el.style.height = ''
            return
          }
          el.style.height = 'auto'
          el.style.height = String(el.scrollHeight) + 'px'
        }

        /**
         * `@` completion for directed group turns, driven by the caret rather
         * than by the keystroke: moving the caret back into a half-typed
         * mention re-opens the menu, and moving out of it closes the menu.
         */
        function syncMention(node: any): void {
          if (!isGroup || node === null || node === undefined) { setMention(null); return }
          const value = String(node.value)
          const upto = value.slice(0, node.selectionStart ?? value.length)
          const m = /@([^\s@]*)$/.exec(upto)
          // Identity-stable when nothing changed, so a caret sweep does not
          // re-render the menu (and does not reset the highlighted row).
          setMention((prev: any) => {
            if (m === null) return null
            return prev !== null && prev.query === m[1] ? prev : { query: m[1], index: 0 }
          })
        }

        function onInputChange(node: any): void {
          const value = String(node.value)
          setInput(value)
          draftMemory.set(p.agentId, value)
          fitInput(node)
          syncMention(node)
        }

        /**
         * @所有人 is an ENGINE handle (`GROUP_EVERYONE_HANDLES` in sdk-bots
         * group-chat.ts: 所有人/全员/大家/all/everyone) — one literal token in
         * the message text wakes every member. The composer therefore only
         * needs discoverability: offer the token at the top of the menu,
         * matched against its aliases so @全/@大/@a all surface it. Only the
         * user can address everyone; a member typing the token is ignored by
         * the engine's responder election, so this entry is group-composer
         * only (the menu itself already gates on isGroup).
         */
        const EVERYONE_MENTION = { id: '__everyone__', name: '所有人', isGroup: true, everyone: true }
        const EVERYONE_ALIASES = ['所有人', '全员', '大家', 'all', 'everyone']
        const mentionHits = mention === null
          ? []
          : [
              ...(mention.query === '' || EVERYONE_ALIASES.some((h) => h.startsWith(mention.query.toLowerCase()))
                ? [EVERYONE_MENTION]
                : []),
              ...memberNames.filter((a: any) => a.name.toLowerCase().startsWith(mention.query.toLowerCase())).slice(0, 8),
            ]

        // Keyboard selection scrolls the active row into view — the native
        // menu keeps the highlighted item visible however long the list is.
        React.useEffect(() => {
          if (mention === null) return
          const box: any = mentionRef.current
          if (box === null || box === undefined || typeof box.querySelector !== 'function') return
          const row: any = box.querySelector('[data-active="true"]')
          if (row !== null && row !== undefined && typeof row.scrollIntoView === 'function') {
            row.scrollIntoView({ block: 'nearest' })
          }
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [mention?.index, mention?.query, mentionHits.length])

        function applyMention(a: any) {
          const node = inputRef.current
          const caret = node?.selectionStart ?? input.length
          const before = input.slice(0, caret).replace(/@([^\s@]*)$/, '@' + a.name + ' ')
          const next = before + input.slice(caret)
          setInput(next)
          draftMemory.set(p.agentId, next)
          setMention(null)
          if (node === null || node === undefined) return
          node.focus()
          // React rewrites `value` on the next commit, which parks the caret at
          // the end of the whole draft; put it back behind the name completed.
          window.requestAnimationFrame(() => {
            const live = inputRef.current
            if (live === null || live === undefined) return
            live.setSelectionRange(before.length, before.length)
            fitInput(live)
          })
        }

        /** Stop the active run: real gateway interrupt, honest no-op feedback. */
        async function doStop() {
          if (stopping) return
          setStopping(true); setError(null)
          try {
            const r = await botsCall<{ hadActiveRun?: boolean }>('interrupt', { id: p.agentId })
            if (r?.hadActiveRun !== true) setError(t('chat.stop.noop'))
            await refreshAgents()
            await loadTranscript()
          } catch (err: any) { setError(String(err?.message ?? err)) }
          setStopping(false)
        }

        /** Read picked/pasted image files into pending attachments (base64 +
         * local preview URL). The host re-validates type/size/count and
         * materializes them next to the gateway data dir; the engine turns
         * them into model-visible images for direct chats and group turns. */
        async function addImageFiles(files: any): Promise<void> {
          const list = Array.from(files ?? []).filter((f: any) => SEND_IMAGE_TYPES[String(f?.type ?? '').toLowerCase()] === true)
          if (list.length === 0) return
          const room = SEND_IMAGE_LIMIT - pendingImages.length
          if (room <= 0) { setError(t('chat.attach.limit')); return }
          if (list.length > room) setError(t('chat.attach.limit'))
          const added = await Promise.all(list.slice(0, room).map((f: any) => new Promise<any>((done) => {
            const reader = new FileReader()
            reader.onload = () => {
              const url = String(reader.result ?? '')
              const b64 = url.slice(url.indexOf(',') + 1)
              done(b64 === '' ? null : {
                id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
                mediaType: String(f.type).toLowerCase(),
                dataBase64: b64,
                name: String(f.name ?? ''),
                url,
              })
            }
            reader.onerror = () => done(null)
            reader.readAsDataURL(f)
          })))
          const ok = added.filter(Boolean)
          if (ok.length > 0) setPendingImages((prev: any[]) => prev.concat(ok).slice(0, SEND_IMAGE_LIMIT))
        }

        async function doSend() {
          const text = input.trim()
          // Sending during an active run is a QUEUED send: the daemon appends
          // the message durably and its run scheduler delivers the follow-up
          // turn once the active one settles (user lane first; a watchdog
          // frees a wedged run). Blocking here would strand the composer.
          if ((text === '' && pendingImages.length === 0) || sending) return
          setSending(true); setError(null)
          try {
            await botsCall('send', {
              agentId: p.agentId, prompt: text,
              ...(pendingImages.length > 0
                ? { images: pendingImages.map((im: any) => ({ mediaType: im.mediaType, dataBase64: im.dataBase64, name: im.name })) }
                : {}),
            })
            setInput('')
            draftMemory.delete(p.agentId)
            setMention(null)
            setPendingImages([])
            // Sending pins the reader back to the tail: the message just typed
            // is the thing they want to watch, never a place to stay scrolled up.
            stickRef.current = true
            setShowJump(false)
            await refreshAgents()
            await loadTranscript()
          } catch (err: any) { setError(String(err?.message ?? err)) }
          setSending(false)
          // The caret stays in the composer after a send, as in every native
          // thread: the next turn is typed without reaching for the mouse.
          const node = inputRef.current
          if (node !== null && node !== undefined) node.focus()
        }

        // One row per tool call (call+result merged, duration attached) —
        // the native stream model — instead of two loose cards per call.
        const list = mergeToolRuns((entries ?? []) as any[])

        // Turn rail state: measured anchors (ratio of the stream height) and
        // the turn the reader is currently inside. Measured after layout, so a
        // tick sits where its turn actually is.
        const [turnMarks, setTurnMarks] = React.useState([])
        const [activeTurn, setActiveTurn] = React.useState(null)
        React.useEffect(() => {
          const body: any = scrollRef.current
          if (body === null || body === undefined || typeof body.querySelectorAll !== 'function') return
          const total = body.scrollHeight || 1
          const box = body.getBoundingClientRect()
          const nodes: any[] = Array.from(body.querySelectorAll('[data-turn-start="true"]'))
          setTurnMarks(nodes.map((n: any) => ({
            id: String(n.getAttribute('data-eid') ?? ''),
            label: (String(n.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)) || t('chat.jump'),
            ratio: Math.max(0, Math.min(1, (n.getBoundingClientRect().top - box.top + body.scrollTop) / total)),
          })))
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [entries, p.agentId])
        function goToTurn(id: string): void {
          const body: any = scrollRef.current
          if (body === null || body === undefined || typeof body.querySelector !== 'function') return
          const node: any = body.querySelector('[data-eid="' + id + '"]')
          if (node === null || node === undefined) return
          stickRef.current = false
          node.scrollIntoView({ block: 'start' })
        }

        // Day dividers, folded in during render: a bare `HH:MM` turns
        // ambiguous the moment a transcript crosses midnight, so the date is
        // stated once and the rows beneath it carry only the clock.
        // Consecutive same-author bot messages within the window group under
        // one header — follow-ups go compact, the native IM run pattern.
        const GROUP_WINDOW_MS = 5 * 60 * 1000
        const thread: any[] = []
        let lastDay: number | null = null
        let run: { authorId: string | null; at: number } | null = null
        list.forEach((en: any, i: number) => {
          const ms = timeOf(en)
          if (ms !== null) {
            const day = dayIndexOf(ms)
            if (day !== lastDay) {
              lastDay = day
              run = null
              thread.push(e('div', { className: 'dbs-dayDivider', key: 'day:' + String(day) },
                e('span', null, dayLabelOf(ms))))
            }
          }
          const authorId = en.display === 'bot' && typeof en.authorId === 'string' ? en.authorId : null
          const compact = authorId !== null && run !== null && run.authorId === authorId
            && ms !== null && run.at !== null && ms - run.at >= 0 && ms - run.at <= GROUP_WINDOW_MS
          if (authorId !== null) run = { authorId, at: ms ?? run?.at ?? 0 }
          else run = null
          // Native flow item: one stable anchor per entry, so the turn rail can
          // measure positions and scroll a chosen turn into view by id. A turn
          // starts at a user message (or an image the user attached).
          const turnStart = en.display === 'user' || en.display === 'attachment'
          thread.push(e('div', {
            key: en.id !== '' ? en.id : String(i),
            className: 'dbs-flowItem',
            'data-eid': en.id !== '' ? en.id : String(i),
            'data-turn-start': turnStart ? 'true' : undefined,
          }, e(Entry, { entry: en, isGroup, agent, compact })))
        })

        return e('div', { className: 'dbs-chatview', ref: viewRef },
          e('div', { className: 'dbs-chatbar' },
            e(Button, {
              variant: 'ghost', size: 'sm', title: t('action.close'), 'aria-label': t('action.close'),
              icon: Ico('IconCloseOutline16', { size: 16 }),
              onClick: () => layoutSvc.selectPanel(null),
            }),
            agent !== null ? e(Avatar, { agent, size: 24, round: true }) : null,
            e('span', { className: 'dbs-chatbarName' }, agent?.name ?? t('chat.loading')),
            e('span', { className: 'dbs-meta' }, isGroup ? t('chat.group', { n: memberNames.length }) : t('chat.single')),
            e('span', { style: { flex: 1 } }),
            !isGroup ? e('div', { className: 'dbs-goalTabs', role: 'group', 'aria-label': t('goal.views') },
              e('button', { type: 'button', 'aria-pressed': !goalTab, onClick: () => setGoalTab(false) }, t('goal.chat')),
              e('button', { type: 'button', 'aria-pressed': goalTab, onClick: () => setGoalTab(true) }, t('goal.title'))) : null,
            isGroup
              ? e(Button, {
                  variant: 'ghost', size: 'sm', title: t('chat.members.manage'), 'aria-label': t('chat.members.manage'),
                  onClick: () => patch({ manageMembers: p.agentId }),
                }, t('chat.members.manage'))
              : null,
            e('button', {
              className: 'dbs-railBtn', type: 'button',
              title: t('chat.settings'), 'aria-label': t('chat.settings'),
              onClick: () => patch({ settingsAgentId: p.agentId }),
            }, e(SettingsGlyph, null))),

          error !== null
            ? e('div', { className: 'dbs-error', onClick: () => setError(null) }, error)
            : null,

          goalTab && !isGroup ? e(GoalPanel, { agentId: p.agentId, key: p.agentId }) : null,
          e('div', { className: 'dbs-scrollArea', style: goalTab ? { display: 'none' } : undefined },
            turnMarks.length > 1
              ? e(TurnRail, { marks: turnMarks, activeId: activeTurn, busy: composing, onGo: goToTurn })
              : null,
            e('div', { className: 'dbs-scrollBody', ref: scrollRef, onScroll: onScrollBody },
              e('div', { className: 'dbs-scroll' },
                e('div', { className: 'dbs-column' },
                  entries === null
                    ? e('div', { className: 'dbs-skeleton' },
                        e('div', { className: 'dbs-skelRow', style: { width: '42%' } }),
                        e('div', { className: 'dbs-skelRow', style: { width: '76%' } }),
                        e('div', { className: 'dbs-skelRow', style: { width: '58%' } }))
                    : list.length === 0
                      ? e('div', { className: 'dbs-welcome' },
                          agent !== null ? e(Avatar, { agent, size: 44, round: true }) : null,
                          e('div', { className: 'dbs-welcomeName' }, agent?.name ?? ''),
                          typeof agent?.description === 'string' && agent.description !== ''
                            ? e('div', { className: 'dbs-welcomeDesc' }, agent.description) : null,
                          e('div', { className: 'dbs-welcomeHint' },
                            isGroup ? t('chat.empty.group') : t('chat.empty.single', { name: agent?.name ?? '' })))
                      : thread,
                  composing
                    ? e('div', { className: 'dbs-typing', role: 'status', 'aria-live': 'polite', 'aria-label': t('chat.composing') },
                        NATIVE.TextShimmer !== undefined
                          ? e(NATIVE.TextShimmer, { active: true, className: 'dbs-turnStatus' }, t('chat.composing'))
                          : e('span', { className: 'dbs-turnStatus' }, t('chat.composing')),
                        elapsedMs !== null && elapsedMs >= 15000
                          ? e('span', { className: 'dbs-turnStatusClock', 'aria-hidden': true }, formatRunDuration(elapsedMs))
                          : null)
                    : null))),
            e('button', {
              type: 'button', className: 'dbs-jump', 'data-show': showJump ? 'true' : 'false',
              'aria-label': t('chat.jump'), title: t('chat.jump'),
              onClick: jumpToLatest,
            }, Ico('IconChevronDownOutline14', { size: 16 }))),

          e('div', { className: 'dbs-composerSeat', style: goalTab ? { display: 'none' } : undefined },
            e('div', { className: 'dbs-composer' },
              e('div', {
                className: 'dbs-composerCard',
                // The whole card is the input's hit area natively — clicking
                // its padding must land the caret, not swallow the click.
                // Buttons and the mention menu keep their own targets.
                onMouseDown: (ev: any) => {
                  const node = inputRef.current
                  if (node === null || node === undefined || node === ev.target) return
                  if (typeof ev.target?.closest === 'function'
                    && ev.target.closest('button, textarea, input, .dbs-mention') !== null) return
                  ev.preventDefault()
                  node.focus()
                },
              },
                mentionHits.length > 0
                  ? e('div', { className: 'dbs-mention' },
                      e('div', { className: 'dbs-mentionViewport', ref: mentionRef }, mentionHits.map((a: any, i: number) => e('div', {
                        key: a.id, className: 'dbs-mentionRow', 'data-active': i === (mention?.index ?? 0),
                        onMouseDown: (ev: any) => { ev.preventDefault(); applyMention(a) },
                      },
                        e('span', { className: 'dbs-mentionIcon' },
                          a.everyone === true ? e(PeopleGlyph, null) : e(Avatar, { agent: a, size: 16 })),
                        e('span', { className: 'dbs-mentionName' }, a.name),
                        e('span', { className: 'dbs-mentionDesc' }, String(a.description ?? '').split('\n')[0]),
                        // The native menu advertises its keyboard drill on the
                        // active row only; Tab completes (@ list has one level).
                        e('span', { className: 'dbs-mentionHint' }, 'Tab')))))
                  : null,
                // Hidden picker behind the attach button. The accept list is
                // the UX filter; the host re-validates the real allowlist.
                e('input', {
                  ref: fileRef, type: 'file', multiple: true,
                  accept: 'image/png,image/jpeg,image/gif,image/webp,image/bmp',
                  style: { display: 'none' },
                  'aria-hidden': true, tabIndex: -1,
                  onChange: (ev: any) => {
                    void addImageFiles(ev.target?.files)
                    if (ev.target != null) ev.target.value = ''
                  },
                }),
                pendingImages.length > 0
                  ? e('div', { className: 'dbs-pendingImgs' },
                      pendingImages.map((im: any) => e('div', { key: im.id, className: 'dbs-pendingImg' },
                        e('div', { className: 'dbs-pendingImgThumb' },
                          e('img', { src: im.url, alt: im.name === '' ? 'image' : im.name })),
                        e('button', {
                          type: 'button', className: 'dbs-pendingImgX',
                          title: t('chat.attach.remove'), 'aria-label': t('chat.attach.remove'),
                          onClick: () => setPendingImages((prev: any[]) => prev.filter((x: any) => x.id !== im.id)),
                        }, '×'))))
                  : null,
                e('div', { className: 'dbs-composerScroll' },
                  e('textarea', {
                    ref: inputRef, className: 'dbs-composerInput', value: input, rows: 1,
                    placeholder: composing
                      ? t('chat.placeholder.busy')
                      : isGroup ? t('chat.placeholder.group') : t('chat.placeholder.single', { name: agent?.name ?? '' }),
                    // Native chrome: no spellcheck squiggles, no autocomplete
                    // dropdown over the card, and a plain multi-line seat.
                    spellCheck: false, autoComplete: 'off', autoCorrect: 'off', autoCapitalize: 'off',
                    onChange: (ev: any) => onInputChange(ev.target),
                    // Caret moves (click, arrows, Home/End) re-evaluate the
                    // mention token, so the menu tracks the caret, not typing.
                    onSelect: (ev: any) => syncMention(ev.target),
                    onCompositionStart: () => { imeRef.current.active = true },
                    onCompositionEnd: (ev: any) => {
                      imeRef.current.active = false
                      // Keep the guard hot for 10ms: Safari fires compositionend
                      // *after* the Enter keydown that commits the candidate, so
                      // a bare boolean would let that Enter slip through as a
                      // send. The native composer's recentlyComposing window.
                      imeRef.current.until = Date.now() + 10
                      // Firefox/Safari fire this *after* the keydown that
                      // committed the candidate, so the committed value has to
                      // be picked up here rather than in the change handler.
                      onInputChange(ev.target)
                    },
                    onBlur: () => setMention(null),
                    // Paste an image straight from the clipboard (screenshots):
                    // the paste event is separate from the IME keydown guard,
                    // so this composes with the native keymap unchanged.
                    onPaste: (ev: any) => {
                      const files = Array.from(ev.clipboardData?.files ?? []).filter((f: any) => SEND_IMAGE_TYPES[String(f?.type ?? '').toLowerCase()] === true)
                      if (files.length > 0) { ev.preventDefault(); void addImageFiles(files) }
                    },
                    onKeyDown: (ev: any) => {
                      // While an IME candidate window is open it owns Enter,
                      // the arrows and Escape. `isComposing` is the standard
                      // signal; keyCode 229 covers the engines that omit it;
                      // the 10ms post-composition window covers the engines
                      // (Safari) whose compositionend lags the commit Enter.
                      if (imeRef.current.active
                        || Date.now() < imeRef.current.until
                        || ev.nativeEvent?.isComposing === true
                        || ev.keyCode === 229) return
                      if (mentionHits.length > 0 && (ev.key === 'Enter' || ev.key === 'Tab')) {
                        ev.preventDefault(); applyMention(mentionHits[mention?.index ?? 0]); return
                      }
                      if (mentionHits.length > 0 && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
                        ev.preventDefault()
                        const d = ev.key === 'ArrowDown' ? 1 : -1
                        const n = mentionHits.length
                        setMention({ ...mention, index: (((mention?.index ?? 0) + d) % n + n) % n })
                        return
                      }
                      if (ev.key === 'Escape' && mention !== null) {
                        // Dismissing the menu must not also reach the overlay's
                        // window-level Escape, which would close the chat.
                        ev.preventDefault(); ev.stopPropagation(); setMention(null); return
                      }
                      if (ev.key === 'Enter' && !ev.shiftKey) {
                        ev.preventDefault()
                        // Held-Enter auto-repeat must not spam the queue; a
                        // single physical press sends once (native keymap).
                        if (ev.repeat === true) return
                        void doSend()
                      }
                    },
                  })),
                e('div', { className: 'dbs-composerRow' },
                  // Native InputBar geometry: a LEFT tools group (the 28px
                  // round add buttons) and a RIGHT trailing group (send/stop).
                  e('div', { className: 'dbs-composerTools' },
                    e('button', {
                      type: 'button', className: 'dbs-attachBtn',
                      title: t('chat.attach'), 'aria-label': t('chat.attach'),
                      onClick: () => { const node: any = fileRef.current; if (node !== null && node !== undefined) node.click() },
                    // Element, not component: nat() hands back the raw export,
                    // and a function child renders nothing — the exact way the
                    // paperclip vanished.
                    }, Ico('IconPaperclipOutline16', { size: 14 }) ?? e(PaperclipGlyph, null))),
                  e('div', { className: 'dbs-composerTrailing' },
                    // ONE morphing circle, always — the native InputBar
                    // contract. With text in hand the corner is the action for
                    // that text: send when idle, a queued send while a run is
                    // active (the daemon persists it and the run scheduler
                    // delivers the follow-up turn after this one settles —
                    // Enter queues the same way). Stop owns the corner only
                    // when there is nothing to send, exactly as the native
                    // primaryStops gate does; no separate stop button and no
                    // character counter live in the native trailing group.
                    // Pending images count as "something to send": the corner
                    // stays a send even with an empty caption.
                    composing && input.trim() === '' && pendingImages.length === 0
                      ? e('button', {
                          type: 'button', className: 'dbs-send dbs-stop',
                          disabled: stopping,
                          title: t('action.stop'), 'aria-label': t('action.stop'),
                          onClick: () => void doStop(),
                        }, e(StopSquareIcon, null))
                      : e('button', {
                          type: 'button', className: 'dbs-send',
                          disabled: sending || (input.trim() === '' && pendingImages.length === 0),
                          title: composing ? t('chat.queuedSend') : t('action.send'),
                          'aria-label': composing ? t('chat.queuedSend') : t('action.send'),
                          onClick: () => void doSend(),
                        }, e(SendUpIcon, null))))))))
      }

      // =========================================================
      // Settings section.
      // =========================================================
      /**
       * MCP servers card (DEVELOPMENT.md §13): the engine hosts the MCP
       * stack, so this surface is a thin management view — list with live
       * status, add (stdio or URL config JSON), remove (two-click confirm),
       * restart. Tool try-run lives in the workbench, not here.
       */
      function McpCard() {
        const [servers, setServers] = React.useState(null)
        const [toolCount, setToolCount] = React.useState(null)
        const [err, setErr] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const [confirmId, setConfirmId] = React.useState(null)
        const [adding, setAdding] = React.useState(false)
        const [name, setName] = React.useState('')
        const [configJson, setConfigJson] = React.useState('')
        async function reload() {
          setErr(null)
          try {
            const s = await botsCall<{ servers?: any[] }>('mcpServers', {})
            setServers((s?.servers ?? []) as any[])
            const tl = await botsCall<{ tools?: any[] }>('mcpTools', {})
            setToolCount((tl?.tools ?? []).length)
          } catch (e2: any) { setErr(errText(e2)) }
        }
        React.useEffect(() => { void reload() }, [])
        async function run(fn: () => Promise<unknown>) {
          setBusy(true); setErr(null)
          try { await fn(); await reload() } catch (e2: any) { setErr(errText(e2)) } finally { setBusy(false) }
        }
        function dotState(status: string): string {
          if (status === 'connected') return 'done'
          if (status === 'needsAuth') return 'warning'
          if (status === 'error') return 'failed'
          return 'ongoing'
        }
        async function submitAdd() {
          if (busy || name.trim() === '' || configJson.trim() === '') return
          await run(async () => {
            await botsCall('mcpAdd', { name: name.trim(), configJson: configJson.trim() })
            setAdding(false); setName(''); setConfigJson('')
          })
        }
        return e('div', { className: 'dbs-setcard' },
          e('div', { className: 'dbs-sethead' },
            e('span', { className: 'dbs-title' }, t('settings.mcp')),
            e('span', { style: { flex: 1 } }),
            e(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => void reload() }, t('action.refresh')),
            e(Button, {
              variant: 'ghost', size: 'sm', disabled: busy,
              onClick: () => void run(() => botsCall('mcpRefresh', {})),
            }, busy ? t('settings.mcp.restarting') : t('settings.mcp.restart')),
            e(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => setAdding(!adding) }, t('settings.mcp.add'))),
          e('div', { className: 'dbs-setrow' }, t('settings.mcp.summary')),
          toolCount !== null
            ? e('div', { className: 'dbs-setrow' }, t('settings.mcp.tools'), e('b', null, String(toolCount)))
            : null,
          adding ? e('div', { className: 'dbs-setcard', style: { margin: '6px 0' } },
            e(Input, {
              placeholder: t('settings.mcp.namePlaceholder'), value: name, disabled: busy,
              onChange: (ev: any) => setName(ev.target.value),
            }),
            e('textarea', {
              placeholder: t('settings.mcp.configPlaceholder'), value: configJson, disabled: busy,
              rows: 3, onChange: (ev: any) => setConfigJson(ev.target.value),
              style: {
                width: '100%', marginTop: 6, padding: '6px 8px', fontSize: 12, lineHeight: '18px',
                borderRadius: 8, border: '1px solid var(--dsw-alias-border-l, #ccc)', resize: 'vertical',
                background: 'transparent', color: 'var(--dsw-alias-label-primary, inherit)', fontFamily: 'monospace',
              },
            }),
            e('div', { className: 'dbs-setrow', style: { marginTop: 6 } },
              e(Button, {
                variant: 'ghost', size: 'sm', disabled: busy,
                onClick: () => setConfigJson(t('settings.mcp.exampleStdioValue')),
              }, t('settings.mcp.exampleStdio')),
              e(Button, {
                variant: 'ghost', size: 'sm', disabled: busy,
                onClick: () => setConfigJson(t('settings.mcp.exampleUrlValue')),
              }, t('settings.mcp.exampleUrl')),
              e('span', { style: { flex: 1 } }),
              e(Button, {
                variant: 'primary', size: 'sm', disabled: busy || name.trim() === '' || configJson.trim() === '',
                onClick: () => void submitAdd(),
              }, busy ? t('settings.mcp.adding') : t('settings.mcp.add')))) : null,
          servers === null
            ? e('div', { className: 'dbs-setrow' }, t('settings.reading'))
            : servers.length === 0
              ? e('div', { className: 'dbs-setrow' }, t('settings.mcp.empty'))
              : servers.map((sv: any) => e('div', {
                  key: sv.id || sv.serverIdentifier, className: 'dbs-setrow',
                  style: { alignItems: 'center' },
                },
                  StateDot !== null ? e(StateDot, { state: dotState(sv.status), size: 8 }) : null,
                  e('b', null, sv.name || sv.serverIdentifier),
                  e('span', { className: 'dbs-meta' },
                    ` ${sv.status}${sv.transport !== '' ? ' · ' + sv.transport : ''} · ${sv.toolCount} tools`),
                  sv.statusDetail ? e('span', { className: 'dbs-meta' }, ` · ${sv.statusDetail}`) : null,
                  e('span', { style: { flex: 1 } }),
                  e(Button, {
                    variant: 'ghost', size: 'sm', disabled: busy,
                    onClick: () => {
                      if (confirmId !== sv.id) { setConfirmId(sv.id); return }
                      setConfirmId(null)
                      void run(() => botsCall('mcpRemove', { serverId: sv.id }))
                    },
                  }, confirmId === sv.id ? t('settings.mcp.removeConfirm') : t('settings.mcp.remove')))),
          err !== null ? e('div', { className: 'dbs-setrow' }, t('settings.mcp.failed'), err) : null)
      }

      /**
       * Skills card: manage the engine's built-in skill library (SKILL.md
       * files, dsh's own format — see docs/bots-skills-and-model-picker.md
       * Part A). The engine gateway exposes the full CRUD; the library is
       * GLOBAL across bots while enablement is per-bot, so the card pins a
       * bot selector and drives everything through that view. Plugin and
       * managed rows are always-on (the engine refuses per-agent disable for
       * those sources), and rows with a trigger are scheduled routines.
       */
      function SkillsCard() {
        const [agents, setAgents] = React.useState(null as any[] | null)
        const [agentId, setAgentId] = React.useState('')
        const [rows, setRows] = React.useState(null as any[] | null)
        const [editing, setEditing] = React.useState(null as { id?: string; name: string; description: string; body: string } | null)
        const [importing, setImporting] = React.useState(false)
        const [importMarkdown, setImportMarkdown] = React.useState('')
        const [importName, setImportName] = React.useState('')
        const [busy, setBusy] = React.useState(false)
        const [confirmId, setConfirmId] = React.useState(null as string | null)
        const [err, setErr] = React.useState(null as string | null)
        async function reload(pid?: string) {
          setErr(null)
          try {
            const id = pid ?? agentId
            let pool = agents
            if (pool === null || id === '') {
              const lst = await botsCall<any>('list', {})
              // The RPC returns a bare AgentInfo[] (the sidebar relies on it);
              // accept the object wrapper too for future-proofing.
              pool = (Array.isArray(lst) ? lst : (lst?.agents ?? [])) as any[]
              setAgents(pool)
            }
            const next = id !== '' ? id : String(pool?.[0]?.id ?? '')
            if (next !== '' && next !== agentId) setAgentId(next)
            if (next === '') { setRows([]); return }
            const res = await botsCall<{ skills?: any[] }>('skillsList', { agentId: next })
            setRows((res?.skills ?? []) as any[])
          } catch (e2: any) { setErr(errText(e2)) }
        }
        React.useEffect(() => { void reload() }, [])
        async function run(fn: () => Promise<unknown>) {
          setBusy(true); setErr(null)
          try { await fn(); await reload() } catch (e2: any) { setErr(errText(e2)) } finally { setBusy(false) }
        }
        function sourceKey(row: any): string {
          return row?.trigger != null ? 'automation' : String(row?.source ?? 'workflow')
        }
        function editable(row: any): boolean {
          return row?.trigger == null && row?.source === 'workflow'
        }
        async function submitEdit() {
          if (editing === null || editing.name.trim() === '' || editing.body.trim() === '') return
          await run(async () => {
            await botsCall('skillsSave', {
              agentId, ...(editing.id !== undefined ? { id: editing.id } : {}),
              name: editing.name, description: editing.description, body: editing.body,
            })
            setEditing(null)
          })
        }
        async function submitImport() {
          if (importMarkdown.trim() === '') return
          await run(async () => {
            await botsCall('skillsImportText', { agentId, markdown: importMarkdown, ...(importName.trim() === '' ? {} : { name: importName.trim() }) })
            setImporting(false); setImportMarkdown(''); setImportName('')
          })
        }
        return e('div', { className: 'dbs-setcard' },
          e('div', { className: 'dbs-sethead' },
            e('span', { className: 'dbs-title' }, t('settings.skills')),
            e('span', { style: { flex: 1 } }),
            e(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => void reload() }, t('action.refresh')),
            e(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => setImporting(!importing) }, t('settings.skills.import')),
            e(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => setEditing({ name: '', description: '', body: '' }) }, t('settings.skills.add'))),
          e('div', { className: 'dbs-setrow' }, t('settings.skills.summary')),
          (agents ?? []).length > 0 ? e('div', { className: 'dbs-setrow', style: { alignItems: 'center' } },
            t('settings.skills.agent'),
            e('select', {
              className: 'dbs-select', value: agentId, disabled: busy,
              onChange: (ev: any) => { setAgentId(ev.target.value); void reload(ev.target.value) },
            }, (agents ?? []).map((a: any) => e('option', { key: a.id, value: a.id }, a.name ?? a.id)))) : null,
          editing !== null ? e('div', { className: 'dbs-setcard', style: { margin: '6px 0' } },
            e(Input, {
              placeholder: t('settings.skills.namePlaceholder'), value: editing.name, disabled: busy,
              onChange: (ev: any) => setEditing({ ...editing, name: ev.target.value }),
            }),
            e(Input, {
              placeholder: t('settings.skills.descPlaceholder'), value: editing.description, disabled: busy,
              onChange: (ev: any) => setEditing({ ...editing, description: ev.target.value }),
            }),
            e('textarea', {
              placeholder: t('settings.skills.bodyPlaceholder'), value: editing.body, disabled: busy, rows: 10,
              onChange: (ev: any) => setEditing({ ...editing, body: ev.target.value }),
              style: {
                width: '100%', marginTop: 6, padding: '6px 8px', fontSize: 12, lineHeight: '18px',
                borderRadius: 8, border: '1px solid var(--dsw-alias-border-l, #ccc)', resize: 'vertical',
                background: 'transparent', color: 'var(--dsw-alias-label-primary, inherit)', fontFamily: 'monospace',
              },
            }),
            e('div', { className: 'dbs-setrow', style: { marginTop: 6 } },
              e(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => setEditing(null) }, t('settings.skills.cancel')),
              e('span', { style: { flex: 1 } }),
              e(Button, {
                variant: 'primary', size: 'sm', disabled: busy || editing.name.trim() === '' || editing.body.trim() === '',
                onClick: () => void submitEdit(),
              }, busy ? t('settings.skills.saving') : t('settings.skills.save')))) : null,
          importing ? e('div', { className: 'dbs-setcard', style: { margin: '6px 0' } },
            e(Input, {
              placeholder: t('settings.skills.namePlaceholder'), value: importName, disabled: busy,
              onChange: (ev: any) => setImportName(ev.target.value),
            }),
            e('textarea', {
              placeholder: t('settings.skills.bodyPlaceholder'), value: importMarkdown, disabled: busy, rows: 8,
              onChange: (ev: any) => setImportMarkdown(ev.target.value),
              style: {
                width: '100%', marginTop: 6, padding: '6px 8px', fontSize: 12, lineHeight: '18px',
                borderRadius: 8, border: '1px solid var(--dsw-alias-border-l, #ccc)', resize: 'vertical',
                background: 'transparent', color: 'var(--dsw-alias-label-primary, inherit)', fontFamily: 'monospace',
              },
            }),
            e('div', { className: 'dbs-setrow', style: { marginTop: 6 } },
              e(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => setImporting(false) }, t('settings.skills.cancel')),
              e('span', { style: { flex: 1 } }),
              e(Button, {
                variant: 'primary', size: 'sm', disabled: busy || importMarkdown.trim() === '',
                onClick: () => void submitImport(),
              }, busy ? t('settings.skills.importing') : t('settings.skills.import')))) : null,
          rows === null
            ? e('div', { className: 'dbs-setrow' }, t('settings.reading'))
            : rows.length === 0
              ? e('div', { className: 'dbs-setrow' }, t('settings.skills.empty'))
              : rows.map((row: any) => {
                  const key = sourceKey(row)
                  const canToggle = editable(row)
                  // Literal keys only — the locale guard scans t-call literals.
                  const sourceLabel = key === 'automation' ? t('settings.skills.source.automation')
                    : key === 'managed' ? t('settings.skills.source.managed')
                    : key === 'plugin' ? t('settings.skills.source.plugin')
                    : t('settings.skills.source.workflow')
                  return e('div', { key: row.id, className: 'dbs-setrow', style: { alignItems: 'center' } },
                    e('b', null, row.name ?? row.id),
                    e('span', { className: 'dbs-meta' },
                      ` ${sourceLabel}`,
                      row.trigger != null && row.scheduleDescription ? ' · ' + t('settings.skills.schedule') + row.scheduleDescription : '',
                      row.description ? ' · ' + String(row.description).split('\n')[0].slice(0, 120) : ''),
                    e('span', { style: { flex: 1 } }),
                    canToggle
                      ? e(Button, {
                          variant: 'ghost', size: 'sm', disabled: busy,
                          title: row.isEnabledForAgent === false ? t('settings.skills.off') : t('settings.skills.on'),
                          onClick: () => void run(() => botsCall('skillsEnable', {
                            agentId, workflowId: row.id, isEnabled: row.isEnabledForAgent !== true,
                          })),
                        }, row.isEnabledForAgent === false ? t('settings.skills.off') : t('settings.skills.on'))
                      : e('span', { className: 'dbs-meta', title: t('settings.skills.lockedHint') }, ' '),
                    row.trigger != null
                      ? e(Button, {
                          variant: 'ghost', size: 'sm', disabled: busy,
                          onClick: () => void run(() => botsCall('skillsRunNow', { agentId, workflowId: row.id })),
                        }, t('settings.skills.run'))
                      : null,
                    editable(row)
                      ? e(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => setEditing({ id: row.id, name: row.name ?? '', description: row.description ?? '', body: row.body ?? '' }) }, t('settings.skills.edit'))
                      : null,
                    editable(row)
                      ? e(Button, {
                          variant: 'ghost', size: 'sm', disabled: busy,
                          onClick: () => {
                            if (confirmId !== row.id) { setConfirmId(row.id); return }
                            setConfirmId(null)
                            void run(() => botsCall('skillsDelete', { agentId, workflowId: row.id }))
                          },
                        }, confirmId === row.id ? t('settings.skills.deleteConfirm') : t('settings.skills.delete'))
                      : null)
                }),
          err !== null ? e('div', { className: 'dbs-setrow' }, t('settings.skills.failed'), err) : null)
      }

      /**
       * Workspace card: per-agent Seatbelt jail management (the engine owns
       * the isolation; this surface edits each agent's settings.json jail
       * keys — see DEVELOPMENT.md §14). Toggling writes the config; the jail
       * arms on the bot's NEXT turn, no restart.
       */
      function WorkspaceCard() {
        const [rows, setRows] = React.useState(null)
        const [names, setNames] = React.useState({})
        const [err, setErr] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const [confirmId, setConfirmId] = React.useState(null)
        async function reload() {
          setErr(null)
          try {
            const ws = await botsCall<{ workspaces?: any[] }>('workspaceList', {})
            setRows((ws?.workspaces ?? []) as any[])
            const agents = await botsCall<{ agents?: any[] }>('list', {})
            const map: Record<string, string> = {}
            for (const a of agents?.agents ?? []) map[a.id] = a.name
            setNames(map)
          } catch (e2: any) { setErr(errText(e2)) }
        }
        React.useEffect(() => { void reload() }, [])
        async function toggle(row: any) {
          if (busy) return
          setBusy(true); setErr(null)
          try {
            if (row.workspaceRoot === null) {
              const slug = (names[row.agentId] ?? row.agentId).trim()
              await botsCall('workspaceSet', { agentId: row.agentId, workspaceRoot: '/workspace/' + slug })
            } else {
              await botsCall('workspaceSet', { agentId: row.agentId, workspaceRoot: null })
            }
            await reload()
          } catch (e2: any) { setErr(errText(e2)) } finally { setBusy(false) }
        }
        const jailed = (rows ?? []).filter((r: any) => r.workspaceRoot !== null).length
        return e('div', { className: 'dbs-setcard' },
          e('div', { className: 'dbs-sethead' },
            e('span', { className: 'dbs-title' }, t('settings.jail.title')),
            e('span', { style: { flex: 1 } }),
            e(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => void reload() }, t('action.refresh'))),
          e('div', { className: 'dbs-setrow' }, t('settings.jail.summary')),
          rows !== null ? e('div', { className: 'dbs-setrow' }, t('settings.jail.count'), e('b', null, `${jailed} / ${rows.length}`)) : null,
          rows === null
            ? e('div', { className: 'dbs-setrow' }, t('settings.reading'))
            : rows.map((row: any) => e('div', {
                key: row.agentId, className: 'dbs-setrow', style: { alignItems: 'center' },
              },
                row.workspaceRoot !== null && StateDot !== null ? e(StateDot, { state: 'done', size: 8 }) : null,
                e('b', null, names[row.agentId] ?? row.agentId),
                row.workspaceRoot !== null
                  ? e('span', { className: 'dbs-meta' }, ` ${row.workspaceRoot}${row.allowPaths.length > 0 ? ` · +${row.allowPaths.length}` : ''}`)
                  : null,
                e('span', { style: { flex: 1 } }),
                e(Button, {
                  variant: row.workspaceRoot !== null ? 'ghost' : 'outline', size: 'sm', disabled: busy,
                  onClick: () => {
                    if (row.workspaceRoot !== null && confirmId !== row.agentId) { setConfirmId(row.agentId); return }
                    setConfirmId(null)
                    void toggle(row)
                  },
                }, row.workspaceRoot !== null
                  ? (confirmId === row.agentId ? t('settings.jail.offConfirm') : t('settings.jail.off'))
                  : t('settings.jail.on')))),
          err !== null ? e('div', { className: 'dbs-setrow' }, t('settings.mcp.failed'), err) : null)
      }

      /** Model configuration card: freeroute availability + the engine's
       * account-level default model (getHostSettings/setHostSettings). Two
       * stages: pick a provider (grouped by freeroute's owned_by), then a
       * model within it. Provider '' = freeroute auto-routing (no override);
       * freeroute down = the account default. */
      function ModelCard() {
        const [cfg, setCfg] = React.useState(undefined)
        const [working, setWorking] = React.useState(false)
        const [err, setErr] = React.useState(null as string | null)
        // null = untouched (derive from the current model); '' = auto chosen.
        const [provRaw, setProv] = React.useState(null as string | null)
        const [rebooted, setRebooted] = React.useState(false)
        async function refresh() {
          setCfg(undefined); setErr(null)
          try { setCfg(await botsCall('modelConfig', {})) } catch (e2: any) { setErr(errText(e2)) }
        }
        React.useEffect(() => { void refresh() }, [])
        const current = cfg?.agentDefaultModel ?? null
        const effLabel = current !== null
          ? current
          : (cfg?.freerouteReachable === true ? t('settings.model.auto') : t('settings.model.engineDefault'))
        async function save(modelId: string | null) {
          setWorking(true); setErr(null); setRebooted(false)
          try {
            await botsCall('setModelConfig', { modelId })
            await refresh()
          } catch (e2: any) { setErr(errText(e2)) }
          setWorking(false)
        }
        /** The engine reads its model from the environment at startup, so this
         * rewrites the launchd env and restarts the job — the only thing that
         * makes a pick real. The restart is reported, never implied — and a
         * FAILED restart is shouted, never swallowed (the 2026-09-18 outage
         * hid behind exactly this silence: the engine sat unloaded for hours
         * while the picker looked successful). */
        async function applyEngine(modelId: string) {
          setWorking(true); setErr(null); setRebooted(false)
          try {
            const r: any = await botsCall('applyModel', { modelId })
            setRebooted(r?.restarted === true)
            if (r?.restarted !== true) {
              const detail = Array.isArray(r?.errors) && r.errors.length > 0 ? ' ' + r.errors.join(' | ') : ''
              setErr(t('settings.model.applyFailed') + detail)
            }
            await refresh()
          } catch (e2: any) { setErr(errText(e2)) }
          setWorking(false)
        }
        // Provider rows. freeroute groups by upstream aggregator, which hides
        // DeepSeek inside `orcarouter`; the engine's DeepSeek ids are lifted
        // into their own bucket so the provider list reads like DSH's. The DSH
        // catalog (llm service) is appended as `<id>` rows so the same
        // providers/models the native model page offers are visible here too.
        const groups: any[] = Array.isArray(cfg?.groups) ? cfg.groups : []
        const deepseekModels: string[] = Array.isArray(cfg?.deepseek) ? cfg.deepseek : []
        const nativeProviders: any[] = Array.isArray(cfg?.native?.providers) ? cfg.native.providers : []
        const engineModel: string | null = typeof cfg?.engine?.modelId === 'string' ? cfg.engine.modelId : null
        const providers: any[] = [
          ...(deepseekModels.length > 0
            ? [{ key: '__deepseek', label: `${t('settings.model.deepseek')}（${deepseekModels.length}）`, models: deepseekModels }]
            : []),
          ...groups.map((g: any) => ({ key: g.provider, label: `${g.provider}（${g.models.length}）`, models: g.models })),
          ...nativeProviders.map((p: any) => ({
            key: 'dsh:' + p.id,
            label: `DSH · ${p.name}（${p.models.length}）`,
            models: p.models.map((m: any) => p.id + '/' + m.id),
          })),
        ]
        const groupOf = current !== null
          ? (groups.find((g: any) => g.models.indexOf(current) !== -1) ?? null)
          : null
        const prov = provRaw !== null ? provRaw : (groupOf !== null ? groupOf.provider : '')
        const provModels = prov !== ''
          ? ((providers.find((g: any) => g.key === prov)?.models ?? []) as string[])
          : []
        // A current model whose provider vanished from freeroute's list stays
        // visible as a lone option so the card never renders a dead select.
        const orphan = prov === '' && current !== null && groupOf === null
        return e('div', { className: 'dbs-setcard' },
          e('div', { className: 'dbs-sethead' },
            e('span', null, t('settings.model.title')),
            e('span', { style: { flex: 1 } }),
            working ? e('span', { className: 'dbs-meta' }, t('settings.model.saving')) : null),
          e('div', { className: 'dbs-setrow' }, t('settings.model.current'), e('b', null, cfg === undefined ? t('settings.reading') : effLabel)),
          e('div', { className: 'dbs-setrow' }, t('settings.model.provider'),
            e('select', {
              className: 'dbs-select', value: prov, disabled: working || cfg === undefined,
              onChange: (ev: any) => {
                const v = String(ev.target.value ?? '')
                setProv(v)
                if (v === '' && current !== null) void save(null)
              },
            },
              e('option', { value: '' }, t('settings.model.freeroute')),
              providers.map((g: any) => e('option', { key: g.key, value: g.key }, g.label)))),
          e('div', { className: 'dbs-setrow' }, t('settings.model.pick'),
            e('select', {
              className: 'dbs-select',
              value: prov !== '' && current !== null && provModels.indexOf(current) !== -1 ? current : '',
              disabled: working || cfg === undefined || (prov === '' && !orphan),
              onChange: (ev: any) => {
                const v = String(ev.target.value ?? '')
                if (v !== '') void save(v)
              },
            },
              prov !== ''
                ? e('option', { value: '' }, t('settings.model.pick'))
                : null,
              prov !== ''
                ? provModels.map((m: string) => e('option', { key: m, value: m }, m))
                : (orphan && current !== null ? [e('option', { key: current, value: current }, current)] : []))),
          // What the engine will ACTUALLY run: its launchd env, not the
          // account-default record — the two drifted silently before.
          e('div', { className: 'dbs-setrow' }, t('settings.model.engine'),
            e('b', null, cfg === undefined ? t('settings.reading') : (engineModel ?? t('settings.model.engineUnset')))),
          current !== null && current !== engineModel
            ? e('div', { className: 'dbs-setrow' }, '',
                e('button', {
                  type: 'button', className: 'dbs-btn', disabled: working || rebooted,
                  title: t('settings.model.engineApply'),
                  onClick: () => { void applyEngine(current) },
                }, rebooted ? t('settings.model.engineRestarted')
                  : working ? t('settings.model.engineApplying') : t('settings.model.engineApply')))
            : null,
          cfg?.native !== null && cfg?.native !== undefined
            ? e('div', { className: 'dbs-meta', style: { padding: '0 2px' } },
                (cfg.native.default !== null && cfg.native.default !== undefined
                  ? t('settings.model.nativeDefault', { provider: cfg.native.default.provider, model: cfg.native.default.model })
                  : t('settings.model.native')) + ' · '
                + nativeProviders.map((p: any) => `${p.name}(${p.models.length})`).join('、'))
            : e('div', { className: 'dbs-meta', style: { padding: '0 2px' } }, t('settings.model.nativeMissing')),
          cfg?.freerouteReachable === false
            ? e('div', { className: 'dbs-meta', style: { padding: '0 2px' } }, t('settings.model.offline'))
            : null,
          e('div', { className: 'dbs-meta', style: { padding: '0 2px' } }, t('settings.model.hint')),
          err !== null ? e('div', { className: 'dbs-setrow' }, err) : null)
      }

      /**
       * Global group roster policy — the 成员上限 knob moved out of per-chat
       * settings (0.2.39): one value for every new group and roster edit,
       * stored plugin-side via `groupCap`. Existing rosters are never
       * rewritten behind the user's back (the engine truncates member lists
       * to the cap on write, so a global rewrite would silently kick
       * members out); the cap bites when a group is next created or edited.
       */
      function GroupCard() {
        const [cap, setCap] = React.useState('')
        const [loaded, setLoaded] = React.useState(false)
        const [working, setWorking] = React.useState(false)
        const [err, setErr] = React.useState(null as string | null)
        React.useEffect(() => {
          botsCall<{ max: number }>('groupCap', {})
            .then((r: { max: number }) => { setCap(String(r.max)); setLoaded(true) })
            .catch((e2: any) => { setErr(errText(e2)); setLoaded(true) })
        }, [])
        const n = Math.floor(Number(cap))
        const valid = cap.trim() !== '' && String(n) === cap.trim() && n >= 1 && n <= 16
        async function save() {
          if (working || valid === false) return
          setWorking(true); setErr(null)
          try {
            const r = await botsCall<{ max: number }>('groupCap', { max: n })
            setCap(String(r.max))
          } catch (e2: any) { setErr(errText(e2)) }
          setWorking(false)
        }
        return e('div', { className: 'dbs-setcard' },
          e('div', { className: 'dbs-sethead' },
            e('span', null, t('settings.group.title')),
            e('span', { style: { flex: 1 } }),
            working ? e('span', { className: 'dbs-meta' }, t('settings.model.saving')) : null),
          e('div', { className: 'dbs-setrow' }, t('settings.group.cap'),
            e(Input, {
              value: cap, disabled: working || loaded === false, inputMode: 'numeric', style: { width: 96 },
              onChange: (ev: any) => setCap(ev.target.value),
            }),
            e(Button, {
              variant: 'outline', size: 'sm', disabled: working || valid === false, title: t('action.save'),
              onClick: () => void save(),
            }, t('action.save'))),
          e('div', { className: 'dbs-meta', style: { padding: '0 2px' } }, t('settings.group.capHint')),
          err !== null ? e('div', { className: 'dbs-setrow' }, err) : null)
      }

      function BotsSettings() {
        const [info, setInfo] = React.useState(undefined)
        const [sse, setSse] = React.useState(null)
        const [err, setErr] = React.useState(null)
        const [tab, setTab] = React.useState('overview')
        const tabs = ['overview', 'models', 'skills', 'workspace', 'mcp']
        const tabLabels: Record<string, string> = {
          overview: t('settings.tab.overview'), models: t('settings.tab.models'),
          skills: t('settings.tab.skills'),
          workspace: t('settings.tab.workspace'), mcp: t('settings.tab.mcp'),
        }
        async function refresh() {
          setInfo(undefined); setErr(null)
          try {
            setInfo(await botsCall('gatewayInfo', {}))
            setSse(await botsCall('sseState'))
          } catch (e2: any) { setErr(errText(e2)) }
        }
        React.useEffect(() => { void refresh() }, [])
        const ok = info?.ok === true
        return e('div', { className: 'dbs-settings' },
          e('div', { className: 'dbs-settingsTitle' }, t('nav.bots')),
          e('div', { className: 'dbs-settingsIntro' }, t('settings.summary')),
          e('div', { className: 'dbs-settingsTabs', role: 'tablist', 'aria-label': t('settings.tabs') },
            tabs.map((id: string, index: number) => e('button', {
              key: id, type: 'button', role: 'tab', id: 'dbs-settings-tab-' + id,
              className: 'dbs-settingsTab', 'aria-selected': tab === id,
              'aria-controls': 'dbs-settings-panel-' + id, tabIndex: tab === id ? 0 : -1,
              onClick: () => setTab(id),
              onKeyDown: (ev: any) => {
                const next = ev.key === 'ArrowRight' ? (index + 1) % tabs.length
                  : ev.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
                    : ev.key === 'Home' ? 0 : ev.key === 'End' ? tabs.length - 1 : -1
                if (next < 0) return
                ev.preventDefault()
                setTab(tabs[next])
                document.getElementById('dbs-settings-tab-' + tabs[next])?.focus()
              },
            }, tabLabels[id]))),
          e('div', { id: 'dbs-settings-panel-overview', className: 'dbs-settingsPanel', role: 'tabpanel',
            'aria-labelledby': 'dbs-settings-tab-overview', hidden: tab !== 'overview' },
          e('div', { className: 'dbs-setcard' },
            e('div', { className: 'dbs-sethead' },
              StateDot !== null ? e(StateDot, { state: ok ? 'done' : 'failed', size: 10 }) : null,
              info === undefined ? t('settings.probing') : ok ? t('gateway.online', { port: info.port }) : t('gateway.offline'),
              e('span', { style: { flex: 1 } }),
              e(Button, { variant: 'outline', size: 'sm', onClick: () => void refresh() }, t('action.refresh'))),
            ok ? e('div', null,
              e('div', { className: 'dbs-setrow' }, t('settings.address'), e('b', null, info.baseUrl)),
              e('div', { className: 'dbs-setrow' }, t('settings.pid'), e('b', null, String(info.pid)), ' · ' + (info.health?.isBusy === true ? t('settings.busy') : t('settings.idle'))),
              e('div', { className: 'dbs-setrow' }, t('settings.auth'), e('b', null, info.hasToken === true ? t('settings.auth.token') : t('settings.auth.none')))) : null,
            info !== undefined && !ok ? e('div', { className: 'dbs-setrow' }, t('settings.reason'), e('b', null, info.reason ?? t('settings.reason.unknown'))) : null,
            err !== null ? e('div', { className: 'dbs-setrow' }, err) : null),
          e('div', { className: 'dbs-setcard' },
            e('div', { className: 'dbs-setrow' }, t('settings.dataDir'), e('b', null, info?.dataDir ?? t('settings.reading'))),
            info?.workspaceRoot
              ? e('div', { className: 'dbs-setrow' }, t('settings.workspaceRoot'), e('b', null, info.workspaceRoot))
              : null,
            e('div', { className: 'dbs-setrow' }, t('settings.events'),
              e('b', null, sse?.running === true ? t('settings.events.on', { n: sse.buffered ?? 0 }) : t('settings.events.off')),
              sse?.lastError ? ' · ' + String(sse.lastError) : ''),
            e('div', { className: 'dbs-setrow' }, t('settings.entry'), e('b', null, t('settings.entry.value')))),
          info?.ok === true ? e(GroupCard) : null),
          e('div', { id: 'dbs-settings-panel-models', className: 'dbs-settingsPanel', role: 'tabpanel',
            'aria-labelledby': 'dbs-settings-tab-models', hidden: tab !== 'models' },
            info?.ok === true ? e(ModelCard) : null),
          e('div', { id: 'dbs-settings-panel-skills', className: 'dbs-settingsPanel', role: 'tabpanel',
            'aria-labelledby': 'dbs-settings-tab-skills', hidden: tab !== 'skills' },
            info?.ok === true ? e(SkillsCard) : null),
          e('div', { id: 'dbs-settings-panel-workspace', className: 'dbs-settingsPanel', role: 'tabpanel',
            'aria-labelledby': 'dbs-settings-tab-workspace', hidden: tab !== 'workspace' },
            info?.ok === true ? e(WorkspaceCard) : null),
          e('div', { id: 'dbs-settings-panel-mcp', className: 'dbs-settingsPanel', role: 'tabpanel',
            'aria-labelledby': 'dbs-settings-tab-mcp', hidden: tab !== 'mcp' },
            info?.ok === true ? e(McpCard) : null))
      }

      // =========================================================
      // Overlay root: hosts the chat surface only.
      // =========================================================
      /**
       * Create dialog ("新建 Bot" / "新建群聊") as a system-style modal:
       * fixed backdrop + centred card rendered from shell.overlay, matching
       * the wfx main-window modal parameters (rgba(0,0,0,.45), bg-layer-1,
       * 14px radius, entrance animation). ESC and backdrop clicks dismiss.
       */
      function CreateModal() {
        const s = useStore()
        const [err, setErr] = React.useState(null as string | null)
        const isGroup = s.create === 'group'
        const singles = (s.agents as any[]).filter((a: any) => !a.isGroup && a.isHiddenFromSidebar !== true)
        const picked = Object.keys(s.createMembers).filter((k) => s.createMembers[k])
        const nameOk = s.createName.trim() !== ''
        const valid = nameOk && (!isGroup || picked.length > 0)

        async function submit() {
          if (!valid || s.createWorking) return
          patch({ createWorking: true, error: null }); setErr(null)
          try {
            if (isGroup) await botsCall('createGroup', { name: s.createName.trim(), memberIds: picked })
            else await botsCall('create', { name: s.createName.trim(), description: s.createDesc.trim() })
            patch({ create: null, createName: '', createDesc: '', createMembers: {}, createWorking: false })
            await refreshAgents()
            return
          } catch (e2: any) { setErr(errText(e2)) }
          patch({ createWorking: false })
        }

        return e('div', {
          className: 'dbs-modalBackdrop',
          onClick: () => { if (!s.createWorking) patch({ create: null }) },
        },
          e('div', {
            className: 'dbs-modalCard', role: 'dialog', 'aria-modal': true,
            'aria-label': isGroup ? t('group.new') : t('bot.new'),
            onClick: (ev: any) => { ev.stopPropagation() },
          },
            e('div', { className: 'dbs-modalTitleRow' },
              e('span', { className: 'dbs-modalTitle' }, isGroup ? t('group.new') : t('bot.new')),
              e(Button, {
                variant: 'ghost', size: 'sm', title: t('action.close'), 'aria-label': t('action.close'),
                disabled: s.createWorking,
                icon: Ico('IconCloseOutline16', { size: 16 }),
                onClick: () => patch({ create: null }),
              })),
            e('div', { className: 'dbs-modalBody' },
              e(Input, {
                placeholder: isGroup ? t('group.namePlaceholder') : t('bot.namePlaceholder'),
                value: s.createName, autoFocus: true, disabled: s.createWorking,
                onChange: (ev: any) => patch({ createName: ev.target.value }),
                onKeyDown: (ev: any) => { if (ev.key === 'Enter') { ev.preventDefault(); void submit() } },
              }),
              !isGroup
                ? e(Input, {
                    placeholder: t('bot.descPlaceholder'), value: s.createDesc, disabled: s.createWorking,
                    onChange: (ev: any) => patch({ createDesc: ev.target.value }),
                  })
                : e('div', { className: 'dbs-modalMembers' },
                    singles.length === 0
                      ? e('div', { className: 'dbs-meta', style: { padding: '4px 6px' } }, t('list.loading'))
                      : singles.map((m: any) => e('div', {
                          key: m.id,
                          className: 'dbs-member' + (s.createMembers[m.id] ? ' checked' : ''),
                          style: { cursor: 'pointer', padding: '4px 6px', borderRadius: 8 },
                          onClick: () => patch({ createMembers: { ...s.createMembers, [m.id]: !s.createMembers[m.id] } }),
                        }, e('input', { type: 'checkbox', checked: Boolean(s.createMembers[m.id]), readOnly: true }),
                          e(Avatar, { agent: m, size: 18 }),
                          e('span', { className: 'dbs-title' }, m.name))),
                    isGroup && singles.length > 0
                      ? e('div', { className: 'dbs-meta', style: { padding: '6px 6px 0' } },
                          t('chat.group', { n: picked.length }))
                      : null),
              err !== null
                ? e('div', { className: 'dbs-error', onClick: () => { setErr(null) } }, err)
                : null),
            e('div', { className: 'dbs-modalFooter' },
              e(Button, {
                variant: 'ghost', size: 'sm', disabled: s.createWorking,
                onClick: () => patch({ create: null }),
              }, t('action.cancel')),
              e(Button, {
                variant: 'primary', size: 'sm', disabled: !valid || s.createWorking,
                onClick: () => void submit(),
              }, t('action.create')))))
      }

      /**
       * Manage group members: full-set checkbox editor over the group's
       * current memberIds — add and remove are the same save (the gateway
       * command is a member-list put, not a delta). Same dialog chrome and
       * member-row markup as CreateModal.
       */
      function ManageMembersModal() {
        const s = useStore()
        const group = agentById(s.manageMembers)
        const [picked, setPicked] = React.useState(null as Record<string, boolean> | null)
        const [err, setErr] = React.useState(null as string | null)
        const [working, setWorking] = React.useState(false)
        // The roster ceiling is the GLOBAL Bots-setting value; the group's own
        // stored cap only stands in until the fetch resolves.
        const [cap, setCap] = React.useState(null as number | null)

        // Seed once per opened group; a group vanishing mid-edit (deleted by
        // the swarm, say) just renders the modal inert until closed.
        React.useEffect(() => {
          if (group === null || group === undefined) return
          const init: Record<string, boolean> = {}
          for (const id of group.memberIds ?? []) init[id] = true
          setPicked(init)
          botsCall<{ max: number }>('groupCap', {}).then((r: { max: number }) => setCap(r.max)).catch(() => {})
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [s.manageMembers])

        if (group === null || group === undefined) return null
        const singles = (s.agents as any[]).filter((a: any) => !a.isGroup && a.isHiddenFromSidebar !== true)
        const pickedIds = picked === null ? [] : Object.keys(picked).filter((k) => picked[k])
        // Per-group cap (group.json maxMembers, engine hard max 16). The glue
        // slice(0, maxMembers)-truncates the roster SILENTLY, so an over-cap
        // pick is blocked here — the ceiling itself is the global Bots
        // setting (edited in Settings → Bots → 群聊).
        const MEMBER_CAP = cap ?? group.maxMembers ?? 8
        const overCap = pickedIds.length > MEMBER_CAP

        function toggle(id: string): void {
          if (picked === null) return
          if (picked[id] !== true && pickedIds.length >= MEMBER_CAP) {
            setErr(t('chat.members.cap', { cap: MEMBER_CAP }))
            return
          }
          setErr(null)
          setPicked({ ...picked, [id]: !picked[id] })
        }

        async function submit() {
          if (working || picked === null || overCap) return
          setWorking(true); setErr(null)
          try {
            await botsCall('setGroupMembers', { id: group.id, memberIds: pickedIds })
            patch({ manageMembers: null })
            await refreshAgents()
            return
          } catch (e2: any) { setErr(errText(e2)) }
          setWorking(false)
        }

        return e('div', {
          className: 'dbs-modalBackdrop',
          onClick: () => { if (!working) patch({ manageMembers: null }) },
        },
          e('div', {
            className: 'dbs-modalCard', role: 'dialog', 'aria-modal': true,
            'aria-label': t('modal.members.title'),
            onClick: (ev: any) => { ev.stopPropagation() },
          },
            e('div', { className: 'dbs-modalTitleRow' },
              e('span', { className: 'dbs-modalTitle' }, t('modal.members.title')),
              e(Button, {
                variant: 'ghost', size: 'sm', title: t('action.close'), 'aria-label': t('action.close'),
                disabled: working,
                icon: Ico('IconCloseOutline16', { size: 16 }),
                onClick: () => patch({ manageMembers: null }),
              })),
            e('div', { className: 'dbs-modalBody' },
              e('div', { className: 'dbs-meta', style: { padding: '0 2px 6px' } }, t('modal.members.hint')),
              picked === null
                ? e('div', { className: 'dbs-meta', style: { padding: '4px 6px' } }, t('list.loading'))
                : e('div', { className: 'dbs-modalMembers' },
                    singles.length === 0
                      ? e('div', { className: 'dbs-meta', style: { padding: '4px 6px' } }, t('modal.members.empty'))
                      : singles.map((m: any) => e('div', {
                          key: m.id,
                          className: 'dbs-member' + (picked[m.id] ? ' checked' : ''),
                          style: { cursor: 'pointer', padding: '4px 6px', borderRadius: 8 },
                          onClick: () => toggle(m.id),
                        }, e('input', { type: 'checkbox', checked: Boolean(picked[m.id]), readOnly: true }),
                          e(Avatar, { agent: m, size: 18 }),
                          e('span', { className: 'dbs-title' }, m.name))),
                    singles.length > 0
                      ? e('div', { className: 'dbs-meta', style: { padding: '6px 6px 0' } },
                          t('chat.group', { n: pickedIds.length }) + ' / ' + String(MEMBER_CAP))
                      : null),
              err !== null
                ? e('div', { className: 'dbs-error', onClick: () => { setErr(null) } }, err)
                : null),
            e('div', { className: 'dbs-modalFooter' },
              e(Button, {
                variant: 'ghost', size: 'sm', disabled: working,
                onClick: () => patch({ manageMembers: null }),
              }, t('action.cancel')),
              e(Button, {
                variant: 'primary', size: 'sm', disabled: picked === null || working || overCap,
                onClick: () => void submit(),
              }, working ? t('action.saving') : t('action.save')))))
      }

      /**
       * Per-session settings: name (+ description) for every chat; singles
       * additionally get the §14 workspace-jail editor (root + extra writable
       * paths). updateAgent merges only the name/description/title/avatar
       * fields engine-side, so saving cannot clobber the rest of a profile;
       * an empty root removes the jail (workspaceRoot: null).
       */
      function AgentSettingsModal() {
        const s = useStore()
        const agent = agentById(s.settingsAgentId)
        const isGroup = agent?.isGroup === true
        const [name, setName] = React.useState('')
        const [desc, setDesc] = React.useState('')
        const [root, setRoot] = React.useState('')
        const [paths, setPaths] = React.useState('')
        const [wsLoaded, setWsLoaded] = React.useState(false)
        const [working, setWorking] = React.useState(false)
        const [err, setErr] = React.useState(null as string | null)

        React.useEffect(() => {
          if (agent === null || agent === undefined) return
          setName(String(agent.name ?? ''))
          setDesc(String(agent.description ?? ''))
          if (agent.isGroup === true) { setWsLoaded(true); return }
          let alive = true
          botsCall<{ workspaceRoot: string | null; allowPaths?: string[] }>('workspaceGet', { agentId: agent.id })
            .then((c: { workspaceRoot: string | null; allowPaths?: string[] }) => {
              if (alive === false) return
              setRoot(c.workspaceRoot ?? '')
              setPaths((c.allowPaths ?? []).join(', '))
              setWsLoaded(true)
            })
            .catch(() => { if (alive) setWsLoaded(true) })
          return () => { alive = false }
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [s.settingsAgentId])

        if (agent === null || agent === undefined) return null
        const valid = name.trim() !== ''

        async function save() {
          if (working || valid === false) return
          setWorking(true); setErr(null)
          try {
            await botsCall('update', { id: agent.id, profile: { name: name.trim(), description: desc.trim() } })
            if (agent.isGroup !== true && wsLoaded === true) {
              const list = paths.split(/[,,]/).map((x: string) => x.trim()).filter((x: string) => x !== '')
              await botsCall('workspaceSet', {
                agentId: agent.id,
                workspaceRoot: root.trim() === '' ? null : root.trim(),
                allowPaths: list,
              })
            }
            patch({ settingsAgentId: null })
            await refreshAgents()
            return
          } catch (e2: any) { setErr(errText(e2)) }
          setWorking(false)
        }

        return e('div', {
          className: 'dbs-modalBackdrop',
          onClick: () => { if (working === false) patch({ settingsAgentId: null }) },
        },
          e('div', {
            className: 'dbs-modalCard', role: 'dialog', 'aria-modal': true,
            'aria-label': t('chat.settings.title'),
            onClick: (ev: any) => { ev.stopPropagation() },
          },
            e('div', { className: 'dbs-modalTitleRow' },
              e('span', { className: 'dbs-modalTitle' }, t('chat.settings.title')),
              e(Button, {
                variant: 'ghost', size: 'sm', title: t('action.close'), 'aria-label': t('action.close'),
                disabled: working,
                icon: Ico('IconCloseOutline16', { size: 16 }),
                onClick: () => patch({ settingsAgentId: null }),
              })),
            e('div', { className: 'dbs-modalBody' },
              e('div', { className: 'dbs-setLabel' }, t('chat.settings.name')),
              e(Input, {
                value: name, autoFocus: true, disabled: working,
                onChange: (ev: any) => setName(ev.target.value),
              }),
              isGroup === false
                ? e('div', null,
                    e('div', { className: 'dbs-setLabel' }, t('chat.settings.desc')),
                    e(Input, {
                      value: desc, disabled: working,
                      onChange: (ev: any) => setDesc(ev.target.value),
                    }),
                    e('div', { className: 'dbs-setLabel', style: { marginTop: 12, fontWeight: 600 } }, t('chat.settings.workspace')),
                    e('div', { className: 'dbs-setLabel' }, t('chat.settings.root')),
                    e(Input, {
                      value: root, disabled: working || wsLoaded === false,
                      placeholder: t('chat.settings.rootPh'),
                      onChange: (ev: any) => setRoot(ev.target.value),
                    }),
                    e('div', { className: 'dbs-setLabel' }, t('chat.settings.paths')),
                    e(Input, {
                      value: paths, disabled: working || wsLoaded === false,
                      placeholder: t('chat.settings.pathsPh'),
                      onChange: (ev: any) => setPaths(ev.target.value),
                    }),
                    e('div', { className: 'dbs-meta', style: { marginTop: 8 } }, t('chat.settings.hint')))
                : null,
              err !== null
                ? e('div', { className: 'dbs-error', onClick: () => { setErr(null) } }, err)
                : null),
            e('div', { className: 'dbs-modalFooter' },
              e(Button, {
                variant: 'ghost', size: 'sm', disabled: working,
                onClick: () => patch({ settingsAgentId: null }),
              }, t('action.cancel')),
              e(Button, {
                variant: 'primary', size: 'sm', disabled: valid === false || working,
                onClick: () => void save(),
              }, working === true ? t('action.saving') : t('action.save')))))
      }

      /** Delete confirmation modal: same system-dialog chrome as CreateModal. */
      function ConfirmDeleteModal() {
        const s = useStore()
        const target = s.confirmDelete
        const [err, setErr] = React.useState(null as string | null)
        const [working, setWorking] = React.useState(false)
        const isGroup = target?.isGroup === true

        async function doDelete() {
          if (target === null || target === undefined || working) return
          setWorking(true); setErr(null)
          try {
            await botsCall('remove', { id: target.id })
            // The chat for a deleted bot must not survive its bot.
            const closeChat = state.chatAgentId === target.id
            patch({ confirmDelete: null })
            if (closeChat) patch({ chatAgentId: null })
            await refreshAgents()
            return
          } catch (e2: any) { setErr(errText(e2)) }
          setWorking(false)
        }

        return e('div', {
          className: 'dbs-modalBackdrop',
          onClick: () => { if (!working) patch({ confirmDelete: null }) },
        },
          e('div', {
            className: 'dbs-modalCard dbs-modalNarrow', role: 'dialog', 'aria-modal': true,
            'aria-label': isGroup ? t('delete.title.group') : t('delete.title.bot'),
            onClick: (ev: any) => { ev.stopPropagation() },
          },
            e('div', { className: 'dbs-modalBody' },
              e('div', { className: 'dbs-confirmText' },
                t('delete.confirm', { name: target?.name ?? '' })),
              err !== null
                ? e('div', { className: 'dbs-error', onClick: () => { setErr(null) } }, err)
                : null),
            e('div', { className: 'dbs-modalFooter' },
              e(Button, {
                variant: 'ghost', size: 'sm', disabled: working,
                onClick: () => patch({ confirmDelete: null }),
              }, t('action.cancel')),
              e(Button, {
                variant: 'primary', size: 'sm', disabled: working,
                onClick: () => void doDelete(),
              }, working ? t('delete.working') : t('action.delete')))))
      }

      function BotsMain() {
        const s = useStore()
        return s.chatAgentId === null
          ? e('div', { className: 'dbs-welcome' }, t('goal.chooseBot'))
          : e(ChatView, { agentId: s.chatAgentId, key: s.chatAgentId })
      }

      function BotsLayer() {
        const s = useStore()
        React.useEffect(() => {
          function onKey(ev: KeyboardEvent) {
            if (ev.key !== 'Escape') return
            // Escape dismisses transient UI; native panel navigation stays intact.
            if (state.rowMenu !== null) { patch({ rowMenu: null }); return }
            if (state.confirmDelete !== null) { patch({ confirmDelete: null }); return }
            if (state.create !== null) { patch({ create: null }); return }
            if (state.manageMembers !== null) { patch({ manageMembers: null }); return }
            if (state.settingsAgentId !== null) patch({ settingsAgentId: null })
          }
          window.addEventListener('keydown', onKey)
          return () => { window.removeEventListener('keydown', onKey) }
        }, [])
        const layers: any[] = []
        if (s.create !== null) layers.push(e(CreateModal, { key: 'create' }))
        if (s.manageMembers !== null) layers.push(e(ManageMembersModal, { key: 'manage-members' }))
        if (s.settingsAgentId !== null) layers.push(e(AgentSettingsModal, { key: 'agent-settings' }))
        if (s.confirmDelete !== null) layers.push(e(ConfirmDeleteModal, { key: 'confirm-delete' }))
        return layers.length === 0 ? null : e('div', null, layers)
      }

      // =========================================================
      // Slot registration (formal runtime contract).
      // =========================================================
      const inject = ['connection', 'slots', 'locale', 'layout']

      function apply(c: any): void {
        ctx = c
        connectionSvc = c.get('connection')
        slotsSvc = c.get('slots')
        layoutSvc = c.get('layout')
        const slots = slotsSvc
        if (slots === undefined || slots === null) return

        c.effect(() => {
          const styleEl = document.createElement('style')
          styleEl.setAttribute('data-dsh-plugin', 'dsh-bots')
          styleEl.textContent = CSS
          document.head.appendChild(styleEl)
          return () => { styleEl.remove() }
        }, 'dsh-bots: styles')

        // Dictionaries first: a slot may render on the same tick it registers.
        const locale = c.get('locale')
        if (locale !== undefined && locale !== null) {
          c.effect(() => locale.register(NS, { zh, en }), 'dsh-bots: dictionaries')
          boundT = locale.bind(NS)
          // Our surfaces read `t` from module scope rather than from the prop
          // the renderer hands the slot root, because the strings live six
          // components deep. That means a language switch has to be pushed
          // into our own store to re-render them.
          c.effect(() => locale.subscribe(() => { patch({ localeRev: state.localeRev + 1 }) }), 'dsh-bots: locale refresh')
        }

        c.effect(() => slots.inject('main', () => slots.register(
          { name: 'main', key: 'dsh-bots', registrant: 'dsh-bots', locale: NS },
          () => e(BotsMain),
        )), 'dsh-bots: main panel')

        c.effect(() => slots.inject('shell.overlay', () => slots.register(
          { name: 'shell.overlay', id: 'dsh-bots.chat', order: 20, registrant: 'dsh-bots', locale: NS },
          () => e(BotsLayer),
        )), 'dsh-bots: dialogs')

        // Shadow the single workspace slot at a lower priority (lowest renders);
        // the shipped entry stays registered and is delegated to by name.
        c.effect(() => slots.inject('sidebar.workspaces', () => slots.register(
          { name: 'sidebar.workspaces', priority: -100, registrant: 'dsh-bots', locale: NS },
          // Forward the full shell kit (standard hooks + owner props) so the
          // delegated shipped workspace browser can receive the hooks it needs
          // after the dsh upgrade dropped them from hostFace().
          (props: any) => e(SidebarNav, props),
        )), 'dsh-bots: sidebar workspaces shadow')

        c.effect(() => slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'bots', order: 40, label: () => t('nav.bots'), registrant: 'dsh-bots', locale: NS },
          () => e(BotsSettings),
        )), 'dsh-bots: settings section')

        reportDiag('apply', { slots: ['main', 'shell.overlay', 'sidebar.workspaces', 'settings.section'] })
      }

      exports.apply = apply
      exports.inject = inject
      return module.exports
    },
  })
})()
