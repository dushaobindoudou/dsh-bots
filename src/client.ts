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
 * Chat lives in the `shell.overlay` layer but is inset to the frame's centre
 * column, so the sidebar stays visible and usable while a bot conversation is
 * open — matching how a native session behaves.
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
        const C = NATIVE[name]
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
          e('rect', { x: 3, y: 3, width: 10, height: 10, rx: 2.5, fill: 'currentColor' }))
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
.dbs-botsBody{overflow-y:auto;scrollbar-gutter:stable;padding-right:var(--dsh-sidebar-inline-padding,8px)}
.dbs-navBodyErr{padding:6px 12px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
/* Hover actions RESERVE their space (visibility/opacity swap, not
   display:none): a display toggle let the appearing buttons stretch the
   row on hover and shrink it on leave — width/height jitter the user read
   as flicker. Fixed 30px row + always-laid-out actions = zero geometry
   change; the same trick the native headerActions uses (max-width/opacity). */
.dbs-secHead{position:relative;cursor:pointer;border-radius:8px;height:30px}
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
.dbs-secMenu{position:absolute;top:100%;right:0;z-index:40;min-width:148px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:4px;box-shadow:0 12px 40px rgba(0,0,0,.22);animation:dbs-modal-in .14s ease-out}
.dbs-secMenuItem{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border-radius:8px;font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary);cursor:pointer;background:none;border:none;text-align:left}
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
.dbs-rowActions{flex:none;align-items:center;gap:4px;display:none}
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
.dbs-unhideAll:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dbs-railBtn{width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0}
.dbs-railBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dbs-railBtn[data-active="true"]{color:var(--dsw-alias-state-business-primary)}
.dbs-rail{display:flex;flex-direction:column;align-items:center;gap:2px}
.dbs-railWrap{display:flex;flex-direction:column;min-height:0;flex:1;gap:2px}
.dbs-form{display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:8px;margin:2px 0;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.2))}
.dbs-formRow{display:flex;gap:6px;align-items:center}
.dbs-members{display:flex;flex-direction:column;gap:2px;max-height:150px;overflow-y:auto}
.dbs-member{display:flex;align-items:center;gap:6px;font-size:13px;line-height:20px;padding:3px 6px;border-radius:6px;color:var(--dsw-alias-label-primary);cursor:pointer}
.dbs-member:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dbs-member.checked{color:var(--dsw-alias-state-business-primary,#1a6dff)}
.dbs-error{margin:4px 8px;padding:5px 9px;border-radius:8px;font-size:12px;line-height:18px;cursor:pointer;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-error-primary,#f85149)}

.dbs-chatview{position:absolute;top:0;bottom:0;pointer-events:auto;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);font-family:var(--dsw-font-family,inherit);z-index:2;--dsh-chat-content-width:748px;--dsh-composer-card-max-width:calc(var(--dsh-chat-content-width) + 32px);--dsh-composer-side-clearance:16px;--dsh-composer-dock-inset:8px;--dsh-composer-text-max-height:336px;min-width:0}
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
.dbs-scroll{min-height:0;padding:16px calc(var(--dsh-composer-side-clearance) + 16px);flex:auto}
.dbs-column{max-width:var(--dsh-chat-content-width);flex-direction:column;gap:16px;width:100%;margin:0 auto;display:flex}
.dbs-userRow{flex-direction:column;align-items:flex-end;gap:6px;display:flex}
.dbs-userStack{flex-direction:column;align-items:flex-end;gap:8px;min-width:0;max-width:min(525px,82%);display:flex}
.dbs-bubble{background:var(--dsw-specific-bubble);max-width:100%;color:var(--dsw-alias-label-primary);border-radius:22px;padding:10px 16px;font-size:16px;line-height:24px;box-sizing:border-box}
.dbs-botRow{color:var(--dsw-alias-label-primary);flex-direction:column;font-size:16px;line-height:28px;display:flex;align-items:flex-start;gap:4px;width:100%;box-sizing:border-box}
.dbs-author{font-size:14px;line-height:22px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:3px;flex-wrap:wrap}
.dbs-authorName{font-weight:600;letter-spacing:.2px}
.dbs-md{min-width:0}
.dbs-md p{margin:0 0 8px}
.dbs-md p:last-child{margin-bottom:0}
.dbs-md h1,.dbs-md h2,.dbs-md h3,.dbs-md h4{margin:12px 0 6px;line-height:1.35;font-weight:600}
.dbs-md h1{font-size:20px}.dbs-md h2{font-size:18px}.dbs-md h3{font-size:16px}.dbs-md h4{font-size:15px}
.dbs-md ul,.dbs-md ol{margin:0 0 8px;padding-left:22px}
.dbs-md li{margin:2px 0}
.dbs-md code{font-family:var(--dsw-font-family-mono,ui-monospace,monospace);font-size:.9em;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));border-radius:6px;padding:1px 5px}
.dbs-md pre{margin:0 0 8px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:10px;padding:10px 12px;overflow-x:auto}
.dbs-md .dbs-imglink{display:inline-block;max-width:min(320px,100%);border-radius:10px;overflow:hidden;margin:4px 0;box-shadow:0 1px 4px rgba(0,0,0,.25);cursor:zoom-in}
.dbs-md .dbs-imglink img{display:block;width:100%;height:auto}
.dbs-md pre code{background:transparent;padding:0;font-size:.9em}
.dbs-md blockquote{margin:0 0 8px;padding:2px 0 2px 10px;border-left:3px solid var(--dsw-alias-border-l2,rgba(0,0,0,.2));color:var(--dsw-alias-label-secondary)}
.dbs-md a{color:var(--dsw-alias-state-business-primary,#1a6dff)}
.dbs-md hr{border:none;border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.15));margin:10px 0}
.dbs-plain{white-space:pre-wrap;word-break:break-word}
.dbs-toolCard{border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));background:var(--dsw-specific-bubble);border-radius:12px;padding:8px 12px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);width:100%;box-sizing:border-box}
.dbs-toolHdr{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.dbs-toolName{font:var(--dsw-font-markdown-code-block-small,inherit);font-size:13px}
.dbs-toolBody{margin-top:4px;white-space:pre-wrap;word-break:break-word;max-height:190px;overflow:auto;color:var(--dsw-alias-label-tertiary)}
.dbs-thinking{color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:22px;white-space:pre-wrap;word-break:break-word;border-left:2px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));padding-left:10px}
.dbs-msgTime{flex:none;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;user-select:none;white-space:nowrap}
.dbs-userRow .dbs-msgTime,.dbs-botRow .dbs-msgTime{padding:0 4px}
.dbs-toolTrail{margin-left:auto;flex:none;display:inline-flex;align-items:center;gap:8px}
.dbs-dayDivider{display:flex;align-items:center;justify-content:center}
.dbs-dayDivider span{padding:2px 10px;border-radius:999px;background:var(--dsw-specific-bubble);color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;user-select:none}
.dbs-turnStatus{height:26px;font-size:14px;font-weight:600;white-space:nowrap;background:linear-gradient(90deg,var(--dsw-static-deepseek-500,#4d6bfe) 0%,var(--dsw-static-deepseek-500,#4d6bfe) 40%,var(--dsw-static-deepseek-200,#b6c2ff) 50%,var(--dsw-static-deepseek-500,#4d6bfe) 60%,var(--dsw-static-deepseek-500,#4d6bfe) 100%);color:#0000;-webkit-text-fill-color:transparent;background-position:100% 0;background-size:250% 100%;-webkit-background-clip:text;background-clip:text;flex:none;align-self:flex-start;align-items:center;animation:1.8s linear infinite dbs-turn-status-shimmer;display:inline-flex}
@keyframes dbs-turn-status-shimmer{to{background-position:0 0}}
@media (prefers-reduced-motion:reduce){.dbs-turnStatus{background-position:0 0;background-size:100% 100%;animation:none}.dbs-arrow{transition:none}}
.dbs-composerSeat{flex:none;display:flex;flex-direction:column;z-index:7;background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-bg-base) 0%,transparent) 0px,var(--dsw-alias-bg-base) 36px)}
.dbs-composer{padding:12px var(--dsh-composer-side-clearance) 10px;flex-direction:column;align-items:center;display:flex}
.dbs-composerCard{cursor:text;box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width);border:1px solid var(--dsw-alias-border-l2-darkmode-thin,rgba(0,0,0,.12));background:var(--dsw-specific-input-major);box-shadow:var(--dsw-shadow-lv2);border-radius:22px;flex-direction:column;gap:12px;padding-top:10px;font-size:16px;line-height:24px;display:flex;position:relative}
.dbs-composerScroll{max-height:var(--dsh-composer-text-max-height);overflow-y:auto}
.dbs-composerRow{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;min-width:0;padding:2px 8px 6px;display:flex}
.dbs-composerTrailing{align-items:center;min-width:0;display:flex;flex:none;gap:8px;margin-left:auto}
.dbs-composerInput{resize:none;width:100%;box-sizing:border-box;border:none;outline:none;background:transparent;font-family:var(--dsw-font-family);font-size:16px;line-height:24px;white-space:pre-wrap;word-break:break-word;padding:4px 12px 0 16px;min-height:52px;color:var(--dsw-alias-label-primary)}
.dbs-composerInput::placeholder{color:var(--dsw-alias-label-caption);user-select:none}
.dbs-send{background:var(--dsw-alias-button-info-fill,#1a6dff);color:#fff;cursor:pointer;border:none;border-radius:999px;flex:none;place-items:center;width:34px;height:34px;transition:background-color .1s,filter .1s;display:grid}
.dbs-send:disabled{opacity:.4;cursor:default}
.dbs-send.dbs-stop:hover:not(:disabled){filter:brightness(.9)}
.dbs-typingStop{display:inline-flex;align-items:center;gap:4px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:12px;line-height:16px;padding:2px 8px;border-radius:999px}
.dbs-typingStop:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dbs-typingStop:disabled{opacity:.4;cursor:default}
.dbs-modalBackdrop{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:24px;pointer-events:auto}
.dbs-modalCard{position:relative;width:min(440px,92vw);max-height:88vh;overflow-y:auto;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:18px 20px 22px;box-shadow:0 24px 80px rgba(0,0,0,.3);animation:dbs-modal-in .18s ease-out}
/* Confirm-class dialogs carry one sentence, not a form: 440px reads as a
   billboard. Native confirms sit ~340-360px, so the delete dialog narrows —
   and drops the form chrome entirely: no title bar, no close X, uniform
   padding. The message IS the dialog (Escape/backdrop still dismiss). */
.dbs-modalCard.dbs-modalNarrow{width:min(360px,92vw);padding:20px}
.dbs-confirmText{font-size:15px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary)}
@keyframes dbs-modal-in{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}
.dbs-modalTitleRow{display:flex;align-items:center;gap:8px;margin-bottom:14px}
.dbs-modalTitle{font-size:16px;line-height:24px;font-weight:600;color:var(--dsw-alias-label-primary);flex:1;min-width:0}
.dbs-modalBody{display:flex;flex-direction:column;gap:10px}
.dbs-modalMembers{display:flex;flex-direction:column;gap:2px;max-height:220px;overflow-y:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:6px}
.dbs-modalFooter{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:16px}
.dbs-rowMore{display:none;border:none;background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;width:24px;height:24px;border-radius:6px;padding:0}
.dbs-rowMore:hover,.dbs-rowMore:focus-visible{color:var(--dsw-alias-label-primary);background:transparent}
.dbs-srow:hover .dbs-rowMore,.dbs-rowMore:focus-visible,.dbs-srow[data-menu="true"] .dbs-rowMore{display:inline-flex}
.dbs-srow{position:relative}
.dbs-rowMenu{position:absolute;top:calc(100% - 2px);right:4px;z-index:40}
.dbs-rowMenu.dbs-flipUp{top:auto;bottom:calc(100% + 2px)}
/* Same quiet-hover contract for the section-header action buttons. */
.dbs-secHead .dbs-rowActions button:hover,.dbs-secHead .dbs-rowActions button:focus-visible{background:transparent}
.dbs-mention{position:absolute;bottom:calc(100% + 6px);left:12px;right:12px;max-height:180px;overflow-y:auto;background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:12px;box-shadow:var(--dsw-shadow-lv2);padding:4px;z-index:3}
.dbs-mentionRow{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.dbs-mentionRow[data-active="true"],.dbs-mentionRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dbs-empty{color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:22px;text-align:center;padding:32px 0}
.dbs-scrollArea{position:relative;flex:1;min-height:0;display:flex;flex-direction:column}
.dbs-scrollBody::-webkit-scrollbar{width:10px}
.dbs-scrollBody::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,rgba(0,0,0,.18));border-radius:5px;border:3px solid transparent;background-clip:content-box}
.dbs-scrollBody::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-label-caption,var(--dsw-alias-border-l2,rgba(0,0,0,.25)));border:3px solid transparent;background-clip:content-box}
.dbs-scrollBody::-webkit-scrollbar-track{background:transparent}
.dbs-jump{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-1,#fff));box-shadow:var(--dsw-shadow-lv2);color:var(--dsw-alias-label-secondary);cursor:pointer;z-index:5;transition:opacity .15s ease,transform .15s ease}
.dbs-jump:hover{color:var(--dsw-alias-label-primary);transform:translate(-50%,-1px)}
.dbs-jump[data-show="false"]{opacity:0;pointer-events:none;transform:translate(-50%,4px)}
/* Loading states aligned with the native shell: StateDot chase icon where
   available (the real native component), pulse-dot fallback in DeepSeek blue
   at the native 1s cycle; media spinner reuses the native 0.8s linear spin. */
.dbs-typing{display:inline-flex;align-items:center;gap:6px;padding:6px 2px}
.dbs-typingText{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.dbs-typingDot{width:12px;height:12px;border-radius:999px;background:var(--dsw-static-deepseek-450,var(--dsw-alias-label-tertiary));animation:dbsPulse 1s ease-in-out infinite}
@keyframes dbsPulse{0%,100%{opacity:.2}50%{opacity:1}}
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
.dbs-composerCard:focus-within{border-color:var(--dsw-alias-state-business-primary,#1a6dff)}

.dbs-settings{padding:4px 0 24px;max-width:640px;font-family:var(--dsw-font-family,inherit)}
.dbs-setcard{border:1px solid var(--dsw-alias-border-l,rgba(0,0,0,.12));border-radius:12px;padding:14px 16px;margin-top:14px}
.dbs-setrow{display:flex;align-items:center;gap:8px;font-size:13px;line-height:22px;color:var(--dsw-alias-label-secondary);padding:3px 0}
.dbs-setrow b{color:var(--dsw-alias-label-primary);font-weight:600;word-break:break-all}
.dbs-sethead{display:flex;align-items:center;gap:8px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);font-weight:600}
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
        'action.expand': '展开',
        'action.collapse': '收起',
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
        'chat.composing': '生成中',
        'chat.queuedSend': '排队发送（当前回合结束后送达）',
        'chat.placeholder.group': '@名字 可定向，默认全员',
        'chat.placeholder.single': '给 {name} 发消息…',
        'chat.charCount': '{n} 字',
        'time.today': '今天',
        'time.yesterday': '昨天',
        'time.date': '{m} 月 {d} 日',
        'time.dateFull': '{y} 年 {m} 月 {d} 日',
        'tool.fallbackName': '工具',
        'settings.summary': '多 Bot 工作台，桥接 sdk-bots 编排网关。',
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
        'settings.model.hint': '不选择时默认使用 freeroute 自动路由；freeroute 不可用时使用当前默认模型。选择具体模型会写入账号默认模型，重启引擎后仍生效。',
        'settings.model.offline': 'freeroute 不可达——已回退当前默认模型',
        'settings.model.saving': '保存中…',
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
        'action.expand': 'Expand',
        'action.collapse': 'Collapse',
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
        'chat.composing': 'Generating',
        'chat.queuedSend': 'Queue send (delivered after the current turn)',
        'chat.placeholder.group': 'Use @name to direct a turn; everyone by default',
        'chat.placeholder.single': 'Message {name}…',
        'chat.charCount': '{n} chars',
        'time.today': 'Today',
        'time.yesterday': 'Yesterday',
        'time.date': '{m}/{d}',
        'time.dateFull': '{y}/{m}/{d}',
        'tool.fallbackName': 'Tool',
        'settings.summary': 'Multi-bot workbench, bridged to the sdk-bots orchestration gateway.',
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
        'settings.model.hint': 'Unselected defaults to freeroute auto routing; when freeroute is unavailable the current default model is used. Picking a model writes the account default model and survives engine restarts.',
        'settings.model.offline': 'freeroute unreachable — using the current default model',
        'settings.model.saving': 'Saving…',
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

      // =========================================================
      // Module-level services and state.
      // =========================================================
      let ctx: any = null
      let connectionSvc: any = null
      let slotsSvc: any = null

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

        // Prefer the standard kit the shell hands our `sidebar.workspaces`
        // shadow (useSessions/useWorkspaces/useSessionPendingInteraction),
        // falling back to the legacy host observables when those are absent.
        if (shellProps !== undefined) {
          for (const name of ['useSessions', 'useWorkspaces', 'useSessionPendingInteraction']) {
            if (shellProps[name] !== undefined) props[name] = shellProps[name]
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
        if (typeof a.avatarDataUrl === 'string' && a.avatarDataUrl !== '') {
          return e('span', { className: 'dbs-avatar' + shape, style },
            e('img', { src: a.avatarDataUrl, alt: '' }))
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
        const native = NATIVE.IconTriangleRightFill14
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
              style: { padding: '0 8px 0 4px', display: 'flex', alignItems: 'center', gap: 2 },
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
            // Clicking into the native browser (a session row, "new chat"…)
            // is a navigation intent: dismiss the bot chat overlay so the
            // main window the user asked for is actually visible.
            e('div', {
              className: 'dbs-navBody',
              onClickCapture: () => { if (s.chatAgentId !== null) patch({ chatAgentId: null }) },
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

      /**
       * Pixel offsets of the frame's centre column.
       *
       * `shell.overlay` covers the whole AppFrame, so an `inset: 0` panel sits
       * on top of the sidebar too — which is how the chat used to hide the very
       * nav it is launched from. The frame is a CSS grid and
       * `grid-template-columns` resolves to pixels, so the sidebar and details
       * widths can be read straight off it. `[data-shell-overlay]` is a stable
       * attribute (not a hashed class), and its parent is the frame.
       */
      function useCentreInset(): { left: number; right: number } {
        const [inset, setInset] = React.useState({ left: 0, right: 0 })
        React.useEffect(() => {
          const layer = document.querySelector('[data-shell-overlay]')
          const frame = layer === null ? null : layer.parentElement
          if (frame === null) return undefined
          const read = () => {
            const cols = window.getComputedStyle(frame).gridTemplateColumns.split(/\s+/).filter((c) => c !== '')
            const left = Number.parseFloat(cols[0]) || 0
            const right = cols.length >= 3 ? (Number.parseFloat(cols[cols.length - 1]) || 0) : 0
            setInset((prev: any) => (prev.left === left && prev.right === right ? prev : { left, right }))
          }
          read()
          const ro = new ResizeObserver(read)
          ro.observe(frame)
          // Collapsing a column rewrites the inline grid template without
          // resizing the frame, so watch the attribute as well.
          const mo = new MutationObserver(read)
          mo.observe(frame, { attributes: true, attributeFilter: ['style', 'data-details-collapsed'] })
          return () => { ro.disconnect(); mo.disconnect() }
        }, [])
        return inset
      }

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

      function ToolCard(p: { entry: any }) {
        const [open, setOpen] = React.useState(false)
        const en = p.entry
        const tone = en.toolStatus === 'error'
          ? 'var(--dsw-alias-state-error-primary)'
          : en.toolStatus === 'running'
            ? 'var(--dsw-alias-state-warn-primary)'
            : 'var(--dsw-alias-state-success-primary)'
        return e('div', { className: 'dbs-toolCard' },
          e('div', {
            className: 'dbs-toolHdr', role: 'button', tabIndex: 0,
            style: { cursor: en.content === '' ? 'default' : 'pointer' },
            onClick: () => { if (en.content !== '') setOpen(!open) },
            onKeyDown: (ev: any) => { if ((ev.key === 'Enter' || ev.key === ' ') && en.content !== '') { ev.preventDefault(); setOpen(!open) } },
          },
            StateDot !== null
              ? e(StateDot, { state: en.toolStatus === 'running' ? 'ongoing' : en.toolStatus === 'error' ? 'error' : 'done', size: 10 })
              : e('span', { style: { width: 10, height: 10, borderRadius: 999, background: tone, display: 'inline-block' } }),
            e('span', { className: 'dbs-toolName' }, en.toolName ?? t('tool.fallbackName')),
            e('span', { className: 'dbs-toolTrail' },
              en.content !== '' ? e('span', { className: 'dbs-meta' }, open ? t('action.collapse') : t('action.expand')) : null,
              e(MsgTime, { entry: en }))),
          open && en.content !== '' ? e('div', { className: 'dbs-toolBody' }, ...inlineFileChips(en.content), e(MediaRefs, { text: en.content })) : null)
      }

      function Entry(p: { entry: any; isGroup: boolean; agent: any; compact?: boolean }) {
        const en = p.entry
        if (en.display === 'user') {
          return e('div', { className: 'dbs-userRow' },
            e('div', { className: 'dbs-userStack' },
              e('div', { className: 'dbs-bubble' },
                e(MessageText, { text: en.content }),
                e(MediaRefs, { text: en.content }))),
            e(MsgTime, { entry: en }))
        }
        if (en.display === 'tool') return e(ToolCard, { entry: en })
        if (en.display === 'thinking') {
          return e('div', { className: 'dbs-thinking' }, en.content)
        }
        if (en.display === 'event') {
          if (en.content === '') return null
          return e('div', { className: 'dbs-meta', style: { textAlign: 'center' } }, en.content)
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
            e('div', { className: 'dbs-compactTime' }, e(MsgTime, { entry: en })))
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
        const authorColor = 'hsl(' + String(hueOf(avAgent.id)) + ' 55% 45%)'
        return e('div', { className: 'dbs-botRow' },
          e('div', { className: 'dbs-author' },
            e(Avatar, { agent: avAgent, size: 22, round: true }),
            displayName != null && displayName !== ''
              ? e('span', { className: 'dbs-authorName', style: { color: authorColor } }, displayName)
              : null,
            e(MsgTime, { entry: en })),
          e('div', { className: 'dbs-mdRow' },
            e(MarkdownText, { text: en.content, streaming: en.isStreaming === true }),
            en.isStreaming === true ? e('span', { className: 'dbs-caret' }) : null,
            en.isStreaming === true ? null : e(MediaRefs, { text: en.content })))
      }

      function ChatView(p: { agentId: string }) {
        const s = useStore()
        const [entries, setEntries] = React.useState(null)
        const [input, setInput] = React.useState('')
        const [sending, setSending] = React.useState(false)
        const [stopping, setStopping] = React.useState(false)
        const [error, setError] = React.useState(null)
        const [mention, setMention] = React.useState(null) // {query, index} | null
        const scrollRef = React.useRef(null)
        const inputRef = React.useRef(null)
        // True between compositionstart/end: an IME candidate window owns the
        // keyboard while it is open and must never see our Enter binding.
        const imeRef = React.useRef(false)

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
          setEntries(null); setError(null); setInput(''); setMention(null)
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
        const [showJump, setShowJump] = React.useState(false)
        // A fresh conversation starts pinned at its tail: without this reset,
        // leaving chat A scrolled up (stick=false) opened chat B parked at top.
        React.useEffect(() => {
          stickRef.current = true
          setShowJump(false)
        }, [p.agentId])
        function onScrollBody(): void {
          const el = scrollRef.current
          if (el === null || el === undefined) return
          const distance = el.scrollHeight - el.scrollTop - el.clientHeight
          stickRef.current = distance < 80
          const next = distance > 240
          setShowJump((prev: boolean) => (prev === next ? prev : next))
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
          setInput(String(node.value))
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

        function applyMention(a: any) {
          const node = inputRef.current
          const caret = node?.selectionStart ?? input.length
          const before = input.slice(0, caret).replace(/@([^\s@]*)$/, '@' + a.name + ' ')
          setInput(before + input.slice(caret))
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

        async function doSend() {
          const text = input.trim()
          // Sending during an active run is a QUEUED send: the daemon appends
          // the message durably and its run scheduler delivers the follow-up
          // turn once the active one settles (user lane first; a watchdog
          // frees a wedged run). Blocking here would strand the composer.
          if (text === '' || sending) return
          setSending(true); setError(null)
          try {
            await botsCall('send', { agentId: p.agentId, prompt: text })
            setInput('')
            setMention(null)
            await refreshAgents()
            await loadTranscript()
          } catch (err: any) { setError(String(err?.message ?? err)) }
          setSending(false)
          // The caret stays in the composer after a send, as in every native
          // thread: the next turn is typed without reaching for the mouse.
          const node = inputRef.current
          if (node !== null && node !== undefined) node.focus()
        }

        const list = (entries ?? []) as any[]
        const inset = useCentreInset()

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
          thread.push(e(Entry, { key: en.id !== '' ? en.id : String(i), entry: en, isGroup, agent, compact }))
        })

        return e('div', { className: 'dbs-chatview', style: { left: inset.left, right: inset.right } },
          e('div', { className: 'dbs-chatbar' },
            e(Button, {
              variant: 'ghost', size: 'sm', title: t('action.close'), 'aria-label': t('action.close'),
              icon: Ico('IconCloseOutline16', { size: 16 }),
              onClick: () => patch({ chatAgentId: null }),
            }),
            agent !== null ? e(Avatar, { agent, size: 24, round: true }) : null,
            e('span', { className: 'dbs-chatbarName' }, agent?.name ?? t('chat.loading')),
            e('span', { className: 'dbs-meta' }, isGroup ? t('chat.group', { n: memberNames.length }) : t('chat.single')),
            e('span', { style: { flex: 1 } }),
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

          e('div', { className: 'dbs-scrollArea' },
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
                    ? e('div', { className: 'dbs-typing', 'aria-label': t('chat.composing'), title: t('chat.composing') },
                        // Native ongoing state: the StateDot chase matrix
                        // (DeepSeek-blue cells, 1s cycle) — the exact icon the
                        // shell uses while a run is in flight.
                        StateDot !== null
                          ? e(StateDot, { state: 'ongoing', size: 12 })
                          : e('span', { className: 'dbs-typingDot' }),
                        e('span', { className: 'dbs-typingText' }, t('chat.composing')),
                        e('button', {
                          type: 'button', className: 'dbs-typingStop', disabled: stopping,
                          title: t('action.stop'), 'aria-label': t('action.stop'),
                          onClick: () => void doStop(),
                        }, e(StopSquareIcon, null), t('action.stop')))
                    : null))),
            e('button', {
              type: 'button', className: 'dbs-jump', 'data-show': showJump ? 'true' : 'false',
              'aria-label': t('chat.jump'), title: t('chat.jump'),
              onClick: jumpToLatest,
            }, Ico('IconChevronDownOutline14', { size: 16 }))),

          e('div', { className: 'dbs-composerSeat' },
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
                  ? e('div', { className: 'dbs-mention' }, mentionHits.map((a: any, i: number) => e('div', {
                      key: a.id, className: 'dbs-mentionRow', 'data-active': i === (mention?.index ?? 0),
                      onMouseDown: (ev: any) => { ev.preventDefault(); applyMention(a) },
                    },
                      a.everyone === true
                        ? e('span', { className: 'dbs-slot', style: { width: 18, height: 18 }, 'aria-hidden': true }, e(PeopleGlyph, null))
                        : e(Avatar, { agent: a, size: 18 }),
                      a.name)))
                  : null,
                e('div', { className: 'dbs-composerScroll' },
                  e('textarea', {
                    ref: inputRef, className: 'dbs-composerInput', value: input, rows: 1,
                    placeholder: isGroup ? t('chat.placeholder.group') : t('chat.placeholder.single', { name: agent?.name ?? '' }),
                    // Native chrome: no spellcheck squiggles, no autocomplete
                    // dropdown over the card, and a plain multi-line seat.
                    spellCheck: false, autoComplete: 'off', autoCorrect: 'off', autoCapitalize: 'off',
                    onChange: (ev: any) => onInputChange(ev.target),
                    // Caret moves (click, arrows, Home/End) re-evaluate the
                    // mention token, so the menu tracks the caret, not typing.
                    onSelect: (ev: any) => syncMention(ev.target),
                    onCompositionStart: () => { imeRef.current = true },
                    onCompositionEnd: (ev: any) => {
                      imeRef.current = false
                      // Firefox/Safari fire this *after* the keydown that
                      // committed the candidate, so the committed value has to
                      // be picked up here rather than in the change handler.
                      onInputChange(ev.target)
                    },
                    onBlur: () => setMention(null),
                    onKeyDown: (ev: any) => {
                      // While an IME candidate window is open it owns Enter,
                      // the arrows and Escape. `isComposing` is the standard
                      // signal; keyCode 229 covers the engines that omit it.
                      if (imeRef.current || ev.nativeEvent?.isComposing === true || ev.keyCode === 229) return
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
                      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); void doSend() }
                    },
                  })),
                e('div', { className: 'dbs-composerRow' },
                  e('span', { className: 'dbs-meta' },
                    input.trim() !== '' ? t('chat.charCount', { n: input.trim().length }) : ''),
                  e('div', { className: 'dbs-composerTrailing' },
                    // ONE morphing circle, always (native contract §12-29).
                    // With text in hand the corner is the action for that
                    // text: send when idle, a queued send while a run is
                    // active (the daemon persists it and the run scheduler
                    // delivers the follow-up turn after this one settles —
                    // Enter queues the same way). Stop owns the corner only
                    // when there is nothing to send; while a run is active
                    // with text typed, stop stays one click away in the
                    // typing indicator instead of crowding beside the send.
                    composing && input.trim() === ''
                      ? e('button', {
                          type: 'button', className: 'dbs-send dbs-stop',
                          disabled: stopping,
                          title: t('action.stop'), 'aria-label': t('action.stop'),
                          onClick: () => void doStop(),
                        }, e(StopSquareIcon, null))
                      : e('button', {
                          type: 'button', className: 'dbs-send',
                          disabled: sending || input.trim() === '',
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
          } catch (e2: any) { setErr(String(e2?.message ?? e2)) }
        }
        React.useEffect(() => { void reload() }, [])
        async function run(fn: () => Promise<unknown>) {
          setBusy(true); setErr(null)
          try { await fn(); await reload() } catch (e2: any) { setErr(String(e2?.message ?? e2)) } finally { setBusy(false) }
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
          } catch (e2: any) { setErr(String(e2?.message ?? e2)) }
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
          } catch (e2: any) { setErr(String(e2?.message ?? e2)) } finally { setBusy(false) }
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
        async function refresh() {
          setCfg(undefined); setErr(null)
          try { setCfg(await botsCall('modelConfig', {})) } catch (e2: any) { setErr(String(e2?.message ?? e2)) }
        }
        React.useEffect(() => { void refresh() }, [])
        const current = cfg?.agentDefaultModel ?? null
        const effLabel = current !== null
          ? current
          : (cfg?.freerouteReachable === true ? t('settings.model.auto') : t('settings.model.engineDefault'))
        async function save(modelId: string | null) {
          setWorking(true); setErr(null)
          try {
            await botsCall('setModelConfig', { modelId })
            await refresh()
          } catch (e2: any) { setErr(String(e2?.message ?? e2)) }
          setWorking(false)
        }
        const groups = Array.isArray(cfg?.groups) ? cfg.groups : []
        const groupOf = current !== null
          ? (groups.find((g: any) => g.models.indexOf(current) !== -1) ?? null)
          : null
        const prov = provRaw !== null ? provRaw : (groupOf !== null ? groupOf.provider : '')
        const provModels = prov !== ''
          ? ((groups.find((g: any) => g.provider === prov)?.models ?? []) as string[])
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
              groups.map((g: any) => e('option', { key: g.provider, value: g.provider }, `${g.provider}（${g.models.length}）`)))),
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
            .catch((e2: any) => { setErr(String(e2?.message ?? e2)); setLoaded(true) })
        }, [])
        const n = Math.floor(Number(cap))
        const valid = cap.trim() !== '' && String(n) === cap.trim() && n >= 1 && n <= 16
        async function save() {
          if (working || valid === false) return
          setWorking(true); setErr(null)
          try {
            const r = await botsCall<{ max: number }>('groupCap', { max: n })
            setCap(String(r.max))
          } catch (e2: any) { setErr(String(e2?.message ?? e2)) }
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
        async function refresh() {
          setInfo(undefined); setErr(null)
          try {
            setInfo(await botsCall('gatewayInfo', {}))
            setSse(await botsCall('sseState'))
          } catch (e2: any) { setErr(String(e2?.message ?? e2)) }
        }
        React.useEffect(() => { void refresh() }, [])
        const ok = info?.ok === true
        return e('div', { className: 'dbs-settings' },
          e('div', { className: 'dbs-setrow' }, t('settings.summary')),
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
          info?.ok === true ? e(GroupCard) : null,
          info?.ok === true ? e(ModelCard) : null,
          info?.ok === true ? e(WorkspaceCard) : null,
          info?.ok === true ? e(McpCard) : null)
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
          } catch (e2: any) { setErr(String(e2?.message ?? e2)) }
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
          } catch (e2: any) { setErr(String(e2?.message ?? e2)) }
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
          } catch (e2: any) { setErr(String(e2?.message ?? e2)) }
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
          } catch (e2: any) { setErr(String(e2?.message ?? e2)) }
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

      function BotsLayer() {
        const s = useStore()
        React.useEffect(() => {
          function onKey(ev: KeyboardEvent) {
            if (ev.key !== 'Escape') return
            // Topmost dialog first: delete confirm, then create, then chat.
            if (state.rowMenu !== null) { patch({ rowMenu: null }); return }
            if (state.confirmDelete !== null) { patch({ confirmDelete: null }); return }
            if (state.create !== null) { patch({ create: null }); return }
            if (state.chatAgentId !== null) patch({ chatAgentId: null })
          }
          window.addEventListener('keydown', onKey)
          return () => { window.removeEventListener('keydown', onKey) }
        }, [])
        const layers: any[] = []
        if (s.chatAgentId !== null) layers.push(e(ChatView, { agentId: s.chatAgentId, key: s.chatAgentId }))
        if (s.create !== null) layers.push(e(CreateModal, { key: 'create' }))
        if (s.manageMembers !== null) layers.push(e(ManageMembersModal, { key: 'manage-members' }))
        if (s.settingsAgentId !== null) layers.push(e(AgentSettingsModal, { key: 'agent-settings' }))
        if (s.confirmDelete !== null) layers.push(e(ConfirmDeleteModal, { key: 'confirm-delete' }))
        return layers.length === 0 ? null : e('div', null, layers)
      }

      // =========================================================
      // Slot registration (formal runtime contract).
      // =========================================================
      const inject = ['connection', 'slots', 'locale']

      function apply(c: any): void {
        ctx = c
        connectionSvc = c.get('connection')
        slotsSvc = c.get('slots')
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

        c.effect(() => slots.inject('shell.overlay', () => slots.register(
          { name: 'shell.overlay', id: 'dsh-bots.chat', order: 20, registrant: 'dsh-bots', locale: NS },
          () => e(BotsLayer),
        )), 'dsh-bots: chat overlay')

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

        reportDiag('apply', { slots: ['shell.overlay', 'sidebar.workspaces', 'settings.section'] })
      }

      exports.apply = apply
      exports.inject = inject
      return module.exports
    },
  })
})()
