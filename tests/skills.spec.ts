import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const HOST = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8')
const CLIENT = readFileSync(join(ROOT, 'src', 'client.ts'), 'utf8')

describe('skills surface (engine workflows proxy)', () => {
  it('proxies the engine gateway skill CRUD without inventing storage', () => {
    expect(HOST).toContain("'getAgentWorkflows'")
    expect(HOST).toContain("'createAgentWorkflow'")
    expect(HOST).toContain("'updateAgentWorkflow'")
    expect(HOST).toContain("'setAgentWorkflowEnabled'")
    expect(HOST).toContain("'deleteAgentWorkflow'")
    expect(HOST).toContain("'runAgentWorkflowNow'")
    expect(HOST).toContain("'importAgentWorkflowText'")
    // No plugin-side skill persistence: the engine's global library is the store.
    expect(HOST).not.toMatch(/writeFileSync\([^)]*skill/i)
  })

  it('clamps to the engine workflow limits and never schedules from the skills UI', () => {
    expect(HOST).toMatch(/clampSkillText\(request\?\.name, 80\)/)
    expect(HOST).toMatch(/clampSkillText\(request\?\.description, 1536\)/)
    expect(HOST).toMatch(/clampSkillText\(request\?\.body, 100_000, true\)/)
    expect(HOST).toMatch(/trigger: null/)
  })

  it('requires an agentId (per-agent enablement view over the global library)', () => {
    expect(HOST).toMatch(/requireAgentId\(request\)/)
    expect(HOST).toContain("throw new Error('agentId is required')")
  })

  it('renders the settings skills card driving every RPC', () => {
    expect(CLIENT).toContain('function SkillsCard()')
    for (const rpc of ['skillsList', 'skillsSave', 'skillsEnable', 'skillsDelete', 'skillsRunNow', 'skillsImportText']) {
      expect(CLIENT).toContain(`'${rpc}'`)
    }
    expect(CLIENT).toContain("'dbs-settings-panel-skills'")
    expect(CLIENT).toContain("skills: t('settings.tab.skills')")
  })

  it('locks plugin/managed rows: toggle and edit gated on the workflow source', () => {
    // The engine refuses per-agent disablement for plugin/managed sources;
    // the UI must grey those rows out before the RPC is ever called.
    expect(CLIENT).toMatch(/row\?\.trigger == null && row\?\.source === 'workflow'/)
    expect(CLIENT).toContain("'settings.skills.lockedHint'")
  })

  it('keeps the destructive paths behind two-click confirms', () => {
    expect(CLIENT).toMatch(/confirmId !== row\.id/)
    expect(CLIENT).toContain("'settings.skills.deleteConfirm'")
  })
})
