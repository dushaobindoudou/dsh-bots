// pkg-11：直接复用官方 dsh UI 的哈希类名（样式与官方同一份，天然一致）
// 类名来源（构建内稳定）：
//   侧栏壳  hHd-Xa_root          (dsh-client-ui-sidebar)
//   浏览根  qDHVXG_root          (dsh-client-ui-workspace WorkspaceBrowser)
//   分区头  qDHVXG_sectionHeader / qDHVXG_sectionLabel
//   行      YDXeBa_projectRow / YDXeBa_sessionRow / YDXeBa_slot / YDXeBa_title / YDXeBa_time / YDXeBa_projectText / YDXeBa_selected / YDXeBa_arrow
//   用户气泡 gdEzaW_userRow / gdEzaW_userStack / gdEzaW_bubble
//   助手    Sxvs8a_root / Sxvs8a_body
//   输入卡  uV2eYG_root / uV2eYG_card / uV2eYG_row / uV2eYG_primary
const CSS = `
/* ===== 官方规则兜底（与页面已加载的相同；重复注入无害） ===== */
.hHd-Xa_root{--dsh-sidebar-inline-padding:12px;height:100%;padding:6px var(--dsh-sidebar-inline-padding);box-sizing:border-box;background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-primary);flex-direction:column;font-size:14px;display:flex}
.qDHVXG_root{--dsh-session-list-edge-inset:var(--dsh-sidebar-inline-padding);--dsh-session-list-scrollbar-width:8px;--dsh-session-list-scrollbar-offset:2px;box-sizing:border-box;min-height:0;padding-right:var(--dsh-session-list-edge-inset);flex-direction:column;flex:1;display:flex}
.qDHVXG_sectionHeader{box-sizing:border-box;height:36px;color:var(--dsw-alias-label-tertiary);border-radius:12px;flex:none;justify-content:flex-end;align-items:center;gap:4px;margin-bottom:4px;padding-left:4px;display:flex;overflow:hidden}
.qDHVXG_sectionLabel{white-space:nowrap;opacity:1;visibility:visible;min-width:0;max-width:45%;flex:none;line-height:20px;overflow:hidden}
.YDXeBa_projectRow,.YDXeBa_sessionRow{cursor:pointer;user-select:none;color:var(--dsw-alias-label-primary);border-radius:8px;align-items:center;gap:6px;padding:0 8px;display:flex}
.YDXeBa_projectRow:hover,.YDXeBa_sessionRow:hover,.YDXeBa_sessionRow.YDXeBa_selected{background:var(--dsw-alias-interactive-bg-hover)}
.YDXeBa_projectRow{box-sizing:border-box;align-items:center;height:34px}
.YDXeBa_sessionRow{height:32px;gap:0}
.YDXeBa_slot{width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;display:inline-flex}
.YDXeBa_arrow{transition:transform .15s var(--ds-ease-in-out)}
.YDXeBa_arrowOpen{transform:rotate(90deg)}
.YDXeBa_projectText{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}
.YDXeBa_title{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:14px;line-height:20px;overflow:hidden;flex:1}
.YDXeBa_title{margin:0 6px 0 4px}
.YDXeBa_time{color:var(--dsw-alias-label-tertiary);flex:none;font-size:12px;line-height:20px}
.YDXeBa_meta{text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px;overflow:hidden}
.gdEzaW_userRow{flex-direction:column;align-items:flex-end;gap:6px;display:flex}
.gdEzaW_userStack{flex-direction:column;align-items:flex-end;gap:8px;min-width:0;max-width:min(525px,82%);display:flex}
.gdEzaW_bubble{background:var(--dsw-specific-bubble);max-width:100%;color:var(--dsw-alias-label-primary);border-radius:22px;padding:10px 16px;font-size:16px;line-height:24px}
.Sxvs8a_root{color:var(--dsw-alias-label-primary);flex-direction:column;font-size:16px;line-height:28px;display:flex}
.Sxvs8a_body{flex-direction:column;gap:16px;display:flex}
.uV2eYG_root{padding:0 var(--dsh-composer-side-clearance) 8px;flex-direction:column;align-items:center;display:flex}
.uV2eYG_card{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width);border:1px solid var(--dsw-alias-border-l2-darkmode-thin);background:var(--dsw-specific-input-major);box-shadow:var(--dsw-shadow-lv2);border-radius:22px;flex-direction:column;gap:12px;padding-top:10px;font-size:16px;line-height:24px;display:flex;position:relative}
.uV2eYG_row{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;min-width:0;padding:2px 8px 6px;display:flex}
.uV2eYG_trailing{align-items:center;min-width:0;display:flex;flex:none;gap:12px;margin-left:auto}
.uV2eYG_primary{background:var(--dsw-alias-button-info-fill);color:#fff;cursor:pointer;border:none;border-radius:999px;flex:none;place-items:center;width:34px;height:34px;transition:background-color .1s;display:grid;transform:translateY(-2px)}
.uV2eYG_primary:disabled{opacity:.5;cursor:default}

/* ===== 本插件粘合层（仅定位与官方未覆盖的缝隙） ===== */
.dsh-bots-dockwrap { position: fixed; top: 0; left: 0; bottom: 0; width: 262px; z-index: 59; pointer-events: auto;
  border-right: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1)); box-shadow: 8px 0 32px rgba(0,0,0,.14); }
.dsh-bots-dockscroll { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; }

.dsh-bots-dockhead { display: flex; align-items: center; gap: 8px; padding: 10px 8px 4px; flex: none; }
.dsh-bots-docktitle { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary, #222); flex: 1; }
.dsh-bots-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.dsh-bots-dot.on { background: #3fb950; }
.dsh-bots-dot.off { background: #f85149; }
.dsh-bots-iconbtn { border: none; background: transparent; cursor: pointer; color: var(--dsw-alias-label-secondary, #666);
  font-size: 15px; padding: 2px 6px; border-radius: 6px; }
.dsh-bots-iconbtn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06)); }
.dsh-bots-port { font-size: 12px; line-height: 20px; color: var(--dsw-alias-label-tertiary, #999); }
.dsh-bots-gen { color: var(--dsw-alias-state-business-primary, #1a6dff); font-size: 12px; line-height: 20px; animation: dsh-bots-pulse 1.2s ease-in-out infinite; }
@keyframes dsh-bots-pulse { 0%,100% { opacity: .35 } 50% { opacity: 1 } }

.dsh-bots-dockfoot { flex: none; display: flex; gap: 6px; padding: 8px 4px 4px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06)); }
.dsh-bots-btn { padding: 4px 10px; border-radius: 8px; font-size: 12px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l, rgba(0,0,0,.15));
  background: var(--dsw-alias-bg-overlay, #fafafa); color: var(--dsw-alias-label-primary, #222); }
.dsh-bots-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06)); }
.dsh-bots-btn.primary { background: var(--dsw-alias-button-info-fill, #1a6dff); border-color: transparent; color: #fff; }
.dsh-bots-btn:disabled { opacity: .45; cursor: default; }

.dsh-bots-form { display: flex; flex-direction: column; gap: 6px; padding: 10px; border-radius: 10px; margin: 4px 10px;
  border: 1px dashed var(--dsw-alias-border-l, rgba(0,0,0,.2)); }
.dsh-bots-form-row { display: flex; gap: 6px; }
.dsh-bots-members { display: flex; flex-direction: column; gap: 2px; max-height: 150px; overflow-y: auto; }
.dsh-bots-member { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 3px 6px; border-radius: 6px;
  color: var(--dsw-alias-label-primary, #222); cursor: pointer; }
.dsh-bots-member:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05)); }
.dsh-bots-member.checked { color: var(--dsw-alias-state-business-primary, #1a6dff); }
.dsh-bots-input { flex: 1; padding: 7px 10px; border-radius: 8px; font-size: 13px; min-width: 0;
  border: 1px solid var(--dsw-alias-border-l, rgba(0,0,0,.18)); background: var(--dsw-alias-bg-base, #fff);
  color: var(--dsw-alias-label-primary, #222); font-family: inherit; }
.dsh-bots-input:focus { outline: none; border-color: var(--dsw-alias-state-business-primary, #1a6dff); }
.dsh-bots-error { margin: 6px 8px 0; padding: 6px 10px; border-radius: 8px; font-size: 12px; cursor: pointer;
  background: rgba(248,81,73,.12); color: #f85149; border: 1px solid rgba(248,81,73,.35); }

/* ===== 全屏会话（官方会话度量） ===== */
.dsh-bots-chatview { position: fixed; inset: 0; z-index: 60; pointer-events: auto; display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-base, #fff); font-family: var(--dsw-font-family, inherit); }
.dsh-bots-chatbar { flex: none; display: flex; align-items: center; gap: 10px; padding: 10px 16px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08)); }
.dsh-bots-chatbar-name { font-weight: 600; font-size: 14px; color: var(--dsw-alias-label-primary, #222); }
.dsh-bots-chatbadge { font-size: 12px; line-height: 20px; color: var(--dsw-alias-label-tertiary, #999); }
.dsh-bots-thread { flex: 1; overflow-y: auto; min-height: 0; }
.dsh-bots-thread-inner { max-width: var(--dsh-chat-content-width, 760px); margin: 0 auto; padding: 24px 20px 12px; display: flex; flex-direction: column; gap: 20px; }
.dsh-bots-author { font-size: 12px; line-height: 20px; color: var(--dsw-alias-label-tertiary, #999); margin-bottom: 2px; }
.dsh-bots-bottext { white-space: pre-wrap; word-break: break-word; }
/* 输入卡内可见 textarea（官方 input 是透明覆盖层设计，这里等形替代） */
.dsh-bots-composer-input { resize: none; width: 100%; box-sizing: border-box; border: none; outline: none; background: transparent;
  font-family: var(--dsw-font-family); font-size: 16px; line-height: 24px; white-space: pre-wrap; word-break: break-word;
  padding: 4px 12px 0 16px; min-height: 52px; max-height: 200px; color: var(--dsw-alias-label-primary, #222); }
.dsh-bots-composer-input::placeholder { color: var(--dsw-alias-label-caption, #999); user-select: none; }
.dsh-bots-composer-input:focus { outline: none; }

/* ===== 设置页 ===== */
.dsh-bots-settings { padding: 20px 4px; max-width: 640px; font-family: var(--dsw-font-family, inherit); }
.dsh-bots-settings h3 { margin: 0 0 4px; font-size: 16px; color: var(--dsw-alias-label-primary, #222); }
.dsh-bots-setcard { border: 1px solid var(--dsw-alias-border-l, rgba(0,0,0,.12)); border-radius: 12px; padding: 14px 16px; margin-top: 14px; }
.dsh-bots-setrow { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--dsw-alias-label-secondary, #555); padding: 4px 0; }
.dsh-bots-setrow b { color: var(--dsw-alias-label-primary, #222); font-weight: 600; }

/* ===== 调试药丸 ===== */
.dsh-bots-pill { position: fixed; right: 18px; bottom: 18px; z-index: 61; display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 13px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.15));
  background: var(--dsw-alias-bg-layer-2, #fff); color: var(--dsw-alias-label-primary, #222);
  font-size: 13px; font-weight: 600; cursor: grab; touch-action: none; user-select: none;
  font-family: var(--dsw-font-family, inherit); box-shadow: 0 4px 16px rgba(0,0,0,.2); pointer-events: auto; }
.dsh-bots-pill:hover { border-color: var(--dsw-alias-state-business-primary, #1a6dff); }
.dsh-bots-pill.dragging { cursor: grabbing; }
.dsh-bots-pill .dsh-bots-dot { width: 7px; height: 7px; }

/* 隐藏对话流里的 Workflow 运行卡片（用户要求；停插件即恢复） */
[data-workflow-run] { display: none !important; }
`

return {
  inject: ['timer', 'slots', 'sessions', 'workspaces'],
  apply(ctx) {
    ctx.effect(() => styles.insert(CSS))

    const diagSeen = {}
    function diag(stage, extra) {
      const payload = Object.assign({ at: new Date().toISOString(), stage: stage }, extra || {})
      host.call('bots.diag', payload).catch(function () {})
    }

    // ===== 共享状态 =====
    let dockOpen = false
    let chatAgentId = null
    let agentsCache = []
    const subs = new Set()
    function emit() { for (const fn of subs) fn() }
    function useBotsState() {
      const [, force] = React.useState(0)
      React.useEffect(() => {
        const fn = () => force(function (n) { return n + 1 })
        subs.add(fn)
        return () => { subs.delete(fn) }
      }, [])
      return { dockOpen: dockOpen, chatAgentId: chatAgentId, agents: agentsCache }
    }

    async function call(method, args) {
      try { return { ok: true, data: await host.call(method, args || {}) } }
      catch (e) { return { ok: false, error: String((e && e.message) || e) } }
    }

    const e = React.createElement
    diag('apply', { version: 'pkg-12' })

    // ===== 官方图标（SVG 路径逐字节复刻自 dsh-web-frontend 构建产物） =====
    function IconFolderOpen16(props) {
      return e('svg', { width: props.size || 16, height: props.size || 16, className: props.className, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' },
        e('path', { d: 'M5.19629 1.57104C5.81144 1.5711 6.38623 1.8786 6.72754 2.39038L7.19922 3.09839C7.28454 3.22635 7.42824 3.30344 7.58203 3.30347H12.1699C13.5039 3.30348 14.5859 4.38548 14.5859 5.71948V6.62671C15.2694 7.02689 15.6605 7.85012 15.4385 8.68726L14.3848 12.658C14.1037 13.7164 13.1449 14.4527 12.0498 14.4529H2.91699C1.51651 14.4529 0.451662 13.2814 0.501954 11.9519V3.98706C0.501954 2.65305 1.58396 1.57104 2.91797 1.57104H5.19629ZM3.7793 7.75562C3.30994 7.75562 2.89883 8.07153 2.77832 8.52515L1.91602 11.7722C1.74167 12.4291 2.23734 13.073 2.91699 13.073H12.0498C12.5191 13.0728 12.9304 12.757 13.0508 12.3035L14.1045 8.33374C14.1819 8.04202 13.9619 7.756 13.6602 7.75562H3.7793ZM2.91797 2.9519C2.34625 2.9519 1.88281 3.41534 1.88281 3.98706V7.2937C2.33068 6.7269 3.02249 6.37476 3.7793 6.37476H13.2051V5.71948C13.2051 5.14777 12.7416 4.68434 12.1699 4.68433H7.58203C6.96675 4.6843 6.39209 4.37595 6.05078 3.86401L5.5791 3.15601C5.49379 3.02821 5.34995 2.95196 5.19629 2.9519H2.91797Z', fill: 'currentColor' }),
        e('path', { opacity: '0.2', d: 'M13.6602 7.75525C13.9618 7.7556 14.1815 8.04179 14.1045 8.33337L13.0508 12.3031C12.9304 12.7567 12.5191 13.0725 12.0498 13.0726H2.91701C2.23744 13.0725 1.7417 12.4287 1.91603 11.7719L2.77834 8.52478C2.89898 8.07146 3.31018 7.75532 3.77931 7.75525H13.6602ZM5.1963 2.95154C5.34985 2.95159 5.49377 3.02803 5.57912 3.15564L6.0508 3.86365C6.39205 4.37553 6.96685 4.68385 7.58205 4.68396H12.1699C12.7416 4.68396 13.2049 5.14754 13.2051 5.71912V6.37439H3.77931C3.02267 6.37444 2.33067 6.72671 1.88283 7.29333V3.98669C1.88299 3.4152 2.34649 2.95168 2.91798 2.95154H5.1963Z', fill: 'currentColor' }))
    }
    function IconFolderClose16(props) {
      return e('svg', { width: props.size || 16, height: props.size || 16, className: props.className, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' },
        e('path', { transform: 'translate(1.5 2.429)', d: 'M5.05582 0.518756L4.50669 0.86654L5.05582 0.518756ZM13 9.4837L13.65 9.4837L13.65 3.53962L13 3.53962L12.35 3.53962L12.35 9.4837L13 9.4837ZM11.3264 1.86603L11.3264 1.21603L6.52313 1.21603L6.52313 1.86603L6.52313 2.51603L11.3264 2.51603L11.3264 1.86603ZM5.58054 1.34727L6.12968 0.999489L5.60495 0.170972L5.05582 0.518756L4.50669 0.86654L5.03141 1.69506L5.58054 1.34727ZM4.11323 1.23058e-13L4.11323 -0.65L1.67359 -0.65L1.67359 5.00699e-14L1.67359 0.65L4.11323 0.65L4.11323 1.23058e-13ZM0 1.67359L-0.65 1.67359L-0.65 9.4837L0 9.4837L0.65 9.4837L0.65 1.67359L0 1.67359ZM11.3264 11.1573L11.3264 10.5073L1.67359 10.5073L1.67359 11.1573L1.67359 11.8073L11.3264 11.8073L11.3264 11.1573ZM0 9.4837L-0.65 9.4837C-0.65 10.767 0.390308 11.8073 1.67359 11.8073L1.67359 11.1573L1.67359 10.5073C1.10828 10.5073 0.65 10.049 0.65 9.4837L0 9.4837ZM1.67359 5.00699e-14L1.67359 -0.65C0.390307 -0.65 -0.65 0.390309 -0.65 1.67359L0 1.67359L0.65 1.67359C0.65 1.10828 1.10828 0.65 1.67359 0.65L1.67359 5.00699e-14ZM5.05582 0.518756L5.60495 0.170972C5.28121 -0.340193 4.71829 -0.65 4.11323 -0.65L4.11323 1.23058e-13L4.11323 0.65C4.27282 0.65 4.4213 0.731715 4.50669 0.86654L5.05582 0.518756ZM6.52313 1.86603L6.52313 1.21603C6.36354 1.21603 6.21507 1.13431 6.12968 0.999489L5.58054 1.34727L5.03141 1.69506C5.35515 2.20622 5.91808 2.51603 6.52313 2.51603L6.52313 1.86603ZM13 3.53962L13.65 3.53962C13.65 2.25634 12.6097 1.21603 11.3264 1.21603L11.3264 1.86603L11.3264 2.51603C11.8917 2.51603 12.35 2.97431 12.35 3.53962L13 3.53962ZM13 9.4837L12.35 9.4837C12.35 10.049 11.8917 10.5073 11.3264 10.5073L11.3264 11.1573L11.3264 11.8073C12.6097 11.8073 13.65 10.767 13.65 9.4837L13 9.4837Z', fill: 'currentColor' }))
    }
    function IconTriangleRightFill14(props) {
      return e('svg', { width: props.size || 14, height: props.size || 14, className: props.className, viewBox: '0 0 14 14', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' },
        e('path', { d: 'M4.25 2.82782L4.25 11.1722C4.25 11.6622 4.84243 11.9076 5.18891 11.5611L9.36109 7.38891C9.57588 7.17412 9.57588 6.82588 9.36109 6.61109L5.18891 2.43891C4.84243 2.09243 4.25 2.33782 4.25 2.82782Z', fill: 'currentColor' }))
    }
    function IconSendUp16() {
      return e('svg', { viewBox: '0 0 16 16', width: '16', height: '16', 'aria-hidden': true },
        e('path', { d: 'M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z', fill: 'currentColor' }))
    }
    function IconStop16() {
      return e('svg', { viewBox: '0 0 16 16', width: '16', height: '16', 'aria-hidden': true },
        e('rect', { x: '3', y: '3', width: '10', height: '10', rx: '3', fill: 'currentColor' }))
    }

    // ===== 官方行组件（类名与 DOM 结构照抄 dsh-client-ui-workspace） =====
    function OfficialSectionLabel(text) {
      return e('div', { className: 'qDHVXG_sectionHeader' },
        e('span', { className: 'qDHVXG_sectionLabel' }, text))
    }
    // 工作区行（可折叠分组头，官方 folder+chevron 图标）
    function OfficialProjectRow(props) {
      return e('div', {
        className: 'YDXeBa_projectRow',
        role: 'treeitem',
        'aria-expanded': props.expanded,
        onClick: props.onToggle,
      },
        e('span', { className: 'YDXeBa_slot' }, props.expanded ? e(IconFolderOpen16, null) : e(IconFolderClose16, null)),
        e('span', { className: 'YDXeBa_slot' },
          e(IconTriangleRightFill14, { className: 'YDXeBa_arrow' + (props.expanded ? ' YDXeBa_arrowOpen' : '') })),
        e('span', { className: 'YDXeBa_projectText' },
          e('span', { className: 'YDXeBa_title' }, props.title)))
    }
    // 会话行（slot+title+time；选中态官方同款）
    function OfficialSessionRow(props) {
      return e('div', {
        className: 'YDXeBa_sessionRow' + (props.selected ? ' YDXeBa_selected' : ''),
        role: 'treeitem',
        'aria-selected': !!props.selected,
        onClick: props.onOpen,
      },
        e('span', { className: 'YDXeBa_slot' }, props.slot || null),
        e('span', { className: 'YDXeBa_title' }, props.title),
        props.time ? e('span', { className: 'YDXeBa_time' }, props.time) : null)
    }

    // ===== 调试药丸 =====
    function BotsPill() {
      const s = useBotsState()
      const [pos, setPos] = React.useState(null)
      const [dragging, setDragging] = React.useState(false)
      const st = React.useRef(null)

      function onPointerDown(ev) {
        const el = ev.currentTarget
        const rect = el.getBoundingClientRect()
        st.current = { dx: ev.clientX - rect.left, dy: ev.clientY - rect.top, startX: ev.clientX, startY: ev.clientY, moved: false }
        try { el.setPointerCapture(ev.pointerId) } catch (err) {}
      }
      function onPointerMove(ev) {
        if (st.current == null) return
        if (!st.current.moved && Math.abs(ev.clientX - st.current.startX) + Math.abs(ev.clientY - st.current.startY) > 4) {
          st.current.moved = true
          setDragging(true)
        }
        if (st.current.moved) {
          setPos({ x: Math.max(6, ev.clientX - st.current.dx), y: Math.max(6, ev.clientY - st.current.dy) })
        }
      }
      function onPointerUp(ev) {
        if (st.current != null && !st.current.moved) { dockOpen = !s.dockOpen; emit() }
        st.current = null
        setDragging(false)
        try { ev.currentTarget.releasePointerCapture(ev.pointerId) } catch (err) {}
      }

      return e('button', {
        className: 'dsh-bots-pill' + (dragging ? ' dragging' : ''),
        style: pos ? { left: pos.x + 'px', top: pos.y + 'px', right: 'auto', bottom: 'auto' } : undefined,
        onPointerDown: onPointerDown,
        onPointerMove: onPointerMove,
        onPointerUp: onPointerUp,
        onPointerCancel: onPointerUp,
        title: 'Bots 调试入口（点击开关坞，可拖动）',
      }, '🤖', e('span', { className: 'dsh-bots-dot ' + (s.dockOpen ? 'on' : 'off') }))
    }

    // ===== 左侧坞：官方侧栏壳 + 官方行体系 =====
    function BotsDock() {
      const [info, setInfo] = React.useState(null)
      const [agents, setAgents] = React.useState(null)
      const [workspaces, setWorkspaces] = React.useState(null)
      const [sessions, setSessions] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [collapsed, setCollapsed] = React.useState({})
      const [form, setForm] = React.useState(null)
      const [formName, setFormName] = React.useState('')
      const [formDesc, setFormDesc] = React.useState('')
      const [formMembers, setFormMembers] = React.useState({})
      const [working, setWorking] = React.useState(false)

      async function refreshInfo() {
        const r = await call('bots.gatewayInfo', {})
        if (r.ok) setInfo(r.data)
        else setError(r.error)
      }
      async function refreshList() {
        const r = await call('bots.list', {})
        if (r.ok) { setAgents(r.data || []); agentsCache = r.data || [] }
        else setError(r.error)
      }
      async function refreshWorkspaces() {
        const r = await call('bots.workspaces', {})
        if (r.ok) setWorkspaces((r.data && r.data.workspaces) || [])
      }
      async function refreshSessions() {
        const r = await call('bots.sessions', {})
        if (r.ok && r.data && r.data.sessions && r.data.sessions.length > 0) {
          setSessions(r.data.sessions.map(function (it) { return { id: it.id, title: it.title } }))
          return
        }
        try {
          const ac = (typeof AbortController !== 'undefined') ? new AbortController() : null
          const res = await ctx.sessions.search('', ac ? ac.signal : undefined)
          const items = (res && Array.isArray(res.items)) ? res.items
            : (res && res.value && Array.isArray(res.value.items)) ? res.value.items : []
          setSessions(items.slice(0, 10).map(function (it) {
            return { id: it.sessionId || it.id, title: it.title || it.name || '未命名会话' }
          }))
        } catch (err) { setSessions([]) }
      }

      React.useEffect(function () {
        refreshInfo(); refreshList(); refreshWorkspaces(); refreshSessions()
        const stop = ctx.interval(function () { refreshList(); refreshInfo() }, 10000)
        return function () { stop() }
      }, [])

      function toggleSec(k) {
        const next = {}
        for (const key of Object.keys(collapsed)) next[key] = collapsed[key]
        next[k] = !next[k]
        setCollapsed(next)
      }
      function secCollapsed(k) { return !!collapsed[k] }

      async function openWorkspace(id) {
        try {
          const sid = await ctx.workspaces.connectWorkspace(id)
          if (sid) ctx.sessions.open(sid)
        } catch (err) { setError(String((err && err.message) || err)) }
      }

      async function doCreateBot() {
        const name = formName.trim()
        if (!name || working) return
        setWorking(true); setError(null)
        const r = await call('bots.create', { name: name, description: formDesc.trim() })
        if (!r.ok) setError(r.error)
        else { setForm(null); setFormName(''); setFormDesc(''); await refreshList() }
        setWorking(false)
      }
      async function doCreateGroup() {
        const name = formName.trim()
        const memberIds = Object.keys(formMembers).filter(function (k) { return formMembers[k] })
        if (!name || memberIds.length === 0 || working) return
        setWorking(true); setError(null)
        const r = await call('bots.createGroup', { name: name, memberIds: memberIds })
        if (!r.ok) setError(r.error)
        else { setForm(null); setFormName(''); setFormDesc(''); setFormMembers({}); await refreshList() }
        setWorking(false)
      }
      function toggleMember(id) {
        const next = {}
        for (const k of Object.keys(formMembers)) next[k] = formMembers[k]
        next[id] = !formMembers[id]
        setFormMembers(next)
      }

      const groups = (agents || []).filter(function (a) { return a.isGroup })
      const singles = (agents || []).filter(function (a) { return !a.isGroup })
      const connected = !!(info && info.ok)

      function botRow(a) {
        return e(OfficialSessionRow, {
          key: a.id,
          selected: chatAgentId === a.id,
          slot: a.isGroup ? '👥' : null,
          title: a.name,
          time: a.isRunning ? '运行中' : null,
          onOpen: function () { chatAgentId = a.id; emit() },
        })
      }

      return e('div', { className: 'dsh-bots-dockwrap' },
        e('div', { className: 'hHd-Xa_root' },   // 官方侧栏壳：padding/背景/字体全部一致
          e('div', { className: 'dsh-bots-dockhead' },
            e('span', { className: 'dsh-bots-dot ' + (connected ? 'on' : 'off') }),
            e('span', { className: 'dsh-bots-docktitle' }, 'Bots'),
            connected ? e('span', { className: 'dsh-bots-port' }, ':' + info.port) : e('span', { className: 'dsh-bots-port' }, '未连接'),
            e('button', { className: 'dsh-bots-iconbtn', title: '刷新', onClick: function () { refreshInfo(); refreshList(); refreshWorkspaces(); refreshSessions() } }, '⟳'),
            e('button', { className: 'dsh-bots-iconbtn', title: '收起', onClick: function () { dockOpen = false; emit() } }, '✕')),
          error ? e('div', { className: 'dsh-bots-error', onClick: function () { setError(null) } }, error) : null,
          e('div', { className: 'dsh-bots-dockscroll' },
            e('div', { className: 'qDHVXG_root' },  // 官方浏览根

              // —— 工作区（官方 projectRow 折叠组） ——
              e('div', null,
                e(OfficialProjectRow, { title: '工作区', expanded: !secCollapsed('ws'), onToggle: function () { toggleSec('ws') } }),
                !secCollapsed('ws') ? e('div', null,
                  workspaces == null ? e('div', { className: 'YDXeBa_meta', style: { padding: '4px 28px' } }, '加载中…') :
                    workspaces.length === 0 ? e('div', { className: 'YDXeBa_meta', style: { padding: '4px 28px' } }, '没有工作区') :
                    workspaces.map(function (w) {
                      return e(OfficialSessionRow, { key: w.id, title: w.title || w.path || '未命名', onOpen: function () { openWorkspace(w.id) } })
                    })) : null),

              // —— 会话（最近 dsh 会话） ——
              e('div', null,
                e(OfficialProjectRow, { title: '会话', expanded: !secCollapsed('ss'), onToggle: function () { toggleSec('ss') } }),
                !secCollapsed('ss') ? e('div', null,
                  sessions == null ? e('div', { className: 'YDXeBa_meta', style: { padding: '4px 28px' } }, '加载中…') :
                    sessions.length === 0 ? e('div', { className: 'YDXeBa_meta', style: { padding: '4px 28px' } }, '没有最近会话') :
                    sessions.map(function (ss) {
                      return e(OfficialSessionRow, { key: ss.id, title: ss.title, onOpen: function () { ctx.sessions.open(ss.id) } })
                    })) : null),

              // —— Bots（群聊 / 单聊） ——
              e('div', null,
                e(OfficialProjectRow, { title: 'Bots', expanded: !secCollapsed('bt'), onToggle: function () { toggleSec('bt') } }),
                !secCollapsed('bt') ? e('div', null,
                  OfficialSectionLabel('群聊'),
                  agents == null ? e('div', { className: 'YDXeBa_meta', style: { padding: '4px 28px' } }, '加载中…') :
                    (groups.length === 0 && singles.length === 0) ? e('div', { className: 'YDXeBa_meta', style: { padding: '4px 28px' } }, '还没有 Bot，点下方「＋ Bot」新建') :
                    e('div', null,
                      groups.length === 0 ? e('div', { className: 'YDXeBa_meta', style: { padding: '4px 28px' } }, '暂无群聊') : groups.map(botRow),
                      OfficialSectionLabel('单聊'),
                      singles.length === 0 ? e('div', { className: 'YDXeBa_meta', style: { padding: '4px 28px' } }, '暂无单聊 Bot') : singles.map(botRow))) : null)),

            form === 'bot' ? e('div', { className: 'dsh-bots-form' },
              e('input', { className: 'dsh-bots-input', placeholder: 'Bot 名称', value: formName, onChange: function (ev) { setFormName(ev.target.value) } }),
              e('input', { className: 'dsh-bots-input', placeholder: '简介 / 人设（可选）', value: formDesc, onChange: function (ev) { setFormDesc(ev.target.value) } }),
              e('div', { className: 'dsh-bots-form-row' },
                e('button', { className: 'dsh-bots-btn primary', disabled: working || !formName.trim(), onClick: doCreateBot }, '创建'),
                e('button', { className: 'dsh-bots-btn', onClick: function () { setForm(null) } }, '取消'))) : null,
            form === 'group' ? e('div', { className: 'dsh-bots-form' },
              e('input', { className: 'dsh-bots-input', placeholder: '群名称', value: formName, onChange: function (ev) { setFormName(ev.target.value) } }),
              e('div', { className: 'dsh-bots-members' },
                singles.length === 0 ? e('div', { className: 'YDXeBa_meta' }, '还没有可选成员') :
                  singles.map(function (a) {
                    return e('label', { key: a.id, className: 'dsh-bots-member' + (formMembers[a.id] ? ' checked' : '') },
                      e('input', { type: 'checkbox', checked: !!formMembers[a.id], onChange: function () { toggleMember(a.id) } }),
                      e('span', null, a.name))
                  })),
              e('div', { className: 'dsh-bots-form-row' },
                e('button', { className: 'dsh-bots-btn primary', disabled: working || !formName.trim(), onClick: doCreateGroup }, '建群'),
                e('button', { className: 'dsh-bots-btn', onClick: function () { setForm(null) } }, '取消'))) : null),
          e('div', { className: 'dsh-bots-dockfoot' },
            e('button', { className: 'dsh-bots-btn', onClick: function () { setForm(form === 'bot' ? null : 'bot'); setFormName(''); setFormDesc('') } }, '＋ Bot'),
            e('button', { className: 'dsh-bots-btn', onClick: function () { setForm(form === 'group' ? null : 'group'); setFormName(''); setFormMembers({}) } }, '＋ 群'))))
    }

    // ===== 全屏会话（官方消息/输入卡类名） =====
    function ChatView(props) {
      const agentId = props.agentId
      const [entries, setEntries] = React.useState(null)
      const [input, setInput] = React.useState('')
      const [error, setError] = React.useState(null)
      const [working, setWorking] = React.useState(false)

      async function refreshTail() {
        const r = await call('bots.transcriptTail', { id: agentId, limit: 60 })
        if (r.ok) setEntries((r.data && r.data.entries) || [])
      }
      async function refreshList() {
        const r = await call('bots.list', {})
        if (r.ok) agentsCache = r.data || []
        emit()
      }

      React.useEffect(function () {
        refreshTail(); refreshList()
        const stop = ctx.interval(function () { refreshTail(); refreshList() }, 3000)
        return function () { stop() }
      }, [agentId])

      const agent = agentsCache.filter(function (a) { return a.id === agentId })[0]
      const isGroup = !!(agent && agent.isGroup)
      const generating = !!(agent && agent.isRunning)

      async function doSend() {
        const text = input.trim()
        if (!text || working) return
        setWorking(true); setError(null); setInput('')
        const r = await call('bots.send', { agentId: agentId, prompt: text })
        if (!r.ok) { setError(r.error); setInput(text) }
        await refreshTail(); await refreshList()
        setWorking(false)
      }

      function renderEntry(en) {
        if (en.kind === 'message' && en.role === 'user') {
          // 官方用户消息 DOM：userRow > userStack > bubble
          return e('div', { key: en.id, className: 'gdEzaW_userRow' },
            e('div', { className: 'gdEzaW_userStack' },
              e('div', { className: 'gdEzaW_bubble' }, en.content || '')))
        }
        if (en.kind === 'send-message') {
          // 官方助手 DOM：root > body；正文纯文本（markdown 渲染待 M4）
          return e('div', { key: en.id, className: 'Sxvs8a_root' },
            e('div', { className: 'dsh-bots-author' }, isGroup && en.authorName ? en.authorName : null),
            e('div', { className: 'Sxvs8a_body' },
              e('div', { className: 'dsh-bots-bottext' }, en.content || '')))
        }
        return null
      }

      return e('div', { className: 'dsh-bots-chatview' },
        e('div', { className: 'dsh-bots-chatbar' },
          e('button', { className: 'dsh-bots-iconbtn', title: '返回', onClick: function () { chatAgentId = null; emit() } }, '‹'),
          e('span', { className: 'dsh-bots-chatbar-name' }, agent ? agent.name : '…'),
          e('span', { className: 'dsh-bots-chatbadge' }, isGroup ? '群聊 · ' + (agent ? agent.memberIds.length : 0) + ' 成员' : '单聊'),
          generating ? e('span', { className: 'dsh-bots-gen' }, '生成中…') : null),
        error ? e('div', { className: 'dsh-bots-error', onClick: function () { setError(null) } }, error) : null,
        e('div', { className: 'dsh-bots-thread' },
          e('div', { className: 'dsh-bots-thread-inner' },
            entries == null ? e('div', { className: 'YDXeBa_meta' }, '加载中…') :
              entries.length === 0 ? e('div', { className: 'YDXeBa_meta' }, '还没有消息，发一条试试') :
              entries.map(renderEntry))),
        e('div', { className: 'uV2eYG_root' },
          e('div', { className: 'uV2eYG_card' },
            e('textarea', {
              className: 'dsh-bots-composer-input',
              value: input,
              rows: 1,
              placeholder: isGroup ? '@名字 可定向，默认全员' : '给 ' + (agent ? agent.name : '') + ' 发消息…',
              onChange: function (ev) { setInput(ev.target.value) },
              onKeyDown: function (ev) { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); doSend() } },
            }),
            e('div', { className: 'uV2eYG_row' },
              e('span', { className: 'YDXeBa_meta' }, input.trim().length > 0 ? input.trim().length + ' 字' : ''),
              e('div', { className: 'uV2eYG_trailing' },
                e('button', { className: 'uV2eYG_primary', disabled: working || (!input.trim() && !generating), onClick: doSend, title: generating ? '生成中' : '发送', 'aria-label': generating ? '生成中' : '发送' }, generating ? e(IconStop16, null) : e(IconSendUp16, null)))))))
    }

    // ===== 设置页 =====
    function BotsSettings() {
      const [info, setInfo] = React.useState(undefined)
      const [err, setErr] = React.useState(null)

      async function refresh() {
        setInfo(undefined); setErr(null)
        const r = await call('bots.gatewayInfo', {})
        if (r.ok) setInfo(r.data)
        else setErr(r.error)
      }
      React.useEffect(function () { refresh() }, [])

      return e('div', { className: 'dsh-bots-settings' },
        e('h3', null, 'Bots'),
        e('div', { className: 'dsh-bots-setrow' }, '多 Bot 工作台（sdk-bots 网关桥接）'),
        e('div', { className: 'dsh-bots-setcard' },
          e('div', { className: 'dsh-bots-setrow' },
            e('span', { className: 'dsh-bots-dot ' + (info && info.ok ? 'on' : 'off') }),
            info === undefined ? '检测中…' : info && info.ok ? e('b', null, '网关在线 :' + info.port) : e('b', null, '网关未连接'),
            e('span', { style: { flex: 1 } }),
            e('button', { className: 'dsh-bots-btn', onClick: refresh }, '刷新')),
          info && info.ok ? e('div', null,
            e('div', { className: 'dsh-bots-setrow' }, '地址：', e('b', null, info.baseUrl)),
            e('div', { className: 'dsh-bots-setrow' }, 'PID：', e('b', null, String(info.pid)), info.health && info.health.isBusy ? ' · 忙' : ''),
            e('div', { className: 'dsh-bots-setrow' }, '鉴权：', e('b', null, info.hasToken ? 'token（自动携带）' : '无（loopback 免鉴权）'))) : null,
          info && !info.ok ? e('div', { className: 'dsh-bots-setrow' }, '原因：', info.reason || '') : null,
          err ? e('div', { className: 'dsh-bots-setrow' }, err) : null),
        e('div', { className: 'dsh-bots-setcard' },
          e('div', { className: 'dsh-bots-setrow' }, '数据目录：', e('b', null, '~/.sdk-bots')),
          e('div', { className: 'dsh-bots-setrow' }, '会话轮询：3s（M2 将升级为 SSE 中转）'),
          e('div', { className: 'dsh-bots-setrow' }, '右下角 🤖 药丸为调试入口（点击开坞、可拖动）'),
          e('div', { className: 'dsh-bots-setrow' },
            e('button', { className: 'dsh-bots-btn primary', onClick: function () { dockOpen = true; emit() } }, '打开 Bots 坞'))))
    }

    // ===== 浮层根 =====
    function BotsLayer() {
      const s = useBotsState()
      return e('div', null,
        e(BotsPill),
        s.dockOpen ? e(BotsDock) : null,
        s.chatAgentId ? e(ChatView, { agentId: s.chatAgentId }) : null)
    }

    // ===== Slot 注册 =====
    ctx.effect(() => {
      const disposers = []
      try {
        disposers.push(ctx.slots.inject('shell.overlay', () => {
          diag('inject-callback', { slot: 'shell.overlay' })
          try {
            return ctx.slots.register(
              { name: 'shell.overlay', id: 'dsh-bots-layer', order: 20, label: 'Bots' },
              () => { if (!diagSeen.overlay) { diagSeen.overlay = 1; diag('render', { slot: 'shell.overlay' }) } return e(BotsLayer) },
            )
          } catch (err) { diag('register-error', { slot: 'shell.overlay', error: String(err) }) }
        }))
      } catch (err) { diag('inject-error', { slot: 'shell.overlay', error: String(err) }) }

      try {
        disposers.push(ctx.slots.inject('settings.section', () => {
          diag('inject-callback', { slot: 'settings.section' })
          try {
            return ctx.slots.register(
              { name: 'settings.section', id: 'bots', order: 40, label: 'Bots' },
              () => { if (!diagSeen.settings) { diagSeen.settings = 1; diag('render', { slot: 'settings.section' }) } return e(BotsSettings) },
            )
          } catch (err) { diag('register-error', { slot: 'settings.section', error: String(err) }) }
        }))
      } catch (err) { diag('inject-error', { slot: 'settings.section', error: String(err) }) }

      return () => { for (const d of disposers) { try { d() } catch (err2) {} } }
    })
  },
}
