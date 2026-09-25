import { describe, expect, it } from 'vitest'
import { formatCandidates, nearMissCandidates } from '../../engine/animationScriptNearMiss'

describe('Animation Script near-miss candidates', () => {
  it('ranks close spellings by edit distance', () => {
    expect(nearMissCandidates('Habl', ['Hable', 'Habl (2)', 'Table'])).toEqual([
      'Habl (2)',
      'Hable',
      'Table',
    ])
  })

  it('matches exact names case-insensitively', () => {
    expect(nearMissCandidates('hero', ['Hero', 'Villain'])).toEqual(['Hero'])
  })

  it('returns nothing for an unrelated or too-short query', () => {
    expect(nearMissCandidates('zzzzzz', ['Hero'])).toEqual([])
    expect(nearMissCandidates('h', ['Hero'])).toEqual([])
  })

  it('respects the suggestion limit and formats the list', () => {
    expect(nearMissCandidates('card', ['card 1', 'card 2', 'card 3'], { limit: 2 })).toHaveLength(2)
    expect(formatCandidates(['A'])).toBe('"A"')
    expect(formatCandidates(['A', 'B'])).toBe('"A" or "B"')
    expect(formatCandidates(['A', 'B', 'C'])).toBe('"A", "B" or "C"')
  })
})
