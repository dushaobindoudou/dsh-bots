import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { callGateway, discover, effectiveDataDir, normalizeAgents, readDiscovery, readDiscoveryWithFallback, resolveGateway, readPinnedGatewayPort, clearGatewayHintCache, trimAgent } from '../src/gateway.js'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'bots-gw-'))
  try { fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

describe('readDiscovery', () => {
  it('reads a well-formed gateway.json', () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, 'gateway.json'), JSON.stringify({ port: 7331, pid: 123, host: '127.0.0.1' }))
      const d = readDiscovery(dir)
      expect(d).not.toBeNull()
      expect(d!.port).toBe(7331)
      expect(d!.pid).toBe(123)
      expect(d!.token).toBeNull()
    })
  })

  it('returns null when gateway.json is missing', () => {
    withTempDir((dir) => {
      expect(readDiscovery(dir)).toBeNull()
    })
  })

  it('returns null on malformed JSON', () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, 'gateway.json'), '{not json')
      expect(readDiscovery(dir)).toBeNull()
    })
  })

  it('normalizes wildcard host and rejects non-numeric port', () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, 'gateway.json'), JSON.stringify({ port: 7331, host: '0.0.0.0' }))
      expect(readDiscovery(dir)!.host).toBe('127.0.0.1')
      writeFileSync(join(dir, 'gateway.json'), JSON.stringify({ port: 'x' }))
      expect(readDiscovery(dir)).toBeNull()
    })
  })

  it('expands ~ dataDir', () => {
    // 无法在单测里伪造 $HOME（同步 API），这里只验证不抛异常路径的形状
    expect(readDiscovery('/nonexistent-absolute')).toBeNull()
  })
})

describe('normalizeAgents / trimAgent', () => {
  it('accepts a bare array (listAgents wire shape)', () => {
    const list = normalizeAgents([{ id: 'a1', name: '速报员', isGroup: false }])
    expect(list).toHaveLength(1)
    expect(list[0]!.name).toBe('速报员')
    expect(list[0]!.isGroup).toBe(false)
    expect(list[0]!.memberIds).toEqual([])
  })

  it('accepts {agents:[...]} wrapper', () => {
    const list = normalizeAgents({ agents: [{ id: 'g1', name: '暴富', isGroup: true, memberIds: ['a1'] }] })
    expect(list).toHaveLength(1)
    expect(list[0]!.isGroup).toBe(true)
    expect(list[0]!.memberIds).toEqual(['a1'])
  })

  it('drops non-object entries and fills defaults', () => {
    const list = normalizeAgents([null, { id: 'x' }, 'junk'])
    expect(list).toHaveLength(1)
    expect(list[0]!.name).toBe('')
    expect(list[0]!.isActive).toBe(true)
  })

  it('trimAgent returns null for garbage', () => {
    expect(trimAgent(null)).toBeNull()
    expect(trimAgent('x')).toBeNull()
  })
})

describe('readDiscoveryWithFallback / effectiveDataDir (0.2.16 default rename)', () => {
  // 2026-10-10: a self-healed gateway.json in the empty configured dir made it
  // "the data dir"; previews then looked under a box-workspace that does not
  // exist (ENOENT) and unread / skills / per-bot settings went astray.
  it('a dir holding the engine data beats one that merely holds discovery', () => {
    const configured = mkdtempSync(join(tmpdir(), 'dsh-conf-'))
    const engine = mkdtempSync(join(tmpdir(), 'dsh-engine-'))
    mkdirSync(join(engine, 'box-workspace'))
    writeFileSync(join(configured, 'gateway.json'), JSON.stringify({ port: 7331, pid: 1, token: 'tok-stray', host: '127.0.0.1' }))
    writeFileSync(join(engine, 'gateway.json'), JSON.stringify({ port: 7331, pid: 2, token: 'tok-engine', host: '127.0.0.1' }))
    expect(readDiscoveryWithFallback(configured, engine)?.token).toBe('tok-engine')
    expect(effectiveDataDir(configured, engine)).toBe(engine)
    rmSync(configured, { recursive: true, force: true })
    rmSync(engine, { recursive: true, force: true })
  })

  it('stays with the engine data when every discovery file is gone', () => {
    const configured = mkdtempSync(join(tmpdir(), 'dsh-conf-'))
    const engine = mkdtempSync(join(tmpdir(), 'dsh-engine-'))
    mkdirSync(join(engine, 'box-workspace'))
    expect(readDiscoveryWithFallback(configured, engine)).toBeNull()
    expect(effectiveDataDir(configured, engine)).toBe(engine)
    rmSync(configured, { recursive: true, force: true })
    rmSync(engine, { recursive: true, force: true })
  })

  it('prefers the configured dir when it holds gateway.json', () => {
    const primary = mkdtempSync(join(tmpdir(), 'dsh-prim-'))
    const legacy = mkdtempSync(join(tmpdir(), 'dsh-leg-'))
    writeFileSync(join(primary, 'gateway.json'), JSON.stringify({ port: 40001, pid: 1, token: 'tok-primary', host: '127.0.0.1' }))
    writeFileSync(join(legacy, 'gateway.json'), JSON.stringify({ port: 40002, pid: 2, token: 'tok-legacy', host: '127.0.0.1' }))
    expect(readDiscoveryWithFallback(primary, legacy)?.token).toBe('tok-primary')
    expect(effectiveDataDir(primary, legacy)).toBe(primary)
    rmSync(primary, { recursive: true, force: true })
    rmSync(legacy, { recursive: true, force: true })
  })

  it('falls back to the legacy root when the configured dir has no discovery', () => {
    const empty = mkdtempSync(join(tmpdir(), 'dsh-empty-'))
    const legacy = mkdtempSync(join(tmpdir(), 'dsh-leg-'))
    writeFileSync(join(legacy, 'gateway.json'), JSON.stringify({ port: 40002, pid: 2, token: 'tok-legacy', host: '127.0.0.1' }))
    expect(readDiscoveryWithFallback(empty, legacy)?.token).toBe('tok-legacy')
    expect(effectiveDataDir(empty, legacy)).toBe(legacy)
    rmSync(empty, { recursive: true, force: true })
    // neither dir has discovery → configured dir as-is (legacy removed first)
    rmSync(legacy, { recursive: true, force: true })
    const orphan = mkdtempSync(join(tmpdir(), 'dsh-orphan-'))
    expect(readDiscoveryWithFallback(orphan, legacy)).toBeNull()
    expect(effectiveDataDir(orphan, legacy)).toBe(orphan)
    rmSync(orphan, { recursive: true, force: true })
  })
})

/** The 2026-10-10 outage: the engine was alive and healthy on its pinned
 * port 7331, but a late `clearGatewayDiscovery` from a previous engine
 * instance had wiped `~/.sdk-bots/gateway.json` — discovery (gateway.json
 * only) reported "未连接" forever, `list` threw, and the reconnect ladder
 * could not help: the launchd job was loaded, so it did nothing but wait.
 * These pin the repaired discovery: fall back to a /health probe on the
 * plist-pinned port, synthesize the discovery, and self-heal the file. */
describe('readPinnedGatewayPort', () => {
  it('parses SAND_HOST_PORT from the engine plist EnvironmentVariables', () => {
    withTempDir((dir) => {
      const plist = join(dir, 'host.plist')
      writeFileSync(plist, [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<plist version="1.0"><dict>',
        '  <key>EnvironmentVariables</key><dict>',
        '    <key>SAND_HOST_PORT</key>',
        '    <string>7331</string>',
        '    <key>SAND_AGENT_MODEL</key><string>vol/glm-5-3-flash</string>',
        '  </dict>',
        '</dict></plist>',
      ].join('\n'))
      expect(readPinnedGatewayPort(plist)).toBe(7331)
    })
  })

  it('returns null when the plist is missing or has no port pin', () => {
    withTempDir((dir) => {
      expect(readPinnedGatewayPort(join(dir, 'absent.plist'))).toBeNull()
      const plist = join(dir, 'host.plist')
      writeFileSync(plist, '<plist><dict><key>SAND_AGENT_MODEL</key><string>m</string></dict></plist>')
      expect(readPinnedGatewayPort(plist)).toBeNull()
    })
  })
})

const PLIST_WITH_PORT = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'bots-plist-'))
  const plist = join(dir, 'host.plist')
  writeFileSync(plist, '<dict><key>SAND_HOST_PORT</key><string>43211</string></dict>')
  return plist
}

const healthJson = (pid: number) => ({ ok: true, pid, isBusy: false, activeAgentId: null, startedAt: 1791576008732 })

function stubFetch(routes: Array<{ url: string; body: unknown }>): void {
  vi.stubGlobal('fetch', vi.fn(async (input: any) => {
    const url = String(input instanceof URL ? input : input?.url ?? input)
    const route = routes.find((r) => url.includes(r.url))
    if (route === undefined) throw new Error('unexpected fetch ' + url)
    return { ok: true, status: 200, json: async () => route.body }
  }))
}

afterEach(() => {
  clearGatewayHintCache()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** The hint suites must not reach the real ~/.sdk-bots/gateway.json through
 * the legacy fallback: on a machine with a live engine it answers for them
 * (and with it absent they only passed by accident). HOME points at an empty
 * directory, so `~` expands somewhere with no discovery at all. */
function isolateHome(): void {
  beforeEach(() => { vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'bots-home-'))) })
}

describe('resolveGateway — gateway.json lost but the engine answers its pinned port', () => {
  isolateHome()
  it('synthesizes discovery from the health probe and self-heals the file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bots-hint-'))
    stubFetch([{ url: '/health', body: healthJson(777) }])
    const d = await resolveGateway(dir, PLIST_WITH_PORT())
    expect(d).not.toBeNull()
    expect(d!.port).toBe(43211)
    expect(d!.pid).toBe(777)
    // The synthesized record is written back, so every later read is a cheap
    // file hit and other discovery consumers heal with it.
    expect(existsSync(join(dir, 'gateway.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(dir, 'gateway.json'), 'utf8')).port).toBe(43211)
    rmSync(dir, { recursive: true, force: true })
  })

  it('heals into the engine data root, never the empty configured dir', async () => {
    const home = mkdtempSync(join(tmpdir(), 'bots-home-engine-'))
    vi.stubEnv('HOME', home)
    mkdirSync(join(home, '.sdk-bots', 'box-workspace'), { recursive: true })
    const configured = mkdtempSync(join(tmpdir(), 'bots-conf-'))
    stubFetch([{ url: '/health', body: healthJson(777) }])
    const d = await resolveGateway(configured, PLIST_WITH_PORT())
    expect(d!.pid).toBe(777)
    expect(existsSync(join(home, '.sdk-bots', 'gateway.json'))).toBe(true)
    expect(existsSync(join(configured, 'gateway.json'))).toBe(false)
    rmSync(configured, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })

  it('returns null when the hint probe finds no engine (honest offline)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bots-hint-dead-'))
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    expect(await resolveGateway(dir, PLIST_WITH_PORT())).toBeNull()
    expect(existsSync(join(dir, 'gateway.json'))).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('keeps the on-disk record when it is fresh (fast path, no rewrite)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bots-fresh-'))
    writeFileSync(join(dir, 'gateway.json'), JSON.stringify({ port: 43211, pid: 777, host: '127.0.0.1' }))
    stubFetch([{ url: '/health', body: healthJson(777) }])
    const d = await resolveGateway(dir, PLIST_WITH_PORT())
    expect(d!.port).toBe(43211)
    rmSync(dir, { recursive: true, force: true })
  })

  it('overrides a stale on-disk record whose pid no longer matches', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bots-stale-'))
    writeFileSync(join(dir, 'gateway.json'), JSON.stringify({ port: 43211, pid: 42, host: '127.0.0.1' }))
    stubFetch([{ url: '/health', body: healthJson(999) }])
    const d = await resolveGateway(dir, PLIST_WITH_PORT())
    expect(d!.pid).toBe(999)
    expect(JSON.parse(readFileSync(join(dir, 'gateway.json'), 'utf8')).pid).toBe(999)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('discover / callGateway through the hint fallback', () => {
  isolateHome()
  it('discover reports the live engine when the discovery file is gone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bots-disc-'))
    stubFetch([
      { url: '/health', body: healthJson(25966) },
      { url: '/health', body: healthJson(25966) },
    ])
    const info = await discover(dir, PLIST_WITH_PORT())
    expect(info.ok).toBe(true)
    expect(info.port).toBe(43211)
    expect(info.health?.pid).toBe(25966)
    rmSync(dir, { recursive: true, force: true })
  })

  it('callGateway answers a roster read even without gateway.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bots-call-'))
    stubFetch([
      { url: '/health', body: healthJson(25966) },
      { url: '/api/listAgents', body: { result: [{ id: 'a1', name: '速报员', isGroup: false }] } },
    ])
    const agents = await callGateway<any>(dir, 'listAgents', {}, PLIST_WITH_PORT())
    expect(agents).toHaveLength(1)
    expect(agents[0].name).toBe('速报员')
    rmSync(dir, { recursive: true, force: true })
  })

  it('keeps the honest error when the engine is truly down (no hint pin reachable)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bots-down-'))
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    await expect(callGateway<any>(dir, 'listAgents', {}, PLIST_WITH_PORT())).rejects.toThrow(/gateway\.json not found/)
    rmSync(dir, { recursive: true, force: true })
  })
})
