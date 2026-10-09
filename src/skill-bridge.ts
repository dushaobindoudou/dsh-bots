/**
 * dsh skill bridge (plugin side): surface the harness's own skill roots to
 * the bots engine through the engine's plugin-skills channel.
 *
 * The ENGINE owns the whole skill system (sdk-bots `src/host/workflows/
 * workflow-store.ts`): it watches `<sandRoot>/plugin-skills/` for a
 * `cache.json` index of PluginSkillRecord rows (id / pluginId / name /
 * description + an ABSOLUTE filePath) and re-reads the pointed file with a
 * stat-keyed parse cache on every listing. That makes LIVE pointers safe:
 * our entries carry the original dsh paths, so harness-side edits propagate
 * on the next engine list with nothing to copy, and a vanished file simply
 * drops out of the catalog (the engine's own drop-on-error policy).
 *
 * Skill file format is shared with dsh by construction: directory bundles
 * `<name>/SKILL.md` or flat `<name>.md`, YAML frontmatter with `name` /
 * `description`. The engine preserves `disable-model-invocation`: such
 * skills remain available for explicit user selection in the @ menu,
 * while staying out of automatic model discovery.
 *
 * The engine catalog lives in cache.json; explicit exclusions are persisted
 * separately so new installations can be discovered automatically:
 *   - first sync (no cache.json): bridge everything discovered;
 *   - later syncs reconcile and automatically share newly installed skills;
 *     explicit exclusions live in dsh-bots-skill-bridge.json. Other plugins
 *     retain ownership of their cache records and authentication fields.
 * @module dsh-bots/skill-bridge
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, renameSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The engine's plugin-skills dir name and cache file (workflow-store.ts). */
export const PLUGIN_SKILLS_DIRNAME = 'plugin-skills'
export const PLUGIN_SKILLS_CACHE_FILENAME = 'cache.json'

/** dsh skill roots, in the harness's own precedence order (highest first). */
export function dshSkillRoots(home: string): string[] {
  return [join(home, '.dsh', 'skills'), join(home, '.agents', 'skills'), join(home, '.codex', 'skills')]
}

/** Same id grammar as the engine's `isSafePluginSkillId`. */
const SKILL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** kebab-case slug for ids; empty input collapses to "skill". */
export function slugifySkillId(raw: string): string {
  const slug = raw.normalize('NFKD').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/g, '')
  return slug === '' ? 'skill' : slug
}

/** One discovered dsh skill (not yet necessarily bridged). */
export interface DshSkillRef {
  id: string
  name: string
  description: string
  disableModelInvocation: boolean
  /** Original file path — bridged entries point HERE (live semantics). */
  filePath: string
  root: string
}

/** Minimal frontmatter read: only the fields the bridge needs. The engine
 * re-parses the full file itself, so this must merely agree on name and
 * description. */
export function parseSkillFrontmatter(raw: string): { name?: string; description?: string; disableModelInvocation: boolean } {
  const lines = raw.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { disableModelInvocation: false }
  let name: string | undefined
  let description: string | undefined
  let disableModelInvocation = false
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '---') break
    const match = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(line.trim())
    if (match == null) continue
    let value = match[2].trim().replace(/^['"]|['"]$/g, '')
    if (/^[>|][-+]?$/.test(value)) {
      const folded = value.startsWith('>')
      const block: string[] = []
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) block.push(lines[++i].trim())
      value = block.join(folded ? ' ' : '\n')
    }
    if (match[1] === 'name' && name === undefined) name = value
    else if (match[1] === 'description' && description === undefined) description = value
    else if (match[1] === 'disable-model-invocation' && value.toLowerCase() === 'true') disableModelInvocation = true
  }
  return { name, description, disableModelInvocation }
}

/** Discover dsh skills across the roots — top level only (dsh's own depth
 * rule), directory bundles before flat files, deterministic order. */
export function discoverDshSkills(home: string, additionalRoots: readonly string[] = []): DshSkillRef[] {
  const seen = new Set<string>()
  const refs: DshSkillRef[] = []
  const names = new Set<string>()
  const paths = new Set<string>()
  for (const root of [...dshSkillRoots(home), ...additionalRoots]) {
    let entries: import('node:fs').Dirent[] = []
    try { entries = readdirSync(root, { withFileTypes: true }) } catch { continue }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.system' || entry.name.startsWith('.')) continue
      let isDirectory = entry.isDirectory()
      if (entry.isSymbolicLink()) { try { isDirectory = statSync(join(root, entry.name)).isDirectory() } catch { continue } }
      const filePath = isDirectory
        ? join(root, entry.name, 'SKILL.md')
        : (/\.(md|markdown)$/i.test(entry.name) ? join(root, entry.name) : '')
      if (filePath === '' || !existsSync(filePath)) continue
      let raw = ''
      try { raw = readFileSync(filePath, 'utf8') } catch { continue }
      const meta = parseSkillFrontmatter(raw)
      const canonical = realpathSync(filePath)
      const name = meta.name?.trim() || entry.name.replace(/\.(md|markdown)$/i, '')
      if (paths.has(canonical) || names.has(name.toLowerCase())) continue
      paths.add(canonical); names.add(name.toLowerCase())
      const slug = slugifySkillId(entry.name.replace(/\.(md|markdown)$/i, ''))
      let id = 'dsh-' + slug
      for (let n = 2; seen.has(id); n++) id = 'dsh-' + slug + '-' + n
      seen.add(id)
      refs.push({
        id,
        name: meta.name !== undefined && meta.name !== '' ? meta.name : slug,
        description: meta.description ?? '',
        disableModelInvocation: meta.disableModelInvocation,
        filePath,
        root,
      })
    }
  }
  return refs
}

export interface BridgeCache {
  fetchedAt: number
  currentUserId: number | null
  authBlocked: unknown[]
  skills: Array<{
    id: string; pluginId: string; pluginName: string; name: string; description: string
    filePath: string; pluginVersion: string; installPath: string; skillRelativePath: string
    publisherUserId: number | null; marketplaceTeamId: number | null
  }>
}

/** Read the current bridge state (null = never synced). */
export function readBridgeCache(cachePath: string): { fetchedAt: number; ids: string[] } | null {
  if (!existsSync(cachePath)) return null
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as Partial<BridgeCache>
    const fetchedAt = typeof parsed.fetchedAt === 'number' ? parsed.fetchedAt : Number.NaN
    if (!Number.isFinite(fetchedAt) || !Array.isArray(parsed.skills)) return null
    return { fetchedAt, ids: parsed.skills.map((s) => s.id) }
  } catch {
    return null
  }
}

/** Write the index atomically with the engine's own readability modes, so a
 * crash mid-write can never leave the engine a truncated cache. */
export function writeBridgeCache(cachePath: string, cache: BridgeCache): void {
  mkdirSync(dirname(cachePath), { recursive: true, mode: 0o755 })
  const body = JSON.stringify(cache, null, 2) + '\n'
  const temp = cachePath + '.' + process.pid + '.tmp'
  writeFileSync(temp, body, { encoding: 'utf8', mode: 0o644 })
  renameSync(temp, cachePath)
}

export interface BridgeSyncResult { discovered: number; bridged: number; firstRun: boolean }

/** Explicit exclusions are separate from the engine-owned catalog. New
 * installations are enabled automatically without re-enabling excluded ones. */
export function syncSkillsBridge(
  home: string,
  sandRoot: string,
  pluginVersion: string,
  opts: { enabled?: readonly string[] | null; additionalRoots?: readonly string[] } = {},
): BridgeSyncResult {
  const cachePath = join(sandRoot, PLUGIN_SKILLS_DIRNAME, PLUGIN_SKILLS_CACHE_FILENAME)
  const prefsPath = join(sandRoot, 'dsh-bots-skill-bridge.json')
  const refs = discoverDshSkills(home, opts.additionalRoots)
  let existing: BridgeCache | null = null
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8'))
    if (Number.isFinite(parsed.fetchedAt) && Array.isArray(parsed.skills)) existing = parsed
  } catch { /* initial sync */ }
  let excluded: string[] = []
  try {
    const prefs = JSON.parse(readFileSync(prefsPath, 'utf8'))
    if (Array.isArray(prefs.excluded)) excluded = prefs.excluded.filter((id: unknown) => typeof id === 'string')
  } catch {
    // Migrate a previously trimmed bridge once. A foreign-only cache is not
    // a prior bridge and must not suppress this plugin's initial catalog.
    const old = existing?.skills.filter(s => s.pluginId === 'dsh-bots') ?? []
    if (old.length > 0) excluded = refs.filter(r => !r.disableModelInvocation && dshSkillRoots(home).slice(0, 2).includes(r.root) && !old.some(s => s.id === r.id)).map(r => r.id)
  }
  if (opts.enabled != null) excluded = refs.filter(r => !opts.enabled!.includes(r.id)).map(r => r.id)
  const prefs = JSON.stringify({ version: 1, excluded }, null, 2) + '\n'
  mkdirSync(sandRoot, { recursive: true })
  let oldPrefs = ''
  try { oldPrefs = readFileSync(prefsPath, 'utf8') } catch {}
  if (oldPrefs !== prefs) {
    const temp = prefsPath + '.' + process.pid + '.tmp'
    writeFileSync(temp, prefs, { mode: 0o600 }); renameSync(temp, prefsPath)
  }
  const chosen = refs.filter(r => !excluded.includes(r.id))
  const foreign = existing?.skills.filter(s => s.pluginId !== 'dsh-bots') ?? []
  const occupied = new Set(foreign.map(s => s.id))
  const skills = chosen.filter(r => !occupied.has(r.id)).map(ref => ({
    id: ref.id, pluginId: 'dsh-bots', pluginName: 'dsh-bots', name: ref.name,
    description: ref.description, filePath: ref.filePath, pluginVersion,
    installPath: dirname(ref.filePath), skillRelativePath: 'SKILL.md',
    publisherUserId: null, marketplaceTeamId: null,
  }))
  const cache: BridgeCache = {
    fetchedAt: Date.now(), currentUserId: existing?.currentUserId ?? null,
    authBlocked: existing?.authBlocked ?? [], skills: [...foreign, ...skills],
  }
  // Avoid continuously invalidating the engine's watcher when nothing changed.
  if (JSON.stringify(existing?.skills) !== JSON.stringify(cache.skills)) writeBridgeCache(cachePath, cache)
  return { discovered: refs.length, bridged: skills.length, firstRun: existing == null }
}

/** Used by the card to warn when a bridged file vanished between syncs. */
export function skillFilePresent(filePath: string): boolean {
  try { return statSync(filePath).isFile() } catch { return false }
}
