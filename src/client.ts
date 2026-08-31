/**
 * dsh-plugin-bots — client half (web), formal-plugin runtime.
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
 * @module dsh-plugin-bots/client
 */

;(() => {
  const loader = (window as any).__ModuleLoader__
  if (loader === undefined) return
  loader.load({
    id: 'dsh-plugin-bots',
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
        return e('div', { className: 'dbs-plain' }, p.text)
      }

      const Button = nat('Button', FallbackButton)
      const Input = nat('Input', FallbackInput)
      const MarkdownText = nat('MarkdownText', FallbackText)
      const MessageText = nat('MessageText', FallbackText)
      const StateDot = NATIVE.StateDot ?? null

      // ---- CSS: own stable class names, values mirrored from the shell ----
      const CSS = `
.dbs-nav{flex:1;min-height:0;display:flex;flex-direction:column;gap:2px;font-family:var(--dsw-font-family,inherit)}
.dbs-navGroup{display:flex;flex-direction:column;min-height:0}
.dbs-navGroup[data-open="true"]{flex:1 1 auto}
.dbs-navGroup[data-open="false"]{flex:none}
.dbs-navBody{display:flex;flex-direction:column;min-height:0;flex:1}
.dbs-botsBody{overflow-y:auto;padding-right:var(--dsh-sidebar-inline-padding,8px)}
.dbs-navBodyErr{padding:6px 12px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.dbs-prow,.dbs-srow{cursor:pointer;user-select:none;color:var(--dsw-alias-label-primary);border-radius:8px;align-items:center;gap:6px;padding:0 8px;display:flex;box-sizing:border-box}
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
.dbs-badge{min-width:16px;height:16px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-state-business-primary,#1a6dff);color:#fff;font-size:11px;line-height:16px;text-align:center;flex:none;font-variant-numeric:tabular-nums}
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
.dbs-chatbar{flex:none;display:flex;align-items:center;gap:8px;height:44px;padding:0 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08))}
.dbs-chatbarName{font-size:14px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.dbs-scrollBody{scrollbar-gutter:stable;flex-direction:column;flex:1;min-height:0;display:flex;overflow:hidden auto}
.dbs-scroll{min-height:0;padding:16px calc(var(--dsh-composer-side-clearance) + 16px);flex:auto}
.dbs-column{max-width:var(--dsh-chat-content-width);flex-direction:column;gap:16px;width:100%;margin:0 auto;display:flex}
.dbs-userRow{flex-direction:column;align-items:flex-end;gap:6px;display:flex}
.dbs-userStack{flex-direction:column;align-items:flex-end;gap:8px;min-width:0;max-width:min(525px,82%);display:flex}
.dbs-bubble{background:var(--dsw-specific-bubble);max-width:100%;color:var(--dsw-alias-label-primary);border-radius:22px;padding:10px 16px;font-size:16px;line-height:24px}
.dbs-botRow{color:var(--dsw-alias-label-primary);flex-direction:column;font-size:16px;line-height:28px;display:flex;align-items:flex-start;gap:4px;width:100%}
.dbs-author{font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary);display:flex;align-items:center;gap:6px}
.dbs-plain{white-space:pre-wrap;word-break:break-word}
.dbs-toolCard{border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));background:var(--dsw-specific-bubble);border-radius:12px;padding:8px 12px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);width:100%;box-sizing:border-box}
.dbs-toolHdr{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.dbs-toolName{font:var(--dsw-font-markdown-code-block-small,inherit);font-size:13px}
.dbs-toolBody{margin-top:4px;white-space:pre-wrap;word-break:break-word;max-height:190px;overflow:auto;color:var(--dsw-alias-label-tertiary)}
.dbs-thinking{color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:22px;white-space:pre-wrap;word-break:break-word;border-left:2px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));padding-left:10px}
.dbs-turnStatus{height:26px;font-size:14px;font-weight:600;white-space:nowrap;background:linear-gradient(90deg,var(--dsw-static-deepseek-500,#4d6bfe) 0%,var(--dsw-static-deepseek-500,#4d6bfe) 40%,var(--dsw-static-deepseek-200,#b6c2ff) 50%,var(--dsw-static-deepseek-500,#4d6bfe) 60%,var(--dsw-static-deepseek-500,#4d6bfe) 100%);color:#0000;-webkit-text-fill-color:transparent;background-position:100% 0;background-size:250% 100%;-webkit-background-clip:text;background-clip:text;flex:none;align-self:flex-start;align-items:center;animation:1.8s linear infinite dbs-turn-status-shimmer;display:inline-flex}
@keyframes dbs-turn-status-shimmer{to{background-position:0 0}}
@media (prefers-reduced-motion:reduce){.dbs-turnStatus{background-position:0 0;background-size:100% 100%;animation:none}.dbs-arrow{transition:none}}
.dbs-composerSeat{flex:none;display:flex;flex-direction:column;z-index:7;background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-bg-base) 0%,transparent) 0px,var(--dsw-alias-bg-base) 36px)}
.dbs-composer{padding:0 var(--dsh-composer-side-clearance) 8px;flex-direction:column;align-items:center;display:flex}
.dbs-composerCard{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width);border:1px solid var(--dsw-alias-border-l2-darkmode-thin,rgba(0,0,0,.12));background:var(--dsw-specific-input-major);box-shadow:var(--dsw-shadow-lv2);border-radius:22px;flex-direction:column;gap:12px;padding-top:10px;font-size:16px;line-height:24px;display:flex;position:relative}
.dbs-composerScroll{max-height:var(--dsh-composer-text-max-height);overflow-y:auto}
.dbs-composerRow{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;min-width:0;padding:2px 8px 6px;display:flex}
.dbs-composerTrailing{align-items:center;min-width:0;display:flex;flex:none;gap:8px;margin-left:auto}
.dbs-composerInput{resize:none;width:100%;box-sizing:border-box;border:none;outline:none;background:transparent;font-family:var(--dsw-font-family);font-size:16px;line-height:24px;white-space:pre-wrap;word-break:break-word;padding:4px 12px 0 16px;min-height:52px;color:var(--dsw-alias-label-primary)}
.dbs-composerInput::placeholder{color:var(--dsw-alias-label-caption);user-select:none}
.dbs-send{background:var(--dsw-alias-button-info-fill,#1a6dff);color:#fff;cursor:pointer;border:none;border-radius:999px;flex:none;place-items:center;width:34px;height:34px;transition:background-color .1s;display:grid;transform:translateY(-2px)}
.dbs-send:disabled{opacity:.4;cursor:default}
.dbs-modalBackdrop{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:24px;pointer-events:auto}
.dbs-modalCard{position:relative;width:min(440px,92vw);max-height:88vh;overflow-y:auto;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:18px 20px 22px;box-shadow:0 24px 80px rgba(0,0,0,.3);animation:dbs-modal-in .18s ease-out}
@keyframes dbs-modal-in{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}
.dbs-modalTitleRow{display:flex;align-items:center;gap:8px;margin-bottom:14px}
.dbs-modalTitle{font-size:16px;line-height:24px;font-weight:600;color:var(--dsw-alias-label-primary);flex:1;min-width:0}
.dbs-modalBody{display:flex;flex-direction:column;gap:10px}
.dbs-modalMembers{display:flex;flex-direction:column;gap:2px;max-height:220px;overflow-y:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:6px}
.dbs-modalFooter{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:16px}
.dbs-rowDel{display:none;border:none;background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;width:24px;height:24px;border-radius:6px;padding:0}
.dbs-rowDel:hover{color:#f85149;background:rgba(248,81,73,.1)}
.dbs-srow:hover .dbs-rowDel,.dbs-rowDel:focus-visible{display:inline-flex}
.dbs-mention{position:absolute;bottom:calc(100% + 6px);left:12px;right:12px;max-height:180px;overflow-y:auto;background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:12px;box-shadow:var(--dsw-shadow-lv2);padding:4px;z-index:3}
.dbs-mentionRow{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.dbs-mentionRow[data-active="true"],.dbs-mentionRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dbs-empty{color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:22px;text-align:center;padding:32px 0}

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
        'list.empty': '还没有 Bot，点 ＋ 新建。',
        'section.groups': '群聊',
        'section.singles': '单聊',
        'chat.group': '群聊 · {n} 名成员',
        'chat.single': '单聊',
        'chat.loading': '加载中…',
        'chat.empty': '还没有消息，发一条开始对话',
        'chat.composing': '生成中',
        'chat.composingHint': '正在生成，请稍候',
        'chat.placeholder.group': '@名字 可定向，默认全员',
        'chat.placeholder.single': '给 {name} 发消息…',
        'chat.charCount': '{n} 字',
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
        'list.empty': 'No bots yet — use ＋ to create one.',
        'section.groups': 'Groups',
        'section.singles': 'Direct',
        'chat.group': 'Group · {n} members',
        'chat.single': 'Direct',
        'chat.loading': 'Loading…',
        'chat.empty': 'No messages yet — send one to start.',
        'chat.composing': 'Generating',
        'chat.composingHint': 'Generating, please wait',
        'chat.placeholder.group': 'Use @name to direct a turn; everyone by default',
        'chat.placeholder.single': 'Message {name}…',
        'chat.charCount': '{n} chars',
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
        const subs = new Set<(channels: Set<string>, events: any[]) => void>()

        async function drain(): Promise<void> {
          let r: any
          try { r = await botsCall('eventsSince', { seq }) }
          catch { return /* gateway offline; the next tick retries */ }
          if (r === null || typeof r !== 'object') return
          if (Number.isFinite(r.nextSeq)) seq = Number(r.nextSeq)
          if (r.state !== undefined) live = r.state
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
        }
      })()

      /** Shared UI state; every mutation goes through `patch`. */
      const state: any = {
        agents: [] as any[],
        agentsLoaded: false,
        info: undefined as any,
        error: null as string | null,
        chatAgentId: null as string | null,
        open: { workspaces: true, bots: true },
        /** Create dialog: 'bot' | 'group' | null — rendered as a system-style
         *  modal from shell.overlay, so the form state lives in the store. */
        create: null as string | null,
        createName: '',
        createDesc: '',
        createMembers: {} as Record<string, boolean>,
        createWorking: false,
        /** Delete confirmation: { id, name, isGroup } | null (system modal). */
        confirmDelete: null as any,
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
      async function refreshInfo(): Promise<void> {
        try { patch({ info: await botsCall('gatewayInfo', {}) }) } catch { /* keep the last good reading */ }
      }

      function openChat(id: string): void {
        patch({ chatAgentId: id })
        // Clear the badge at the source; the gateway owns unread state.
        void botsCall('markRead', { id }).then(refreshAgents).catch(() => {})
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
        console.warn('[dsh-plugin-bots] ' + message)
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
          console.error('[dsh-plugin-bots] delegated slot entry failed:', error)
          reportDiag('delegate-crashed', { message: String(error?.message ?? error) })
        }
        render() { return this.state.failed ? this.props.fallback : this.props.children }
      }

      /** Live entries of a slot that are not ours, most-specific first. */
      function foreignEntries(key: string): any[] {
        if (slotsSvc === null) return []
        let list: any[] = []
        try { list = slotsSvc.entries(key) ?? [] } catch { return [] }
        return list.filter((en: any) => en !== null && en.component !== undefined && en.registrant !== 'dsh-plugin-bots')
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
      function synthesizeProps(entry: any, ownerProps: any): any {
        const props: any = {}
        if (slotsSvc === null) return { ...props, ...ownerProps }
        const host = slotsSvc.hostFace()

        if (host.sessions !== undefined && host.workspaces !== undefined) {
          props.useSessions = observableHook(host.sessions.list)
          props.useWorkspaces = observableHook(host.workspaces.list)
        }

        let actions: any
        if (entry.store !== undefined) {
          try {
            const store = host.storeOf(entry, undefined)
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

        if (entry.locale !== undefined && host.locale !== undefined) {
          try {
            const bound = host.locale.bind(entry.locale)
            props.t = (key: string, params?: unknown) => bound(key, params)
          } catch { props.t = (key: string) => key }
        }

        if (entry.children !== undefined) {
          props.renderSlot = renderChildSlot
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
      function renderChildSlot(key: string, ownerProps?: any): any {
        const entries = foreignEntries(key)
        if (entries.length === 0) return null
        return entries.map((en: any, i: number) => e(Boundary, {
          key: en.id ?? key + ':' + String(i),
          fallback: null,
          children: e(en.component, synthesizeProps(en, ownerProps ?? {})),
        }))
      }

      /**
       * Renders the shipped `sidebar.workspaces` entry underneath our shadow.
       * `wide` is forwarded untouched so the shipped rail branch — search and
       * add-workspace, which the plugin used to replace with two inert icons —
       * keeps working when the sidebar is collapsed.
       */
      function DelegatedBrowser(p: { wide: boolean; expandSidebar?: () => void }) {
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
          () => (entry === null ? null : synthesizeProps(entry, { wide: p.wide, expandSidebar: p.expandSidebar })),
          [entry, p.wide, p.expandSidebar],
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

      function Avatar(p: { agent: any; size?: number }) {
        const a = p.agent
        const size = p.size ?? 20
        const style: any = { width: size, height: size }
        if (typeof a.avatarDataUrl === 'string' && a.avatarDataUrl !== '') {
          return e('span', { className: 'dbs-avatar' + (a.isGroup ? ' dbs-group' : ''), style },
            e('img', { src: a.avatarDataUrl, alt: '' }))
        }
        style.background = typeof a.avatarColor === 'string' && a.avatarColor !== ''
          ? a.avatarColor
          : `hsl(${String(hueOf(a.id))} 52% 46%)`
        if (size >= 24) style.fontSize = '13px'
        const initial = (a.name ?? '').trim().slice(0, 1) || '·'
        return e('span', {
          className: 'dbs-avatar' + (a.isGroup ? ' dbs-group' : ''), style, 'aria-hidden': true,
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

      // =========================================================
      // Bots nav group.
      // =========================================================
      function BotsGroup() {
        const s = useStore()

        // Hidden agents are hidden: the gateway owns that flag and the sidebar
        // has to honour it, same as every other sdk-bots surface.
        const visible = (s.agents as any[])
          .filter((a) => a.isHiddenFromSidebar !== true)
          .slice()
          .sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0))
        const groups = visible.filter((a) => a.isGroup)
        const singles = visible.filter((a) => !a.isGroup)
        const connected = s.info?.ok === true

        function row(a: any) {
          const busy = a.isComposingMessage === true || a.isRunning === true
          const unread = Number(a.unreadCount ?? 0)
          return e('div', {
            key: a.id,
            className: 'dbs-srow' + (s.chatAgentId === a.id ? ' dbs-selected' : ''),
            role: 'treeitem',
            'aria-selected': s.chatAgentId === a.id,
            tabIndex: 0,
            onClick: () => openChat(a.id),
            onKeyDown: (ev: any) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openChat(a.id) } },
            title: a.description !== '' ? a.name + ' — ' + a.description : a.name,
          },
            e(Avatar, { agent: a }),
            e('span', { className: 'dbs-title' }, a.name),
            busy && StateDot !== null
              ? e(StateDot, { state: 'ongoing', size: 10 })
              : a.awaitingUserResponse !== null && a.awaitingUserResponse !== undefined && StateDot !== null
                ? e(StateDot, { state: 'warning', size: 10 })
                : unread > 0
                  ? e('span', { className: 'dbs-badge' }, unread > 99 ? '99+' : String(unread))
                  : null,
            e('button', {
              type: 'button', className: 'dbs-rowDel',
              title: t('action.delete'), 'aria-label': t('action.delete') + ' ' + a.name,
              onClick: (ev: any) => {
                ev.stopPropagation()
                patch({ confirmDelete: { id: a.id, name: a.name, isGroup: a.isGroup === true } })
              },
            }, Ico('IconTrashOutline16', { size: 14 })))
        }

        function sectionRows(label: string, list: any[]) {
          if (list.length === 0) return null
          return e('div', { key: label },
            e('div', { className: 'dbs-navBodyErr', style: { padding: '4px 12px 2px' } }, label),
            list.map(row))
        }

        // Footer: gateway status text plus the two create actions, pinned to
        // the bottom of the Bots body. The live dot itself lives on the
        // group header (see SidebarNav); the create actions open the
        // system-style modal (see CreateModal).
        const footer = e('div', {
          className: 'dbs-srow', style: { cursor: 'default', background: 'transparent', marginTop: 'auto' },
        },
          e('span', { className: 'dbs-meta', style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            connected ? t('gateway.online', { port: s.info.port }) : t('gateway.offline')),
          e(Button, {
            variant: 'ghost', size: 'sm', title: t('bot.new'), 'aria-label': t('bot.new'),
            icon: Ico('IconPlusOutline16', { size: 14 }),
            onClick: () => patch({ create: 'bot', createName: '', createDesc: '', createWorking: false, error: null }),
          }),
          e(Button, {
            variant: 'ghost', size: 'sm', title: t('group.new'), 'aria-label': t('group.new'),
            icon: Ico('IconNewChatOutline16', { size: 14 }),
            onClick: () => patch({ create: 'group', createName: '', createMembers: {}, createWorking: false, error: null }),
          }))

        return e('div', { className: 'dbs-navBody dbs-botsBody' },
          s.error !== null
            ? e('div', { className: 'dbs-error', onClick: () => patch({ error: null }) }, s.error)
            : null,
          !s.agentsLoaded
            ? e('div', { className: 'dbs-navBodyErr' }, t('list.loading'))
            : visible.length === 0
              ? e('div', { className: 'dbs-navBodyErr' }, connected ? t('list.empty') : t('gateway.offlineHint'))
              : null,
          sectionRows(t('section.groups'), groups),
          sectionRows(t('section.singles'), singles),
          footer)
      }

      // =========================================================
      // Sidebar nav: 「工作区」 and 「Bots」 as two collapsible groups.
      // =========================================================
      function SidebarNav(p: { wide?: boolean; expandSidebar?: () => void }) {
        const wide = p.wide !== false
        const s = useStore()

        // One controller owns the data lifecycle for every Bots surface.
        React.useEffect(() => {
          void refreshAgents(); void refreshInfo()
          return ring.subscribe((channels) => {
            if (channels.has('agents') || channels.has('agent-upserted')) void refreshAgents()
            if (channels.has('host-settings')) void refreshInfo()
          })
        }, [])

        if (!wide) {
          // Rail: the shipped browser draws its own icon column (search, add
          // workspace); we append one Bots control instead of replacing it.
          const busy = (s.agents as any[]).some((a) => a.isComposingMessage === true || a.isRunning === true)
          const unread = (s.agents as any[])
            .filter((a) => a.isHiddenFromSidebar !== true)
            .reduce((n: number, a: any) => n + Number(a.unreadCount ?? 0), 0)
          return e('div', { className: 'dbs-railWrap' },
            e(DelegatedBrowser, { wide: false, expandSidebar: p.expandSidebar }),
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

        function group(key: 'workspaces' | 'bots', title: string, iconName: string, body: any, trailing?: any) {
          const isOpen = s.open[key] !== false
          return e('div', { className: 'dbs-navGroup', 'data-open': isOpen },
            e('div', {
              className: 'dbs-prow', role: 'button', tabIndex: 0, 'aria-expanded': isOpen,
              onClick: () => patch({ open: { ...s.open, [key]: !isOpen } }),
              onKeyDown: (ev: any) => {
                if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); patch({ open: { ...s.open, [key]: !isOpen } }) }
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
            }, e(DelegatedBrowser, { wide, expandSidebar: p.expandSidebar }))),
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
            en.content !== '' ? e('span', { className: 'dbs-meta', style: { marginLeft: 'auto' } }, open ? t('action.collapse') : t('action.expand')) : null),
          open && en.content !== '' ? e('div', { className: 'dbs-toolBody' }, en.content) : null)
      }

      function Entry(p: { entry: any; isGroup: boolean }) {
        const en = p.entry
        if (en.display === 'user') {
          return e('div', { className: 'dbs-userRow' },
            e('div', { className: 'dbs-userStack' },
              e('div', { className: 'dbs-bubble' }, e(MessageText, { text: en.content }))))
        }
        if (en.display === 'tool') return e(ToolCard, { entry: en })
        if (en.display === 'thinking') {
          return e('div', { className: 'dbs-thinking' }, en.content)
        }
        if (en.display === 'event') {
          if (en.content === '') return null
          return e('div', { className: 'dbs-meta', style: { textAlign: 'center' } }, en.content)
        }
        return e('div', { className: 'dbs-botRow' },
          p.isGroup && en.authorName !== null
            ? e('div', { className: 'dbs-author' }, en.authorName)
            : null,
          e(MarkdownText, { text: en.content, streaming: en.isStreaming === true }))
      }

      function ChatView(p: { agentId: string }) {
        const s = useStore()
        const [entries, setEntries] = React.useState(null)
        const [input, setInput] = React.useState('')
        const [sending, setSending] = React.useState(false)
        const [error, setError] = React.useState(null)
        const [mention, setMention] = React.useState(null) // {query, index} | null
        const scrollRef = React.useRef(null)
        const inputRef = React.useRef(null)

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
          return ring.subscribe((channels) => {
            if (channels.has('transcript') || channels.has('client-side-tool-v2')) void loadTranscript()
          })
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [p.agentId])

        // Keep the newest turn in view, the way a native conversation does.
        React.useEffect(() => {
          const node = scrollRef.current
          if (node !== null && node !== undefined) node.scrollTop = node.scrollHeight
        }, [entries, composing])

        const memberNames = React.useMemo(() => {
          if (!isGroup) return []
          const ids: string[] = agent?.memberIds ?? []
          return ids
            .map((id) => (state.agents as any[]).find((a) => a.id === id))
            .filter((a) => a !== undefined)
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [isGroup, agent, s.agents])

        function onInputChange(value: string) {
          setInput(value)
          if (!isGroup) return
          // `@` completion for directed group turns: only while the caret sits
          // in the mention token being typed.
          const upto = value.slice(0, (inputRef.current?.selectionStart ?? value.length))
          const m = /@([^\s@]*)$/.exec(upto)
          setMention(m === null ? null : { query: m[1], index: 0 })
        }

        const mentionHits = mention === null
          ? []
          : memberNames.filter((a: any) => a.name.toLowerCase().startsWith(mention.query.toLowerCase())).slice(0, 8)

        function applyMention(a: any) {
          const node = inputRef.current
          const caret = node?.selectionStart ?? input.length
          const before = input.slice(0, caret).replace(/@([^\s@]*)$/, '@' + a.name + ' ')
          setInput(before + input.slice(caret))
          setMention(null)
          if (node !== null && node !== undefined) node.focus()
        }

        async function doSend() {
          const text = input.trim()
          if (text === '' || sending || composing) return
          setSending(true); setError(null)
          try {
            await botsCall('send', { agentId: p.agentId, prompt: text })
            setInput('')
            await refreshAgents()
            await loadTranscript()
          } catch (err: any) { setError(String(err?.message ?? err)) }
          setSending(false)
        }

        const list = (entries ?? []) as any[]
        const inset = useCentreInset()

        return e('div', { className: 'dbs-chatview', style: { left: inset.left, right: inset.right } },
          e('div', { className: 'dbs-chatbar' },
            e(Button, {
              variant: 'ghost', size: 'sm', title: t('action.close'), 'aria-label': t('action.close'),
              icon: Ico('IconCloseOutline16', { size: 16 }),
              onClick: () => patch({ chatAgentId: null }),
            }),
            agent !== null ? e(Avatar, { agent, size: 24 }) : null,
            e('span', { className: 'dbs-chatbarName' }, agent?.name ?? t('chat.loading')),
            e('span', { className: 'dbs-meta' }, isGroup ? t('chat.group', { n: memberNames.length }) : t('chat.single')),
            e('span', { style: { flex: 1 } })),

          error !== null
            ? e('div', { className: 'dbs-error', onClick: () => setError(null) }, error)
            : null,

          e('div', { className: 'dbs-scrollBody', ref: scrollRef },
            e('div', { className: 'dbs-scroll' },
              e('div', { className: 'dbs-column' },
                entries === null
                  ? e('div', { className: 'dbs-empty' }, t('chat.loading'))
                  : list.length === 0
                    ? e('div', { className: 'dbs-empty' }, t('chat.empty'))
                    : list.map((en: any, i: number) => e(Entry, { key: en.id !== '' ? en.id : String(i), entry: en, isGroup })),
                composing ? e('div', { className: 'dbs-turnStatus' }, t('chat.composing')) : null))),

          e('div', { className: 'dbs-composerSeat' },
            e('div', { className: 'dbs-composer' },
              e('div', { className: 'dbs-composerCard' },
                mentionHits.length > 0
                  ? e('div', { className: 'dbs-mention' }, mentionHits.map((a: any, i: number) => e('div', {
                      key: a.id, className: 'dbs-mentionRow', 'data-active': i === (mention?.index ?? 0),
                      onMouseDown: (ev: any) => { ev.preventDefault(); applyMention(a) },
                    }, e(Avatar, { agent: a, size: 18 }), a.name)))
                  : null,
                e('div', { className: 'dbs-composerScroll' },
                  e('textarea', {
                    ref: inputRef, className: 'dbs-composerInput', value: input, rows: 1,
                    placeholder: isGroup ? t('chat.placeholder.group') : t('chat.placeholder.single', { name: agent?.name ?? '' }),
                    onChange: (ev: any) => onInputChange(ev.target.value),
                    onKeyDown: (ev: any) => {
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
                      if (ev.key === 'Escape' && mention !== null) { ev.preventDefault(); setMention(null); return }
                      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); void doSend() }
                    },
                  })),
                e('div', { className: 'dbs-composerRow' },
                  e('span', { className: 'dbs-meta' },
                    composing ? t('chat.composingHint') : input.trim() !== '' ? t('chat.charCount', { n: input.trim().length }) : ''),
                  e('div', { className: 'dbs-composerTrailing' },
                    e('button', {
                      type: 'button', className: 'dbs-send',
                      // sdk-bots exposes no interrupt over the gateway, so there
                      // is no stop control to offer here: a button that only
                      // flipped local state would claim a cancel that never
                      // happened. Disabled-while-composing is the honest state.
                      disabled: sending || composing || input.trim() === '',
                      title: composing ? t('chat.composing') : t('action.send'),
                      'aria-label': composing ? t('chat.composing') : t('action.send'),
                      onClick: () => void doSend(),
                    }, composing ? Ico('IconLoadingOutline16', { size: 16 }) : e(SendUpIcon, null))))))))
      }

      // =========================================================
      // Settings section.
      // =========================================================
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
            e('div', { className: 'dbs-setrow' }, t('settings.events'),
              e('b', null, sse?.running === true ? t('settings.events.on', { n: sse.buffered ?? 0 }) : t('settings.events.off')),
              sse?.lastError ? ' · ' + String(sse.lastError) : ''),
            e('div', { className: 'dbs-setrow' }, t('settings.entry'), e('b', null, t('settings.entry.value')))))
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
            className: 'dbs-modalCard', role: 'dialog', 'aria-modal': true,
            'aria-label': isGroup ? t('delete.title.group') : t('delete.title.bot'),
            onClick: (ev: any) => { ev.stopPropagation() },
          },
            e('div', { className: 'dbs-modalTitleRow' },
              e('span', { className: 'dbs-modalTitle' }, isGroup ? t('delete.title.group') : t('delete.title.bot')),
              e(Button, {
                variant: 'ghost', size: 'sm', title: t('action.close'), 'aria-label': t('action.close'),
                disabled: working,
                icon: Ico('IconCloseOutline16', { size: 16 }),
                onClick: () => patch({ confirmDelete: null }),
              })),
            e('div', { className: 'dbs-modalBody' },
              e('span', { className: 'dbs-meta', style: { fontSize: 14, lineHeight: 22 } },
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
          styleEl.setAttribute('data-dsh-plugin', 'dsh-plugin-bots')
          styleEl.textContent = CSS
          document.head.appendChild(styleEl)
          return () => { styleEl.remove() }
        }, 'dsh-plugin-bots: styles')

        // Dictionaries first: a slot may render on the same tick it registers.
        const locale = c.get('locale')
        if (locale !== undefined && locale !== null) {
          c.effect(() => locale.register(NS, { zh, en }), 'dsh-plugin-bots: dictionaries')
          boundT = locale.bind(NS)
          // Our surfaces read `t` from module scope rather than from the prop
          // the renderer hands the slot root, because the strings live six
          // components deep. That means a language switch has to be pushed
          // into our own store to re-render them.
          c.effect(() => locale.subscribe(() => { patch({ localeRev: state.localeRev + 1 }) }), 'dsh-plugin-bots: locale refresh')
        }

        c.effect(() => slots.inject('shell.overlay', () => slots.register(
          { name: 'shell.overlay', id: 'dsh-plugin-bots.chat', order: 20, registrant: 'dsh-plugin-bots', locale: NS },
          () => e(BotsLayer),
        )), 'dsh-plugin-bots: chat overlay')

        // Shadow the single workspace slot at a lower priority (lowest renders);
        // the shipped entry stays registered and is delegated to by name.
        c.effect(() => slots.inject('sidebar.workspaces', () => slots.register(
          { name: 'sidebar.workspaces', priority: -100, registrant: 'dsh-plugin-bots', locale: NS },
          (props: any) => e(SidebarNav, { wide: props.wide, expandSidebar: props.expandSidebar }),
        )), 'dsh-plugin-bots: sidebar workspaces shadow')

        c.effect(() => slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'bots', order: 40, label: () => t('nav.bots'), registrant: 'dsh-plugin-bots', locale: NS },
          () => e(BotsSettings),
        )), 'dsh-plugin-bots: settings section')

        reportDiag('apply', { slots: ['shell.overlay', 'sidebar.workspaces', 'settings.section'] })
      }

      exports.apply = apply
      exports.inject = inject
      return module.exports
    },
  })
})()
