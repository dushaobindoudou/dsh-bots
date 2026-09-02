/**
 * Per-agent workspace jail configuration bridge (plugin side).
 *
 * The ENGINE owns the isolation mechanism (`sdk-bots src/host/runner/
 * agent-workspace-jail.ts`): when an agent's settings.json declares
 * `workspaceRoot`, every shell that agent runs is wrapped in a generated
 * macOS Seatbelt profile that denies file WRITES outside the agent's own
 * workspace directory (+ allowPaths + OS temp). Reads stay unrestricted so
 * shared blackboards remain readable. The jail resolves lazily per turn —
 * editing settings.json takes effect on the agent's next turn, no restart.
 *
 * This module only mirrors the engine's config contract so the plugin can
 * read and write it safely:
 *   `<dataDir>/agents/<agentId>/settings.json` →
 *     { workspaceRoot?: "/workspace/<slug>", workspaceAllowPaths?: string[] }
 *
 * Validation mirrors the engine exactly (SLUG_PATTERN, agentId pattern,
 * virtual-prefix form) because the engine FAILS CLOSED on malformed config —
 * a bad write would break the agent's turns, not silently run unjailed.
 * @module dsh-plugin-bots/workspace
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Bot-facing virtual root prefix; the daemon maps it under the box root. */
export const WORKSPACE_VIRTUAL_PREFIX = '/workspace/'

/** Same shape as the engine's `AGENT_ID_FILENAME_PATTERN`. */
const AGENT_ID_PATTERN = /^[\w-]{1,128}$/

/** Same shape as the engine's `SLUG_PATTERN` (unicode letters allowed: 录音师). */
const SLUG_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,78}$/u

/** One agent's jail config as stored on disk. */
export interface AgentWorkspaceConfig {
  agentId: string
  /** `/workspace/<slug>` when jailed, null otherwise. */
  workspaceRoot: string | null
  /** Extra host paths the jailed agent may write. */
  allowPaths: string[]
}

/** Read one agent's settings.json jail keys, preserving unknown fields. */
function readRawSettings(agentDir: string): Record<string, unknown> {
  const path = join(agentDir, 'settings.json')
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

/** Validate the `/workspace/<slug>` virtual form exactly like the engine. */
export function validateVirtualRoot(requested: string): string {
  if (typeof requested !== 'string' || !requested.startsWith(WORKSPACE_VIRTUAL_PREFIX)) {
    throw new Error(`workspaceRoot 必须是 "${WORKSPACE_VIRTUAL_PREFIX}<slug>" 形式（如 /workspace/录音师）`)
  }
  const slug = requested.slice(WORKSPACE_VIRTUAL_PREFIX.length)
  if (slug.includes('..') || slug.includes('/') || !SLUG_PATTERN.test(slug)) {
    throw new Error(`workspaceRoot 的 slug 不合法（字母/数字/点/横线/下划线，1-79 位）："${slug}"`)
  }
  return requested
}

/** Read one agent's jail config; null when the agent dir does not exist. */
export function readAgentWorkspace(dataDir: string, agentId: string): AgentWorkspaceConfig | null {
  if (typeof agentId !== 'string' || !AGENT_ID_PATTERN.test(agentId)) return null
  const agentDir = join(dataDir, 'agents', agentId)
  if (!existsSync(agentDir)) return null
  const raw = readRawSettings(agentDir)
  const allowPaths = Array.isArray(raw.workspaceAllowPaths)
    ? raw.workspaceAllowPaths.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    : []
  return {
    agentId,
    workspaceRoot: typeof raw.workspaceRoot === 'string' && raw.workspaceRoot.trim() !== ''
      ? raw.workspaceRoot.trim()
      : null,
    allowPaths,
  }
}

/** Scan every agent directory for its jail config (missing settings → unjailed). */
export function listAgentWorkspaces(dataDir: string): AgentWorkspaceConfig[] {
  const agentsDir = join(dataDir, 'agents')
  let entries: string[] = []
  try {
    entries = readdirSync(agentsDir)
  } catch {
    return []
  }
  return entries
    .filter((id) => AGENT_ID_PATTERN.test(id))
    .sort()
    .map((id) => readAgentWorkspace(dataDir, id) ?? { agentId: id, workspaceRoot: null, allowPaths: [] })
}

export interface SetAgentWorkspaceRequest {
  /** `/workspace/<slug>` to jail; null/undefined removes the jail. */
  workspaceRoot?: string | null
  /** Extra writable host paths; replaces the previous list. */
  allowPaths?: string[]
}

/**
 * Write one agent's jail keys into its settings.json, preserving every other
 * field. Creates the agent dir when missing (a freshly created bot may not
 * have its settings.json yet).
 */
export function setAgentWorkspace(
  dataDir: string,
  agentId: string,
  request: SetAgentWorkspaceRequest,
): AgentWorkspaceConfig {
  if (typeof agentId !== 'string' || !AGENT_ID_PATTERN.test(agentId)) {
    throw new Error(`agentId 不合法："${agentId}"`)
  }
  const agentDir = join(dataDir, 'agents', agentId)
  const raw = readRawSettings(agentDir)

  if (request.workspaceRoot === null || request.workspaceRoot === undefined || request.workspaceRoot === '') {
    delete raw.workspaceRoot
  } else {
    raw.workspaceRoot = validateVirtualRoot(request.workspaceRoot)
  }
  if (request.allowPaths === undefined) {
    // Leave existing allowPaths untouched unless explicitly replaced.
  } else if (Array.isArray(request.allowPaths)) {
    const cleaned = request.allowPaths.filter((v) => typeof v === 'string' && v.trim() !== '')
    if (cleaned.length === 0) delete raw.workspaceAllowPaths
    else raw.workspaceAllowPaths = cleaned
  } else {
    throw new Error('allowPaths 必须是字符串数组')
  }

  mkdirSync(agentDir, { recursive: true })
  writeFileSync(join(agentDir, 'settings.json'), JSON.stringify(raw, null, 2) + '\n', 'utf8')
  return {
    agentId,
    workspaceRoot: typeof raw.workspaceRoot === 'string' ? raw.workspaceRoot : null,
    allowPaths: Array.isArray(raw.workspaceAllowPaths)
      ? (raw.workspaceAllowPaths as string[])
      : [],
  }
}
