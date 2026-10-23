/**
 * Deterministic text width estimate shared by the compiler planned bounds and
 * the renderer measurement. Per-character advances keep mixed-case labels
 * tight (the old flat 0.6em/char + 20% pad overshot the right edge by ~10%,
 * so the reveal hand kept writing past the last glyph into empty board)
 * while all-caps still measures wide enough to avoid clipping the trailing
 * glyph.
 */
export function estimateTextWidth(content: string, fontSize: number): number {
  // Trailing whitespace renders as empty advance: it must not extend the
  // reveal sweep, or the hand writes past the last glyph into empty board.
  const trimmed = content.replace(/\s+$/, '')
  if (trimmed.length === 0) return fontSize
  let em = 0
  for (const ch of trimmed) {
    if (ch === ' ') {
      em += 0.32
      continue
    }
    const isUpper = ch !== ch.toLowerCase() && ch === ch.toUpperCase()
    const isLower = ch !== ch.toUpperCase() && ch === ch.toLowerCase()
    if (isUpper) {
      em += 0.72
    } else if (isLower) {
      if ('iljtfr'.includes(ch)) em += 0.4
      else if ('mw'.includes(ch)) em += 0.78
      else em += 0.55
    } else if (ch >= '0' && ch <= '9') {
      em += 0.56
    } else {
      em += 0.5
    }
  }
  return Math.max(em * fontSize, fontSize)
}

export function estimateTextSize(
  content: string,
  fontSize: number,
): { width: number; height: number } {
  return { width: estimateTextWidth(content, fontSize), height: fontSize * 1.2 }
}
