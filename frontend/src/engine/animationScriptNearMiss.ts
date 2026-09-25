/**
 * The first cut of near-miss name matching, shared by script diagnostics that
 * want to suggest likely candidates for a misspelled name (node Unique Names
 * now, library entries later).
 */

export interface NearMissOptions {
  /** Maximum number of suggestions returned. Defaults to 3. */
  readonly limit?: number
  /** Minimum query length before substring candidates are considered. Defaults to 2. */
  readonly minLength?: number
}

/** Rank `candidates` by how close they are to `query`, closest first. */
export function nearMissCandidates(
  query: string,
  candidates: readonly string[],
  options: NearMissOptions = {},
): string[] {
  const limit = options.limit ?? 3
  const minLength = options.minLength ?? 2
  if (query.length < minLength) return []

  const normalizedQuery = query.toLowerCase()
  const scored: { candidate: string; score: number }[] = []
  for (const candidate of candidates) {
    const score = similarityScore(normalizedQuery, candidate.toLowerCase())
    if (score !== null) {
      scored.push({ candidate, score })
    }
  }
  scored.sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate))
  return scored.slice(0, limit).map((entry) => entry.candidate)
}

/** Human-readable candidate list: `"A"`, `"A" or "B"`, `"A", "B" or "C"`. */
export function formatCandidates(candidates: readonly string[]): string {
  const quoted = candidates.map((candidate) => `"${candidate}"`)
  if (quoted.length <= 1) return quoted.join('')
  return `${quoted.slice(0, -1).join(', ')} or ${quoted[quoted.length - 1]}`
}

function similarityScore(normalizedQuery: string, normalizedCandidate: string): number | null {
  if (normalizedCandidate === normalizedQuery) return 0
  // A name that extends or truncates the query ("Habl" → "Habl (2)") is a
  // stronger hint than an unrelated near-edit, however long the suffix is.
  if (normalizedCandidate.startsWith(normalizedQuery)) return 0.5
  if (normalizedQuery.startsWith(normalizedCandidate)) return 0.75

  const distance = levenshtein(normalizedQuery, normalizedCandidate)
  const shorter = Math.min(normalizedQuery.length, normalizedCandidate.length)
  const threshold = Math.max(2, Math.ceil(shorter / 3))
  if (distance <= threshold) return distance

  const contains =
    normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate)
  if (contains) return threshold + 1
  return null
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  let current = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    current[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
    }
    const swap = previous
    previous = current
    current = swap
  }
  return previous[b.length]
}
