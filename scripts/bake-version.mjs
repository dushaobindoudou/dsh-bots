// Bake the package version into lib/index.js after tsc.
//
// The diag `version` field has stamped "unresolved" on every production line
// (1152 by 2026-10-09): dsh's plugin loader does not preserve an
// import.meta.url under the package root, so ownModuleVersion's manifest
// climb can never succeed there. This script replaces the
// OWN_VERSION_FALLBACK sentinel with the real version — loader-independent
// by construction. Idempotent: run it after every tsc.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const target = join(root, 'lib', 'index.js')
const source = readFileSync(target, 'utf8')
const sentinel = "const OWN_VERSION_FALLBACK = 'unresolved'"
const baked = `const OWN_VERSION_FALLBACK = ${JSON.stringify(version)}`
if (!source.includes(sentinel)) {
  if (source.includes(baked)) {
    console.log(`bake-version: lib/index.js already baked at ${version}`)
    process.exit(0)
  }
  console.error('bake-version: sentinel not found in lib/index.js — src may have drifted')
  process.exit(1)
}
writeFileSync(target, source.replace(sentinel, baked))
console.log(`bake-version: lib/index.js diag version baked at ${version}`)
