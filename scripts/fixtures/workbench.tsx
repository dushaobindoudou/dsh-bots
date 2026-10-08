/** Browser fixture: real React and plugin, simulated shell slot/RPC contract. */
import React from 'react'
import { createRoot } from 'react-dom/client'

const entries = new Map<string, any>()
let active: string | null = null
let redraw = () => {}
const layout = { selectPanel(id: string | null) { active = id; redraw() } }
const slots = {
  inject(_name: string, fn: () => any) { return fn() },
  register(options: any, render: any) { entries.set(options.name, { options, render }); return () => {} },
  entries() { return [] },
  subscribe() { return () => {} },
}
const connection = { rpc: { async call(_url: string, method: string, payload: any) {
  return fetch('/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: method.replace('bots/', ''), request: payload.args.request }) }).then(r => r.json())
} } }
const ctx = {
  get(name: string) { return ({ connection, slots, layout } as any)[name] ?? null },
  effect(fn: () => any) { return fn() },
}
function App() {
  const [, update] = React.useState(0)
  redraw = () => update(n => n + 1)
  const [folded, setFolded] = React.useState(false)
  const [showSettings, setShowSettings] = React.useState(false)
  return <div id="frame" style={{ display: 'grid', gridTemplateColumns: folded ? '80px minmax(0,1fr)' : '280px minmax(0,1fr)', height: '100vh', transition: 'grid-template-columns .1s' }}>
    <aside style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'var(--dsw-specific-sidebar-fill)' }}>
      <button onClick={() => setFolded(!folded)}>Fold sidebar</button>
      <button onClick={() => layout.selectPanel(null)}>Native workspace</button>
      <button onClick={() => setShowSettings(!showSettings)}>Plugin settings</button>
      {entries.get('sidebar.workspaces')?.render({ wide: true })}
    </aside>
    <main style={{ display: 'flex', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
      {showSettings ? <section style={{ overflow: 'auto' }}>{entries.get('settings.section')?.render({})}</section>
        : active === 'dsh-bots' ? entries.get('main')?.render({}) : <p>Native workspace content</p>}
    </main>
    <div data-shell-overlay style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>{entries.get('shell.overlay')?.render({})}</div>
  </div>
}
;(window as any).__ModuleLoader__ = { load({ factory }: any) {
  const plugin = factory((id: string) => { if (id === 'react') return React; throw new Error('Fixture uses primitive fallbacks: ' + id) })
  plugin.apply(ctx)
  createRoot(document.getElementById('root')!).render(<App />)
} }
const script = document.createElement('script'); script.src = '/client.js'; document.body.appendChild(script)
