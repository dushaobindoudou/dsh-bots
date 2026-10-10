/**
 * Model-configuration guards.
 *
 * The bots' effective model lives in the engine's launchd environment, while
 * the DSH model page renders the `llm` service catalog — the picker used to
 * show only freeroute's upstream buckets, so DeepSeek (owned by an aggregator)
 * was invisible and a pick changed nothing. These pin both halves.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOST = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8')
const LAUNCHD = readFileSync(join(ROOT, 'src', 'launchd.ts'), 'utf8')
const CLIENT = readFileSync(join(ROOT, 'src', 'client.ts'), 'utf8')

describe('engine model knob (host)', () => {
  it('reads the effective model off the engine launchd job', () => {
    // The label/plist constants live in launchd.ts since the 2026-10-10
    // reconnect rework (gateway discovery imports the plist for its
    // pinned-port hint); index.ts imports them.
    expect(LAUNCHD).toContain("export const ENGINE_LAUNCHD_LABEL = 'com.sdk-bots.host'")
    expect(LAUNCHD).toContain("join(homedir(), 'Library', 'LaunchAgents'")
    expect(HOST).toContain("ENGINE_LAUNCHD_LABEL, ENGINE_PLIST } from './launchd.js'")
    expect(HOST).toMatch(/private engineModelInfo\(\): \{ modelId: string \| null/)
    expect(HOST).toMatch(/<key>SAND_OPENROUTER_MODEL<\\\/key>/)
  })

  it('writes both model env keys and RELOADS the job via reloadLaunchdJob', () => {
    expect(HOST).toMatch(/ENGINE_MODEL_ENV_KEYS = \['SAND_OPENROUTER_MODEL', 'SAND_AGENT_MODEL'\]/)
    expect(HOST).toMatch(/for \(const key of ENGINE_MODEL_ENV_KEYS\)/)
    // launchd caches the loaded definition: kickstart alone restarts the OLD
    // env, so the plist edit never reaches the process. The bootout→wait→
    // bootstrap→kickstart orchestration is shared with the activation
    // self-check and behaviorally pinned in launchd.spec.ts.
    expect(HOST).toContain('reloadLaunchdJob({')
    expect(HOST).toMatch(/label: ENGINE_LAUNCHD_LABEL/)
    expect(HOST).toMatch(/run: realLaunchctl/)
  })

  it('surfaces reload failures instead of swallowing stderr (2026-09-18 outage)', () => {
    expect(HOST).toMatch(/errors: outcome\.errors/)
    expect(HOST).toMatch(/if \(outcome\.errors\.length > 0\)/)
    expect(HOST).toMatch(/stage: 'applyModel'/)
  })

  it('registers the apply RPC', () => {
    expect(HOST).toContain("'setModelConfig', 'applyModel',")
  })
})

describe('native model catalog (host)', () => {
  it('reads the same llm-service catalog the DSH model page renders', () => {
    expect(HOST).toMatch(/const llm: any = this\.ctx\.get\('llm'\)/)
    expect(HOST).toMatch(/llm\.listProviders\(\)/)
    expect(HOST).toMatch(/llm\.listConfigurableProviders\(\)/)
    expect(HOST).toMatch(/llm\.listModels\(provider\)/)
  })

  it('reads the deployment default from the agentDefaultModel service', () => {
    expect(HOST).toMatch(/this\.ctx\.get\('agentDefaultModel'\)/)
    expect(HOST).toMatch(/svc\.currentSelection\(\)/)
  })

  it('surfaces DeepSeek ids as their own bucket', () => {
    // freeroute groups by upstream owner (orcarouter), which is why the
    // provider list read as "no DeepSeek".
    expect(HOST).toMatch(/deepseek: probe\.models\.filter\(\(id\) => \/deepseek\/i\.test\(id\)\)/)
  })

  it('degrades to the freeroute list when the llm service is absent', () => {
    expect(HOST).toMatch(/if \(llm === null \|\| llm === undefined\) return null/)
    expect(HOST).toMatch(/catch \{\n      return null\n    \}/)
  })
})

describe('model card (client)', () => {
  it('offers a DeepSeek provider bucket above the upstream buckets', () => {
    expect(CLIENT).toContain("t('settings.model.deepseek')")
    expect(CLIENT).toMatch(/key: '__deepseek'/)
    expect(CLIENT).toMatch(/label: `DSH · \$\{pv\.name\}`/)
  })

  it('shows the effective engine model and an explicit apply action', () => {
    expect(CLIENT).toContain("t('settings.model.engine')")
    expect(CLIENT).toMatch(/typeof cfg\?\.engine\?\.modelId === 'string' \? cfg\.engine\.modelId : null/)
    expect(CLIENT).toMatch(/async function applyEngine\(modelId: string\)/)
    expect(CLIENT).toMatch(/botsCall\('applyModel', \{ modelId \}\)/)
    expect(CLIENT).toMatch(/current !== null && current !== engineModel/)
  })

  it('shows the DSH default selection as the reference', () => {
    expect(CLIENT).toMatch(/cfg\?\.native !== null && cfg\?\.native !== undefined/)
    expect(CLIENT).toContain("t('settings.model.nativeDefault', { provider: cfg.native.default.provider, model: cfg.native.default.model })")
  })

  it('shouts when the engine restart fails instead of looking successful', () => {
    expect(CLIENT).toMatch(/r\?\.restarted !== true/)
    expect(CLIENT).toContain("t('settings.model.applyFailed')")
  })

  it('tells the truth about when a pick takes effect', () => {
    expect(CLIENT).toContain('全局默认模型在 Bots 服务启动时加载')
    expect(CLIENT).toContain('The global default loads when the Bots service starts')
  })

  it('picks through the composer-style menu, not a provider select', () => {
    // One trigger opening the same grouped, searchable ModelMenu as the
    // composer seat; providers are group headers, not a first select.
    expect(CLIENT).toMatch(/function ModelCard\(\)[\s\S]{0,6000}e\(ModelMenu, \{/)
    expect(CLIENT).toMatch(/function ComposerModelPicker\([\s\S]{0,6000}e\(ModelMenu, \{/)
    expect(CLIENT).not.toMatch(/function ModelCard\(\)[\s\S]{0,8000}e\('select'/)
  })
})
