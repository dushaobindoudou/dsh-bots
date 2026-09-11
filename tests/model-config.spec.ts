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
const CLIENT = readFileSync(join(ROOT, 'src', 'client.ts'), 'utf8')

describe('engine model knob (host)', () => {
  it('reads the effective model off the engine launchd job', () => {
    expect(HOST).toContain("const ENGINE_LAUNCHD_LABEL = 'com.sdk-bots.host'")
    expect(HOST).toContain("join(homedir(), 'Library', 'LaunchAgents'")
    expect(HOST).toMatch(/private engineModelInfo\(\): \{ modelId: string \| null/)
    expect(HOST).toMatch(/<key>SAND_OPENROUTER_MODEL<\\\/key>/)
  })

  it('writes both model env keys and RELOADS the job to apply a pick', () => {
    expect(HOST).toMatch(/ENGINE_MODEL_ENV_KEYS = \['SAND_OPENROUTER_MODEL', 'SAND_AGENT_MODEL'\]/)
    expect(HOST).toMatch(/for \(const key of ENGINE_MODEL_ENV_KEYS\)/)
    // launchd caches the loaded definition: kickstart alone restarts the OLD
    // env, so the plist edit never reaches the process.
    expect(HOST).toMatch(/run\(\['bootout', target\]\)/)
    expect(HOST).toMatch(/run\(\['bootstrap', `gui\/\$\{uid\}`, ENGINE_PLIST\]\)/)
    expect(HOST).toMatch(/run\(\['kickstart', target\]\)/)
    expect(HOST).toMatch(/return \{ modelId, restarted: started, reloaded \}/)
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
    expect(CLIENT).toMatch(/DSH · \$\{p\.name\}（\$\{p\.models\.length\}）/)
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

  it('tells the truth about when a pick takes effect', () => {
    expect(CLIENT).toContain('引擎只在启动时读取模型环境变量')
    expect(CLIENT).toContain('The engine reads its model from an environment variable at startup')
  })
})
