import { describe, expect, it } from 'vitest'
import spanishScript from '../../e2e/fixtures/spanish-gender-lesson.script?raw'
import { parseAnimationScript } from '../engine/animationScriptParser'

type WobbleLevel = 'big' | 'little' | 'none' | 'border'

interface Call {
  kind: string
  alias: string
  at: number
  over: number
  sound: string | null
  wobble: WobbleLevel | null
  toY: number | null
  line: string
}

const BIG =
  /wobbleX:\s*\{\s*from:\s*12\s*,\s*to:\s*24\s*\}\s*,\s*wobbleY:\s*\{\s*from:\s*8\s*,\s*to:\s*18\s*\}\s*,\s*wobbleSpeed:\s*7/
const LITTLE =
  /wobbleX:\s*\{\s*from:\s*4\s*,\s*to:\s*8\s*\}\s*,\s*wobbleY:\s*\{\s*from:\s*3\s*,\s*to:\s*6\s*\}\s*,\s*wobbleSpeed:\s*7/
const BORDER_Y = /wobbleY:\s*\{\s*from:\s*24\s*,\s*to:\s*54\s*\}/

function parseCalls(source: string): Call[] {
  const calls: Call[] = []
  for (const line of source.split('\n')) {
    const m = /^(reveal|wipe|mark|carry)\((\w+).*?,\s*at:\s*([\d.]+),\s*over:\s*([\d.]+)/.exec(
      line.trim(),
    )
    if (!m) continue
    const sound = /sound:\s*(writeSfx|eraseSfx)/.exec(line)?.[1] ?? null
    const hasWobble = /wobbleX:/.test(line)
    const wobble: WobbleLevel | null = !hasWobble
      ? 'none'
      : BORDER_Y.test(line)
        ? 'border'
        : BIG.test(line)
          ? 'big'
          : LITTLE.test(line)
            ? 'little'
            : null
    const toY = /to:\s*\{\s*x:\s*[\d.]+\s*,\s*y:\s*([\d.]+)\s*\}/.exec(line)?.[1]
    calls.push({
      kind: m[1],
      alias: m[2],
      at: Number(m[3]),
      over: Number(m[4]),
      sound,
      wobble,
      toY: toY !== undefined ? Number(toY) : null,
      line: line.trim().slice(0, 60),
    })
  }
  return calls
}

// Writing time grows with content (~0.1s/char, 0.3s floor): dashes are
// quick, words take their time.
const CELL_OVERS: Record<string, number> = {
  c00: 0.6,
  c01: 0.8,
  c02: 0.9,
  c03: 1.1,
  c04: 0.7,
  c10: 0.8,
  c11: 0.3,
  c12: 0.3,
  c13: 0.3,
  c14: 0.7,
  c20: 0.9,
  c21: 0.3,
  c22: 0.3,
  c23: 0.3,
  c24: 0.8,
}

// Wobble scaled to content: full wobble for words, little for the two-glyph
// "-a"/"-o" cells, none for a lone dash.
const CELL_WOBBLE: Record<string, WobbleLevel> = {
  c00: 'big',
  c01: 'big',
  c02: 'big',
  c03: 'big',
  c04: 'big',
  c10: 'big',
  c11: 'little',
  c12: 'none',
  c13: 'little',
  c14: 'big',
  c20: 'big',
  c21: 'none',
  c22: 'little',
  c23: 'little',
  c24: 'big',
}

describe('spanish lesson pacing (slow sequential stages)', () => {
  it('parses and honors slow sequential pacing', () => {
    const source = spanishScript
    const program = parseAnimationScript(source)
    expect(program).toBeTruthy()
    // Parser collects diagnostics on the program (empty when clean).
    expect((program as unknown as { diagnostics?: unknown[] }).diagnostics ?? []).toEqual([])

    const calls = parseCalls(source)
    const reveals = calls.filter((c) => c.kind === 'reveal')
    const wipes = calls.filter((c) => c.kind === 'wipe')
    const carries = calls.filter((c) => c.kind === 'carry')
    const marks = calls.filter((c) => c.kind === 'mark')
    expect(reveals).toHaveLength(22)
    expect(carries).toHaveLength(4)
    expect(marks).toHaveLength(1)
    // 20 wipes: 4 rag + 15 mask-setup + 1 grid
    expect(wipes).toHaveLength(20)

    // Every effect ends inside the 86s slide.
    for (const c of calls) {
      expect(c.at + c.over).toBeLessThanOrEqual(86 + 1e-9)
      expect(c.at).toBeGreaterThanOrEqual(0)
    }

    // Every audible reveal/wipe carries its SFX; mask-setup wipes stay silent.
    for (const c of [...reveals, ...wipes]) {
      if (c.line.includes('visual: none')) {
        expect(c.sound).toBeNull()
      } else if (c.kind === 'reveal') {
        expect(c.sound).toBe('writeSfx')
      } else {
        expect(c.sound).toBe('eraseSfx')
      }
    }

    // Wobble everywhere audible, scaled to content; mask-setup silent and
    // straight; the wide table border gets triple Y wobble.
    for (const c of [...reveals, ...wipes]) {
      if (c.line.includes('visual: none')) {
        expect(c.wobble).toBe('none')
      } else if (c.alias === 'tableBorder') {
        expect(c.wobble).toBe('border')
      } else if (c.alias in CELL_WOBBLE) {
        expect(c.wobble).toBe(CELL_WOBBLE[c.alias])
      } else {
        expect(c.wobble).toBe('big')
      }
      expect(c.wobble).not.toBeNull()
    }

    // Cell writing time grows with content length.
    for (const c of calls.filter((c) => c.kind === 'reveal' && c.alias in CELL_OVERS)) {
      expect(c.over).toBeCloseTo(CELL_OVERS[c.alias], 5)
    }

    // Sound starts are exactly the 27 expected timeline times.
    const starts = calls
      .filter((c) => c.sound !== null)
      .map((c) => c.at)
      .sort((a, b) => a - b)
    expect(starts).toEqual([
      0, 8, 12, 25.5, 29, 32.5, 36, 48, 52, 55.5, 56.6, 57.9, 59.3, 60.9, 62.1, 63.4, 64.2, 65,
      65.8, 67, 68.4, 69.2, 70, 70.8, 74.5, 78.5, 82,
    ])

    // Both picture cards are placed low (clear of the explanation sentence),
    // with their labels below them.
    const inF = carries.find((c) => c.line.includes('x: 340, y: 365'))!
    const inM = carries.find((c) => c.line.includes('x: 750, y: 365'))!
    expect(inF).toBeTruthy()
    expect(inM).toBeTruthy()
    expect(source).toContain('as feminineLabel at (340, 500)')
    expect(source).toContain('as masculineLabel at (750, 500)')
    // Labels must clear the photo bottoms: photos are ~203 tall at 0.34
    // scale centered at y 365 (bottom ~466); 26px labels at y 500 start
    // around y ~482, leaving daylight instead of sliding under the image.
    const photoBottom = 365 + (596 * 0.34) / 2
    expect(500 - 18).toBeGreaterThan(photoBottom)

    // Staging order: both cards placed, then labels written, then labels
    // wiped, and only then the cards flown away.
    const at = (pred: (c: Call) => boolean) => calls.find(pred)!.at
    const labelF = at((c) => c.kind === 'reveal' && c.line.includes('feminineNode'))
    const labelM = at((c) => c.kind === 'reveal' && c.line.includes('masculineNode'))
    const wipeF = at((c) => c.kind === 'wipe' && c.line.includes('feminineNode'))
    const wipeM = at((c) => c.kind === 'wipe' && c.line.includes('masculineNode'))
    const outF = at((c) => c.kind === 'carry' && c.toY === 1200 && c.line.includes('x: 1500'))
    const outM = at((c) => c.kind === 'carry' && c.toY === 1200 && c.line.includes('x: 1640'))
    // Both cards fully placed before either label is written.
    expect(labelF).toBeGreaterThan(inM.at + inM.over)
    expect(labelM).toBeGreaterThan(labelF)
    // Labels wiped before either card leaves.
    expect(wipeF).toBeGreaterThan(labelM)
    expect(wipeM).toBeGreaterThan(wipeF)
    expect(outF).toBeGreaterThan(wipeM)
    expect(outM).toBeGreaterThan(outF)

    // Long pauses between audible stages; cell writing still breathes.
    const audible = calls.filter((c) => c.sound !== null).sort((a, b) => a.at - b.at)
    for (let i = 1; i < audible.length; i++) {
      const gap = audible[i].at - (audible[i - 1].at + audible[i - 1].over)
      const isCellWriting = audible[i].at >= 55.5 && audible[i].at <= 70.8
      expect(gap).toBeGreaterThanOrEqual(isCellWriting ? 0.5 - 1e-9 : 2.5 - 1e-9)
    }
  })
})
