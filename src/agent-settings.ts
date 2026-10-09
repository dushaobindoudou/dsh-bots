/**
 * Per-agent settings.json: model override (plugin side).
 *
 * The ENGINE owns `agents/<agentId>/settings.json` (its SandAgentSettings
 * carries the workspace-jail keys today). The turn pipeline reads the
 * agent's `modelId` from that file (sdk-bots production-turn-run-shell-
 * adapter) and feeds it into the per-turn `sessionOptions.modelId` channel —
 * the same direct-write, next-turn-effective, no-restart contract the
 * workspace jail uses. Clearing (null) falls back to the engine-global
 * default (settings.json agentDefaultModel / launchd env), which is exactly
 * what the composer seat labels "引擎默认".
 *
 * This module mirrors the engine's file contract: it patches one key while
 * PRESERVING every unknown field (the jail keys live in the same file), and
 * writes atomically (tmp + rename) so a crash can never leave a truncated
 * settings.json — the engine fails closed on malformed config.
 * @module dsh-bots/agent-settings
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const AGENT_ID_PATTERN = /^[\w-]{1,128}$/
const SETTINGS_FILENAME = 'settings.json'

export function agentSettingsPath(dataDir: string, agentId: string): string {
  if (AGENT_ID_PATTERN.test(agentId) === false) throw new Error('invalid agentId')
  return join(dataDir, 'agents', agentId, SETTINGS_FILENAME)
}

function readRaw(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

/** Read one agent's modelId override (null = follow the engine default). */
export function readAgentModelId(dataDir: string, agentId: string): string | null {
  const raw = readRaw(agentSettingsPath(dataDir, agentId))
  const value = raw.modelId
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** Set (string) or clear (null) the agent's modelId, preserving all other
 * settings.json fields. Creates the agent dir/file when absent — the engine
 * treats a missing key the same as an absent file. */
export function writeAgentModelId(dataDir: string, agentId: string, modelId: string | null): string | null {
  const path = agentSettingsPath(dataDir, agentId)
  const raw = readRaw(path)
  const next = typeof modelId === 'string' && modelId.trim() !== '' ? modelId.trim() : null
  if (next === null) delete raw.modelId
  else raw.modelId = next
  mkdirSync(dirname(path), { recursive: true })
  const temp = path + '.tmp'
  writeFileSync(temp, JSON.stringify(raw, null, 2) + '\n', { encoding: 'utf8' })
  renameSync(temp, path)
  return next
}
