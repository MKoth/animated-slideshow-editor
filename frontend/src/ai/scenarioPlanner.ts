/**
 * Scenario planner core (issue #469).
 *
 * Deterministic, LLM-free pure seam: accepted scenario markdown plus the
 * project secondsPerCharacter setting yields a strict Slide N = Step N plan
 * with one verbatim prompter part per slide and a purely sequential board
 * draft.
 *
 * Scope for #469 (tables, teardown economy, overflow, and full fractions land
 * in #470; preview plus atomic apply land in #471):
 * - Identity: positional convergence of middle slides to steps; display name
 *   mirrors the step heading; insert/delete/rename middles, intro/outro left
 *   to the caller.
 * - Prompter: verbatim narrator text, duration = length × secondsPerCharacter.
 * - Board: sequential sources with no absolute time placements (`at:`); the
 *   backdrop group is reused per slide, paw performers start parked
 *   off-screen, scenario normalized asset keys stay verbatim in quoted names.
 * - Diagnostics: unknown bracket verbs and dangling references
 *   (place without a declared visual, remove/wipe of nothing on the board)
 *   are blocking errors.
 *
 * Interpretation note: "no absolute placements" means no absolute *time*
 * placements (`at:`), per #467 story 15 ("no absolute times") and story 18
 * ("purely sequential ... without absolute times"). X/Y destinations remain:
 * `carry` requires `to:`, and parked performers require `at (x, y)`.
 * Generated sources therefore assert no `/\bat\s*:/` while still parking at
 * (1500, 1200)-style coordinates. Full action-to-block fractions metadata is
 * #470 scope; #469 emits even `over:` shares for sequential pacing.
 */

import { normalizeAssetKey, parseScenarioMarkdown } from '../engine/scenarioMarkdown'
import type { ParsedScenario } from '../engine/scenarioMarkdown'
import { markNameForPart } from './board'
import { estimatePartDuration } from './narration'

export interface PlannerExistingSlide {
  readonly id: string
  readonly name: string
}

export interface PlannerDiagnostic {
  readonly severity: 'error' | 'warning'
  readonly message: string
  readonly step?: number
  readonly code?:
    | 'unknown-verb'
    | 'dangling-place'
    | 'unknown-remove'
    | 'dangling-wipe'
    | 'missing-narrator'
    | 'missing-title'
    | 'non-sequential-heading'
    | 'bare-heading'
}

export interface PlannerSlide {
  /** 1-based position in the draft (Slide N). */
  readonly position: number
  /** Original `## Step N` number from the doc. */
  readonly stepIndex: number
  readonly title: string
  readonly slideName: string
  readonly duration: number
  readonly prompterText: string
  readonly source: string
  /** Cursor mark in the generated source (`part-0` per single-part slide). */
  readonly markName: string
  /** Presentation id for the owning prompt block (`prompt-N`). */
  readonly promptBlockId: string
  /** Minimal action-to-block fractions (#470 refines with cell economy). */
  readonly fractions: readonly PlannerFraction[]
}

export interface PlannerFraction {
  readonly action: string
  readonly block: string
  readonly fraction: number
}

export interface PlannerOps {
  readonly creates: readonly { stepIndex: number; slideName: string }[]
  readonly renames: readonly { id: string; from: string; to: string }[]
  readonly deletes: readonly { id: string; name: string }[]
  readonly keeps: readonly { id: string; stepIndex: number; slideName: string }[]
}

export interface PlannerResult {
  readonly slides: readonly PlannerSlide[]
  readonly diagnostics: readonly PlannerDiagnostic[]
  readonly ops: PlannerOps
  readonly blocked: boolean
}

const KNOWN_BRACKET_VERBS: ReadonlySet<string> = new Set([
  'place',
  'reveal',
  'remove',
  'wipe',
  // `mark` is a valid scenario action per #467 vocabulary (temporary mark,
  // needs no removal); bracket `[label:]` is *not* valid — chalk labels are
  // `> Label:` lines attached to visuals. Full mark/label-bracket emission is
  // #470 scope; here they are known so they never false-positive as unknown.
  'mark',
])

const BRACKET_LINE_RE = /^\s*\[(\w+)(?:\s*:([^\]]*))?\]\s*$/

const PARKED = [
  { name: 'paw with chalk', alias: 'chalkpaw', x: 1500, y: 1200 },
  { name: 'paw with rag', alias: 'ragpaw', x: 1640, y: 1200 },
  { name: 'paw empty', alias: 'pawempty', x: 1780, y: 1200 },
] as const

const PARKED_HOME = { x: 1500, y: 1200 } as const
const BOARD_HOME = { x: 545, y: 360 } as const

function toAlias(raw: string, fallback: string): string {
  const parts = raw
    .split(/[^A-Za-z0-9]+/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
  if (parts.length === 0) return fallback
  const [first, ...rest] = parts as [string, ...string[]]
  let out = `${first.toLowerCase()}${rest
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join('')}`
  // Identifiers cannot start with a digit.
  if (/^[0-9]/.test(out)) out = `n${out}`
  // Strip anything still illegal (defensive).
  out = out.replace(/[^A-Za-z0-9_]/g, '')
  if (out === '') return fallback
  return out
}

function uniqueAlias(base: string, taken: Set<string>, fallback: string): string {
  const candidate = toAlias(base, fallback)
  if (!taken.has(candidate)) {
    taken.add(candidate)
    return candidate
  }
  let n = 2
  while (taken.has(`${candidate}${n}`)) n += 1
  const out = `${candidate}${n}`
  taken.add(out)
  return out
}

function escapeQuoted(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function detectUnknownVerbs(markdown: string): PlannerDiagnostic[] {
  const out: PlannerDiagnostic[] = []
  const lines = markdown.split('\n')
  lines.forEach((line, i) => {
    const match = BRACKET_LINE_RE.exec(line)
    if (!match) return
    const verb = (match[1] ?? '').toLowerCase()
    if (!KNOWN_BRACKET_VERBS.has(verb)) {
      out.push({
        severity: 'error',
        code: 'unknown-verb',
        message: `Unknown board verb "${match[1]}" on line ${i + 1} — known verbs are place, reveal, remove, wipe, mark`,
      })
    }
  })
  return out
}

/**
 * Core seam taking an already-parsed scenario (per #467 "taking the parsed
 * scenario plus secondsPerCharacter"). `rawMarkdown` is only needed for
 * whole-line unknown-verb detection, which the parser otherwise swallows as
 * plain text.
 */
export function planParsedScenario(
  parsed: ParsedScenario,
  secondsPerCharacter: number,
  existingSlides: readonly PlannerExistingSlide[] = [],
  rawMarkdown = '',
): PlannerResult {
  return planFromParsed(parsed, secondsPerCharacter, existingSlides, rawMarkdown)
}

export function planScenarioDraft(
  markdown: string,
  secondsPerCharacter: number,
  existingSlides: readonly PlannerExistingSlide[] = [],
): PlannerResult {
  if (!(secondsPerCharacter > 0)) throw new Error('secondsPerCharacter must be > 0')
  const parsed = parseScenarioMarkdown(markdown)
  return planFromParsed(parsed, secondsPerCharacter, existingSlides, markdown)
}

function planFromParsed(
  parsed: ParsedScenario,
  secondsPerCharacter: number,
  existingSlides: readonly PlannerExistingSlide[],
  rawMarkdown: string,
): PlannerResult {
  if (!(secondsPerCharacter > 0)) throw new Error('secondsPerCharacter must be > 0')
  const diagnostics: PlannerDiagnostic[] = []

  for (const warning of parsed.warnings) {
    if (
      warning.code === 'dangling-place' ||
      warning.code === 'unknown-remove' ||
      warning.code === 'dangling-wipe'
    ) {
      diagnostics.push({
        severity: 'error',
        code: warning.code,
        message: warning.message,
        ...(warning.step !== undefined ? { step: warning.step } : {}),
      })
    }
  }
  for (const found of detectUnknownVerbs(rawMarkdown)) diagnostics.push(found)

  const slides: PlannerSlide[] = parsed.steps.map((step, order) => {
    const position = order + 1
    const title = step.title.trim()
    const slideName = title !== '' ? `Step ${step.index} — ${title}` : `Step ${step.index}`
    const narrator = step.narrator
    if (narrator === undefined || narrator.trim() === '') {
      diagnostics.push({
        severity: 'error',
        code: 'missing-narrator',
        message: `Step ${step.index} has no narrator — each slide needs verbatim prompter text`,
        step: step.index,
      })
    }
    const prompterText = narrator ?? ''
    // Reuses the duration estimator via the narration mirror (same function).
    const duration = estimatePartDuration(prompterText, secondsPerCharacter)
    const markName = markNameForPart(0)
    const promptBlockId = `prompt-${position}`
    const built = buildBoardSource({
      slideName,
      duration,
      step,
      markName,
      position,
      promptBlockId,
    })
    return {
      position,
      stepIndex: step.index,
      title,
      slideName,
      duration,
      prompterText,
      source: built.source,
      markName,
      promptBlockId,
      fractions: built.fractions,
    }
  })

  const keeps: { id: string; stepIndex: number; slideName: string }[] = []
  const renames: { id: string; from: string; to: string }[] = []
  const keepCount = Math.min(existingSlides.length, slides.length)
  for (let i = 0; i < keepCount; i += 1) {
    const existing = existingSlides[i]!
    const desired = slides[i]!
    keeps.push({ id: existing.id, stepIndex: desired.stepIndex, slideName: desired.slideName })
    if (existing.name !== desired.slideName) {
      renames.push({ id: existing.id, from: existing.name, to: desired.slideName })
    }
  }
  const creates = slides.slice(existingSlides.length).map((s) => ({
    stepIndex: s.stepIndex,
    slideName: s.slideName,
  }))
  const deletes = existingSlides.slice(slides.length).map((s) => ({ id: s.id, name: s.name }))

  const blocked = diagnostics.some((d) => d.severity === 'error')
  return { slides, diagnostics, ops: { creates, renames, deletes, keeps }, blocked }
}

function buildBoardSource(input: {
  slideName: string
  duration: number
  step: {
    placed: readonly string[]
    reveals: readonly string[]
    removes: readonly string[]
    wipeTargets: readonly string[]
    wiped: boolean
    visuals: readonly { key: string; alt: string; label?: string }[]
    text?: string
  }
  markName: string
  position: number
  promptBlockId: string
}): { source: string; fractions: readonly PlannerFraction[] } {
  const { slideName, duration, step, markName, promptBlockId } = input
  const taken = new Set<string>(['board', 'chalkpaw', 'ragpaw', 'pawempty'])
  const lines: string[] = []
  lines.push(`script "${escapeQuoted(slideName)}" from 0`)
  lines.push(`let slideLen = ${Number(duration.toFixed(2))}`)
  lines.push('bind chalk = material("Chalk")')
  lines.push('bind chalkHand = node("paw with chalk")')
  lines.push('bind ragHand = node("paw with rag")')
  lines.push('bind emptyHand = node("paw empty")')
  lines.push('bind writeSfx = audio("writing-on-black-board")')
  lines.push('bind eraseSfx = audio("dry-erase")')
  lines.push('create group "Board" as board')
  lines.push('board.material(chalk)')
  for (const paw of PARKED) {
    lines.push(
      `create asset "${paw.name}" as ${paw.alias} at (${paw.x}, ${paw.y}) { scaleX: 0.12, scaleY: 0.12 }`,
    )
  }
  lines.push(`mark("${markName}")`)

  type Effect =
    | { kind: 'carry-in'; alias: string; name: string }
    | { kind: 'reveal'; alias: string; name: string; content: string }
    | { kind: 'carry-away'; alias: string }
    | { kind: 'wipe'; alias: string }

  const creations: string[] = []
  const effects: Effect[] = []
  const boardItems = new Map<string, { alias: string; kind: 'carried' | 'revealed' }>()

  // Appearance order: placed images first (doc order), then reveal blocks.
  for (const slug of step.placed) {
    const key = normalizeAssetKey(slug)
    if (key === '' || boardItems.has(key)) continue
    const alias = uniqueAlias(key, taken, `item${taken.size}`)
    boardItems.set(key, { alias, kind: 'carried' })
    creations.push(
      `create asset "${escapeQuoted(slug)}" as ${alias} at (${PARKED_HOME.x}, ${PARKED_HOME.y}) { scaleX: 0.34, scaleY: 0.34 }`,
    )
    effects.push({ kind: 'carry-in', alias, name: slug })
  }

  // Visual labels ride with their image: chalk text revealed under the card.
  for (const visual of step.visuals) {
    if (!visual.label || visual.label.trim() === '') continue
    const base = `${visual.key}-label`
    const alias = uniqueAlias(base, taken, `label${taken.size}`)
    const name = `${visual.key}-label`
    boardItems.set(name, { alias, kind: 'revealed' })
    creations.push(
      `create text "${escapeQuoted(name)}" as ${alias} inside board { content: "${escapeQuoted(visual.label)}", fontSize: 26, alignment: "center" }`,
    )
    effects.push({ kind: 'reveal', alias, name, content: visual.label })
  }

  const chalkText = step.text?.trim() ?? ''
  if (step.reveals.length > 0) {
    for (const id of step.reveals) {
      const key = normalizeAssetKey(id)
      const mapKey = key === '' ? id : key
      if (mapKey === '' || boardItems.has(mapKey)) continue
      const alias = uniqueAlias(mapKey, taken, `text${taken.size}`)
      // Keep the scenario id verbatim as the quoted node name.
      boardItems.set(mapKey, { alias, kind: 'revealed' })
      const content = step.reveals.length === 1 && chalkText !== '' ? chalkText : id
      creations.push(
        `create text "${escapeQuoted(id)}" as ${alias} inside board { content: "${escapeQuoted(content)}", fontSize: 26, alignment: "center" }`,
      )
      effects.push({ kind: 'reveal', alias, name: id, content })
    }
  } else if (chalkText !== '') {
    // Chalk copy without an explicit reveal marker still appears once.
    const name = `text${input.position}`
    const alias = uniqueAlias(name, taken, name)
    boardItems.set(name, { alias, kind: 'revealed' })
    creations.push(
      `create text "${escapeQuoted(name)}" as ${alias} inside board { content: "${escapeQuoted(chalkText)}", fontSize: 26, alignment: "center" }`,
    )
    effects.push({ kind: 'reveal', alias, name, content: chalkText })
  }

  // Teardown within the same slide, kind-matched and in reverse appearance
  // order. Temporary marks are overlays and need no removal. Full teardown
  // ordering is refined with cell economy in #470; the non-table reverse walk
  // lives here.
  const appearanceKeys: string[] = []
  for (const slug of step.placed) {
    const key = normalizeAssetKey(slug)
    if (key !== '' && !appearanceKeys.includes(key)) appearanceKeys.push(key)
  }
  for (const key of boardItems.keys()) {
    if (!appearanceKeys.includes(key)) appearanceKeys.push(key)
  }
  const kindMatchedRemoval = (key: string): Effect | null => {
    const item = boardItems.get(key)
    if (!item) return null
    if (item.kind === 'carried') return { kind: 'carry-away', alias: item.alias }
    return { kind: 'wipe', alias: item.alias }
  }
  if (step.wiped && step.wipeTargets.length === 0) {
    for (let i = appearanceKeys.length - 1; i >= 0; i -= 1) {
      const removal = kindMatchedRemoval(appearanceKeys[i]!)
      if (removal) effects.push(removal)
    }
  } else {
    for (const id of [...step.removes, ...step.wipeTargets]) {
      const key = normalizeAssetKey(id)
      const removal = kindMatchedRemoval(key === '' ? id : key)
      if (removal) effects.push(removal)
    }
  }

  lines.push(...creations)

  const count = effects.length
  const share = count > 0 && duration > 0 ? duration / count : 0
  const shareText = count > 0 && duration > 0 ? `, over: ${Number(share.toFixed(2))}` : ''
  const fractions: PlannerFraction[] = []
  effects.forEach((effect, index) => {
    const action =
      effect.kind === 'carry-in' || effect.kind === 'carry-away'
        ? `carry(${effect.alias})`
        : effect.kind === 'reveal'
          ? `reveal(${effect.alias})`
          : `wipe(${effect.alias})`
    fractions.push({
      action,
      block: promptBlockId,
      fraction: count > 0 ? (index + 0.5) / count : 0,
    })
    switch (effect.kind) {
      case 'carry-in':
        lines.push(
          `carry(${effect.alias}, to: { x: ${BOARD_HOME.x}, y: ${BOARD_HOME.y} }${shareText}, visual: emptyHand)`,
        )
        break
      case 'reveal':
        lines.push(`reveal(${effect.alias}${shareText}, visual: chalkHand, sound: writeSfx)`)
        break
      case 'carry-away':
        lines.push(
          `carry(${effect.alias}, to: { x: ${PARKED_HOME.x}, y: ${PARKED_HOME.y} }${shareText}, visual: emptyHand)`,
        )
        break
      case 'wipe':
        lines.push(`wipe(${effect.alias}${shareText}, visual: ragHand, sound: eraseSfx)`)
        break
    }
  })
  lines.push(`// slide ends at ${Number(duration.toFixed(2))}s = sum of prompter parts`)
  return { source: `${lines.join('\n')}\n`, fractions }
}
