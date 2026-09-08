// Integration check for dsh-bots: import the built host half and
// assert the plugin surface and the Typert remote-method markers survived the
// build (source-mode discovery depends on those prototype markers).
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const plugin = await import('../lib/index.js')
const typert = await import('@deepseek-ai/dsh-typert-protocol')

const EXPECTED = [
  'gatewayInfo', 'list', 'workspaces', 'sessions',
  'create', 'createGroup', 'setGroupMembers', 'groupCap', 'pin', 'setHidden', 'update', 'remove', 'send', 'interrupt', 'readImage', 'openFile', 'transcriptTail',
  'markRead', 'diag', 'eventsSince', 'sseState',
  'mcpServers', 'mcpTools', 'mcpAdd', 'mcpRemove', 'mcpRefresh', 'mcpExecute',
  'workspaceList', 'workspaceGet', 'workspaceSet', 'modelConfig', 'setModelConfig',
]

let failed = 0
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ' — ' + detail : ''}`)
  if (!ok) failed += 1
}

check('exports.name === dsh-bots', plugin.name === 'dsh-bots')
check('exports.inject is an array (deliberately empty: guarded lazy ctx.get)',
  Array.isArray(plugin.inject), JSON.stringify(plugin.inject))
check('exports.apply is a function', typeof plugin.apply === 'function')
check('exports.assertPeerCompatible is a function', typeof plugin.assertPeerCompatible === 'function')
check('exports.BotsRemote class for marker diagnostics', typeof plugin.BotsRemote === 'function')

// remoteMethods() reads markers off the prototype of a service instance; a
// bare object with the class prototype is enough — no Cordis ctx needed.
const markers = typert.remoteMethods(Object.create(plugin.BotsRemote.prototype))
  .map((m) => m.method)
const missing = EXPECTED.filter((m) => !markers.includes(m))
check(`remoteMethods covers all ${EXPECTED.length} endpoints`, missing.length === 0,
  missing.length === 0 ? markers.join(',') : 'missing: ' + missing.join(','))

if (failed === 0) {
  console.log('integration: all checks passed')
} else {
  console.error(`integration: ${failed} check(s) failed`)
  process.exit(1)
}
