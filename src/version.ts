/**
 * Minimal semver caret-range matching for the prerelease patterns this plugin
 * actually uses (e.g. `^4.0.1`, `^0.1.1-rc.2`).
 *
 * Ported from the community dsh-plugin-template (MIT) and kept
 * dependency-free: it implements the subset of node-semver semantics needed to
 * turn a silent peer mismatch into a loud, actionable error.
 * See tests/version.spec.ts for the behavior matrix.
 * @module dsh-plugin-bots/version
 */

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  /** Prerelease identifiers (e.g. ["rc", "2"]), or null for a stable version. */
  prerelease: string[] | null
}

/** Parse `X.Y.Z` or `X.Y.Z-pre` into a comparable structure, or null. */
export function parseVersion(input: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(input.trim())
  if (match === null) return null
  const prerelease = match[4] !== undefined && match[4] !== '' ? match[4].split('.') : null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  }
}

function compareIdentifier(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a)
  const bNumeric = /^\d+$/.test(b)
  if (aNumeric && bNumeric) {
    const diff = BigInt(a) - BigInt(b)
    return diff === 0n ? 0 : diff > 0n ? 1 : -1
  }
  if (aNumeric) return -1 // numeric identifiers always sort lower
  if (bNumeric) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** Compare two prerelease identifier lists; a stable version (null) is higher. */
export function comparePrerelease(a: string[] | null, b: string[] | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const left = a[i]
    const right = b[i]
    if (left === undefined) return -1 // shorter prerelease sorts lower
    if (right === undefined) return 1
    const diff = compareIdentifier(left, right)
    if (diff !== 0) return diff
  }
  return 0
}

function tupleOf(version: ParsedVersion): [number, number, number] {
  return [version.major, version.minor, version.patch]
}

function compareTuple(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    const diff = a[i] - b[i]
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

/** Upper exclusive bound of a caret range: ^0.1.0 → 0.2.0, ^1.2.3 → 2.0.0. */
export function caretUpperBound(version: ParsedVersion): [number, number, number] {
  if (version.major > 0) return [version.major + 1, 0, 0]
  if (version.minor > 0) return [0, version.minor + 1, 0]
  return [0, 0, version.patch + 1]
}

/**
 * Whether `version` satisfies the caret range `^X.Y.Z` or `^X.Y.Z-pre`.
 * Mirrors node-semver for the subset this plugin declares.
 */
export function satisfiesCaret(version: string, range: string): boolean {
  const match = /^\^([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)$/.exec(range.trim())
  if (match === null) return false
  const parsed = parseVersion(version)
  const parsedRange = parseVersion(match[1] ?? '')
  if (parsed === null || parsedRange === null) return false

  const versionTuple = tupleOf(parsed)
  const rangeTuple = tupleOf(parsedRange)
  const tupleDiff = compareTuple(versionTuple, rangeTuple)

  // Lower bound.
  if (tupleDiff < 0) return false
  if (tupleDiff === 0) {
    if (parsedRange.prerelease === null) {
      // A range without a prerelease does not match prereleases of the same tuple.
      if (parsed.prerelease !== null) return false
    } else if (comparePrerelease(parsed.prerelease, parsedRange.prerelease) < 0) {
      return false
    }
  }

  // Upper bound (exclusive).
  const upper = caretUpperBound(parsedRange)
  return compareTuple(versionTuple, upper) < 0
}
