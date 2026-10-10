// Bake build facts into the compiled halves after tsc.
//
// 1. Version: the diag `version` field has stamped "unresolved" on every
//    production line (1152 by 2026-10-09): dsh's plugin loader does not
//    preserve an import.meta.url under the package root, so
//    ownModuleVersion's manifest climb can never succeed there. The
//    OWN_VERSION_FALLBACK sentinel becomes the real version —
//    loader-independent by construction.
// 2. Host build fingerprint: dsh web loads the host half once at startup but
//    re-reads the client on every page load. A hash of the compiled host
//    files is baked into BOTH halves; the client compares its copy with the
//    one the running host reports and asks for a restart when they differ.
//    The hash is taken over the files with the sentinel still in place, so
//    rebuilding identical sources always yields the same fingerprint.
// Idempotent: run it after every tsc.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lib = join(root, 'lib')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const HOST_SENTINEL = "const HOST_BUILD = 'unbaked-host-build'"
const CLIENT_SENTINEL = "const EXPECTED_HOST_BUILD = 'unbaked-host-build'"
const BAKED_HOST = /const HOST_BUILD = '[^']*'/
const BAKED_CLIENT = /const EXPECTED_HOST_BUILD = '[^']*'/

const hash = createHash('sha256')
for (const name of readdirSync(lib).filter((f) => f.endsWith('.js') && f !== 'client.js').sort()) {
  // Normalise the two baked literals back to their sentinels before hashing.
  const text = readFileSync(join(lib, name), 'utf8')
    .replace(BAKED_HOST, HOST_SENTINEL)
    .replace(/const OWN_VERSION_FALLBACK = '[^']*'/, "const OWN_VERSION_FALLBACK = 'unresolved'")
  hash.update(name + '\0' + text + '\0')
}
const fingerprint = version + '+' + hash.digest('hex').slice(0, 16)

function bake(file, pairs) {
  const path = join(lib, file)
  let source = readFileSync(path, 'utf8')
  for (const [pattern, value, label] of pairs) {
    const hits = source.match(new RegExp(pattern.source, 'g'))?.length ?? 0
    if (hits !== 1) {
      // Zero: src drifted. More than one: a second declaration would stay
      // unbaked and silently win or lose depending on scope.
      console.error(`bake-version: expected exactly one ${label} sentinel in lib/${file}, found ${hits}`)
      process.exit(1)
    }
    source = source.replace(pattern, value)
  }
  writeFileSync(path, source)
}

bake('index.js', [
  [/const OWN_VERSION_FALLBACK = '[^']*'/, `const OWN_VERSION_FALLBACK = ${JSON.stringify(version).replace(/"/g, "'")}`, 'version'],
  [BAKED_HOST, `const HOST_BUILD = '${fingerprint}'`, 'host build'],
])
bake('client.js', [[BAKED_CLIENT, `const EXPECTED_HOST_BUILD = '${fingerprint}'`, 'expected host build']])
console.log(`bake-version: version ${version}, host build ${fingerprint}`)
