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
 * Sharing is opt-in per skill. Every bridged skill reaches EVERY bot and
 * group, and the system prompt tells bots to read and follow it — so a skill
 * dropped into ~/.agents/skills by some installer must not silently become
 * instructions for the whole crew:
 *   - a newly discovered skill is `pending` (not bridged) until the user
 *     shares or declines it on the settings card;
 *   - skills bundled with this plugin ship shared (same trust as its code);
 *   - decisions live in dsh-bots-skill-bridge.json with the SKILL.md sha256
 *     recorded at share time, so a later edit surfaces as `changed`;
 *   - the v1 exclusion list migrates as-is: whatever was shared stays shared.
 * Other plugins retain ownership of their cache records and auth fields.
 * @module dsh-bots/skill-bridge
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, renameSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
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
  /** sha256 of the SKILL.md bytes, hex — what a share decision vouches for. */
  sha256: string
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
      // Names with no ASCII left (中文目录) would all collapse onto "skill"
      // and then be told apart by scan order — an id that shifts when a new
      // skill lands would re-point old `sand-workflow:` mentions. Key those
      // on their real path instead, which is stable.
      const ascii = slugifySkillId(entry.name.replace(/\.(md|markdown)$/i, ''))
      const slug = ascii === 'skill' && !/^skill(\.(md|markdown))?$/i.test(entry.name)
        ? 'skill-' + createHash('sha256').update(canonical).digest('hex').slice(0, 8)
        : ascii
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
        sha256: createHash('sha256').update(raw).digest('hex'),
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

/** A skill's sharing state as the settings card shows it. */
export type BridgeStatus = 'shared' | 'pending' | 'declined'

export interface BridgeRow {
  id: string; name: string; description: string; path: string; root: string
  sha256: string; status: BridgeStatus
  /** Shared, but SKILL.md changed since the user shared it. */
  changed: boolean
  /** Ships inside this plugin (shared by default). */
  bundled: boolean
  disableModelInvocation: boolean
}

export interface BridgeSyncResult { discovered: number; bridged: number; pending: number; firstRun: boolean; rows: BridgeRow[] }

/** Persisted decisions: shared id → sha256 at share time, declined ids. */
interface BridgePrefs { version: 2; shared: Record<string, string>; declined: string[] }

function readPrefs(prefsPath: string, refs: DshSkillRef[], existing: BridgeCache | null): { prefs: BridgePrefs; migrated: boolean } | null {
  let raw: any
  try { raw = JSON.parse(readFileSync(prefsPath, 'utf8')) } catch { raw = null }
  if (raw !== null && raw.version === 2 && raw.shared !== null && typeof raw.shared === 'object' && Array.isArray(raw.declined)) {
    const shared: Record<string, string> = {}
    for (const [id, hash] of Object.entries(raw.shared)) if (typeof hash === 'string') shared[id] = hash
    return { prefs: { version: 2, shared, declined: raw.declined.filter((id: unknown) => typeof id === 'string') }, migrated: false }
  }
  const hashOf = new Map(refs.map((r) => [r.id, r.sha256]))
  if (raw !== null && Array.isArray(raw.excluded)) {
    // v1: everything not excluded was shared, and stays shared.
    const excluded = raw.excluded.filter((id: unknown): id is string => typeof id === 'string')
    const shared: Record<string, string> = {}
    for (const ref of refs) if (!excluded.includes(ref.id)) shared[ref.id] = ref.sha256
    return { prefs: { version: 2, shared, declined: excluded }, migrated: true }
  }
  const old = existing?.skills.filter((s) => s.pluginId === 'dsh-bots') ?? []
  if (old.length > 0) {
    // Pre-prefs bridge: what the engine already had stays shared.
    const shared: Record<string, string> = {}
    for (const s of old) { const hash = hashOf.get(s.id); if (hash !== undefined) shared[s.id] = hash }
    return { prefs: { version: 2, shared, declined: [] }, migrated: true }
  }
  return null
}

/**
 * Reconcile the engine catalog with the user's sharing decisions. Without
 * `enabled` it only applies stored decisions (plus bundled defaults);
 * `enabled` is an explicit decision over every discovered skill — listed ids
 * are shared at their current content hash, the rest declined.
 */
export function syncSkillsBridge(
  home: string,
  sandRoot: string,
  pluginVersion: string,
  opts: { enabled?: readonly string[] | null; additionalRoots?: readonly string[] } = {},
): BridgeSyncResult {
  const cachePath = join(sandRoot, PLUGIN_SKILLS_DIRNAME, PLUGIN_SKILLS_CACHE_FILENAME)
  const prefsPath = join(sandRoot, 'dsh-bots-skill-bridge.json')
  const bundledRoots = new Set(opts.additionalRoots ?? [])
  const refs = discoverDshSkills(home, opts.additionalRoots)
  let existing: BridgeCache | null = null
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8'))
    if (Number.isFinite(parsed.fetchedAt) && Array.isArray(parsed.skills)) existing = parsed
  } catch { /* initial sync */ }
  const loaded = readPrefs(prefsPath, refs, existing)
  const firstRun = loaded === null
  const prefs: BridgePrefs = loaded?.prefs ?? { version: 2, shared: {}, declined: [] }
  if (opts.enabled != null) {
    for (const ref of refs) {
      if (opts.enabled.includes(ref.id)) {
        prefs.shared[ref.id] = ref.sha256
        prefs.declined = prefs.declined.filter((id) => id !== ref.id)
      } else {
        delete prefs.shared[ref.id]
        if (!prefs.declined.includes(ref.id)) prefs.declined.push(ref.id)
      }
    }
  }
  // Bundled skills ship with the plugin's own trust: shared on first sight.
  for (const ref of refs) {
    if (bundledRoots.has(ref.root) && !(ref.id in prefs.shared) && !prefs.declined.includes(ref.id)) prefs.shared[ref.id] = ref.sha256
  }
  const body = JSON.stringify(prefs, null, 2) + '\n'
  mkdirSync(sandRoot, { recursive: true })
  let oldPrefs = ''
  try { oldPrefs = readFileSync(prefsPath, 'utf8') } catch {}
  if (oldPrefs !== body) {
    const temp = prefsPath + '.' + process.pid + '.tmp'
    writeFileSync(temp, body, { mode: 0o600 }); renameSync(temp, prefsPath)
  }
  const rows: BridgeRow[] = refs.map((ref) => {
    const status: BridgeStatus = ref.id in prefs.shared ? 'shared' : prefs.declined.includes(ref.id) ? 'declined' : 'pending'
    return {
      id: ref.id, name: ref.name, description: ref.description, path: ref.filePath, root: ref.root,
      sha256: ref.sha256, status, changed: status === 'shared' && prefs.shared[ref.id] !== ref.sha256,
      bundled: bundledRoots.has(ref.root), disableModelInvocation: ref.disableModelInvocation,
    }
  })
  const chosen = refs.filter((r) => r.id in prefs.shared)
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
  return {
    discovered: refs.length, bridged: skills.length,
    pending: rows.filter((r) => r.status === 'pending').length, firstRun, rows,
  }
}

/** Used by the card to warn when a bridged file vanished between syncs. */
export function skillFilePresent(filePath: string): boolean {
  try { return statSync(filePath).isFile() } catch { return false }
}
