import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readAgentModelId, writeAgentModelId } from '../src/agent-settings.js'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function fixture(): string {
  const dataDir = join(tmpdir(), 'dsh-agent-settings-' + Math.random().toString(36).slice(2))
  dirs.push(dataDir)
  return dataDir
}

describe('per-agent model override (settings.json)', () => {
  it('writes, reads and clears modelId, creating the file when absent', () => {
    const dataDir = fixture()
    expect(readAgentModelId(dataDir, 'bot')).toBeNull()
    expect(writeAgentModelId(dataDir, 'bot', 'deepseek-v4')).toBe('deepseek-v4')
    expect(readAgentModelId(dataDir, 'bot')).toBe('deepseek-v4')
    expect(writeAgentModelId(dataDir, 'bot', null)).toBeNull()
    expect(readAgentModelId(dataDir, 'bot')).toBeNull()
    const parsed = JSON.parse(readFileSync(join(dataDir, 'agents', 'bot', 'settings.json'), 'utf8')) as Record<string, unknown>
    expect('modelId' in parsed).toBe(false)
  })

  it('preserves unknown fields — the jail keys share this file', () => {
    const dataDir = fixture()
    const settingsPath = join(dataDir, 'agents', 'bot', 'settings.json')
    mkdirSync(join(dataDir, 'agents', 'bot'), { recursive: true })
    writeFileSync(settingsPath, JSON.stringify({ workspaceRoot: '/workspace/bot', workspaceAllowPaths: ['/bb'], modelId: 'old' }))
    writeAgentModelId(dataDir, 'bot', 'deepseek-v4')
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>
    expect(parsed).toMatchObject({ workspaceRoot: '/workspace/bot', workspaceAllowPaths: ['/bb'], modelId: 'deepseek-v4' })
    // Clearing the model must NOT touch the jail.
    writeAgentModelId(dataDir, 'bot', null)
    const after = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>
    expect(after).toMatchObject({ workspaceRoot: '/workspace/bot', workspaceAllowPaths: ['/bb'] })
  })

  it('leaves no temp file behind and rejects malformed agent ids', () => {
    const dataDir = fixture()
    writeAgentModelId(dataDir, 'bot', 'm1')
    expect(existsSync(join(dataDir, 'agents', 'bot', 'settings.json.tmp'))).toBe(false)
    expect(() => writeAgentModelId(dataDir, '../escape', 'm1')).toThrow('invalid agentId')
  })
})
