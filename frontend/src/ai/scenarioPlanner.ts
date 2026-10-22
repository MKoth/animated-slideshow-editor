/**
 * Scenario planner core + tables/teardown economy (issues #469, #470).
 *
 * Deterministic, LLM-free pure seam: accepted scenario markdown plus the
 * project secondsPerCharacter setting yields a strict Slide N = Step N plan
 * with one verbatim prompter part per slide and a purely sequential board
 * draft.
 *
 * Identity (#469): positional convergence of middle slides to steps; display
 * name mirrors the step heading; insert/delete/rename middles, intro/outro
 * left to the caller.
 *
 * Prompter (#469): verbatim narrator text, duration = length ×
 * secondsPerCharacter.
 *
 * Board (#469 + #470):
 * - Sequential sources with no absolute time placements (`at:`); the
 *   backdrop group is reused per slide, paw performers start parked
 *   off-screen, scenario normalized asset keys stay verbatim in quoted names.
 * - Translation vocabulary: scenario `place` → `carry`, `> Label:`/`reveal`
 *   → `reveal`, `remove`/`wipe` → kind-matched removals, `[mark:]` → `mark`.
 *   Only emitted effects are carry, reveal, wipe, and mark.
 * - Teardown is kind-matched: carried images leave via `carry` back to park,
 *   revealed text/labels/tables leave via `wipe`. Full `[wipe]` expands in
 *   reverse appearance order; targeted `[remove:]/[wipe: id]` expands only the
 *   listed ids present in the same slide. Temporary marks are overlays and
 *   need no removal.
 * - Table economy (#470): each markdown grid becomes one
 *   `create table ...` plus a single `reveal(table)` whose `over:` budget is
 *   honest — per-cell fixed costs by symbol count (trimmed cell characters:
 *   <5 symbols → 1s, 5+ symbols → 2s, reveal plus breath) plus a fixed border
 *   frame cost. Invisible mask-setup wipes are free and uncounted: the planner
 *   emits none, so they never consume budget nor appear in fractions.
 * - Non-cell actions (carries, text/label reveals, marks, teardown removals)
 *   split the remaining step time evenly and sequentially. Table budgets are
 *   fixed first; the remainder is shared.
 * - Overflow (#470): when fixed table budgets alone exceed the narrator
 *   estimate (or leave zero for non-cell actions), the owning prompter part is
 *   padded — slide duration grows to the board need — with `padded: true` on
 *   the slide plus a `overflow-padded` warning diagnostic. Slide length stays
 *   the sum of (padded) parts: each slide has one part, so duration is the
 *   padded total.
 * - Anchoring (#470): every board action ties to the owning prompt block
 *   (`prompt-N`, the single part mark per step) with a fractional position
 *   (midpoint of its `over:` window over the slide total). Fractions live in
 *   preview metadata only; generated scripts contain no absolute placements.
 *
 * Checker-clean ordering: paw `create asset` lines precede the
 * `bind node("paw ...")` lines so `node()` resolves to same-script creates
 * (forward references block the compile). With material `Chalk`, paw asset
 * definitions, audio embeds, and `slide.duration` set to the planned total,
 * `checkAnimationScript` returns runnable.
 *
 * Interpretation note: "no absolute placements" means no absolute *time*
 * placements (`at:`), per #467 story 15 ("no absolute times") and story 18
 * ("purely sequential ... without absolute times"). X/Y destinations remain:
 * `carry` requires `to:`, and parked performers require `at (x, y)`.
 * Generated sources therefore assert no `/\bat\s*:/` while still parking at
 * (1500, 1200)-style coordinates.
 */

import {
  isDelimiterRow,
  normalizeAssetKey,
  parseScenarioMarkdown,
  splitTableCells,
} from '../engine/scenarioMarkdown'
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
    | 'unknown-mark'
    | 'dangling-wipe'
    | 'missing-narrator'
    | 'missing-title'
    | 'non-sequential-heading'
    | 'bare-heading'
    | 'overflow-padded'
}

export interface PlannerSlide {
  /** 1-based position in the draft (Slide N). */
  readonly position: number
  /** Original `## Step N` number from the doc. */
  readonly stepIndex: number
  readonly title: string
  readonly slideName: string
  /**
   * Slide length = sum of (padded) prompter parts. One part per slide, so this
   * is the prompter estimate unless table budgets overflowed (see `padded`).
   */
  readonly duration: number
  /** Narrator estimate before padding (length × secondsPerCharacter). */
  readonly prompterDuration: number
  /** Fixed board need from table budgets + non-cell shares (equals duration). */
  readonly boardCost: number
  /** True when table budgets overflowed the narrator estimate and padded it. */
  readonly padded: boolean
  readonly prompterText: string
  readonly source: string
  /** Cursor mark in the generated source (`part-0` per single-part slide). */
  readonly markName: string
  /** Presentation id for the owning prompt block (`prompt-N`). */
  readonly promptBlockId: string
  /** Per-action block fractions (preview/context metadata, never syntax). */
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
  // `mark` is a valid scenario action per #467 vocabulary (temporary overlay,
  // needs no removal); bracket `[label:]` is *not* valid — chalk labels are
  // `> Label:` lines attached to visuals.
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

/** Cell economy (#470): trimmed symbols < threshold → short cost, else long. */
export const TABLE_SHORT_CELL_COST = 1
export const TABLE_LONG_CELL_COST = 2
export const TABLE_LONG_CELL_SYMBOLS = 5
/** Fixed border frame sweep per table reveal. */
export const TABLE_BORDER_COST = 1
/** Even share per non-cell action when tables overflow the narrator estimate. */
export const OVERFLOW_NONCELL_COST = 1
/** Fixed column width for generated `create table` statements. */
const TABLE_COLUMN_WIDTH = 150

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
      warning.code === 'unknown-mark' ||
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
    const prompterDuration = estimatePartDuration(prompterText, secondsPerCharacter)
    const markName = markNameForPart(0)
    const promptBlockId = `prompt-${position}`
    const built = buildBoardSource({
      slideName,
      prompterDuration,
      step,
      markName,
      position,
      promptBlockId,
    })
    if (built.padded) {
      diagnostics.push({
        severity: 'warning',
        code: 'overflow-padded',
        message:
          `Step ${step.index} board needs ${built.boardCost.toFixed(2)}s ` +
          `but the narrator sizes ${prompterDuration.toFixed(2)}s — ` +
          `owning prompter part padded to ${built.totalDuration.toFixed(2)}s`,
        step: step.index,
      })
    }
    return {
      position,
      stepIndex: step.index,
      title,
      slideName,
      duration: built.totalDuration,
      prompterDuration,
      boardCost: built.boardCost,
      padded: built.padded,
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

function isTableRevealId(id: string): boolean {
  // Scenario convention is `[reveal: table1]`-style ids: `table` plus an
  // optional numeric suffix. A bare prefix match would misclassify
  // `tableau1`-style text ids as tables.
  const key = normalizeAssetKey(id)
  return key === 'table' || /^table[-_]?\d+$/.test(key)
}

interface TablePlan {
  readonly name: string
  readonly rows: readonly (readonly string[])[]
  readonly cost: number
}

function planTableChunk(chunk: string, fallbackName: string): TablePlan | null {
  const lines = chunk
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
  if (lines.length < 2 || !isDelimiterRow(lines[1]!)) return null
  const header = splitTableCells(lines[0]!)
  const body = lines.slice(2).map(splitTableCells)
  const rows: string[][] = [header, ...body]
  const width = header.length
  if (width === 0) return null
  // Rectangularize ragged rows so `create table` stays valid. Padding slots
  // never existed in the markdown, so they cost nothing — only authored
  // cells consume budget.
  const rect = rows.map((row) => {
    const out = [...row]
    while (out.length < width) out.push('')
    return out.slice(0, width)
  })
  let cellTotal = 0
  for (let r = 0; r < rect.length; r += 1) {
    for (let c = 0; c < rect[r]!.length; c += 1) {
      if (c >= rows[r]!.length) continue
      // Symbols are code points (not UTF-16 units), so astral characters
      // count once.
      const symbols = Array.from(rows[r]![c]!.trim()).length
      cellTotal += symbols >= TABLE_LONG_CELL_SYMBOLS ? TABLE_LONG_CELL_COST : TABLE_SHORT_CELL_COST
    }
  }
  return { name: fallbackName, rows: rect, cost: cellTotal + TABLE_BORDER_COST }
}

function tableChunksOf(step: {
  blocks: readonly { kind: string; table?: string }[]
  table?: string
}): string[] {
  const fromBlocks = step.blocks
    .filter((b) => b.kind === 'table' && typeof b.table === 'string')
    .map((b) => (b as { table: string }).table)
  if (fromBlocks.length > 0) return fromBlocks
  if (step.table !== undefined) return [step.table]
  return []
}

function buildBoardSource(input: {
  slideName: string
  prompterDuration: number
  step: {
    placed: readonly string[]
    reveals: readonly string[]
    marks: readonly string[]
    removes: readonly string[]
    wipeTargets: readonly string[]
    wiped: boolean
    visuals: readonly { key: string; alt: string; label?: string }[]
    text?: string
    blocks: readonly { kind: string; table?: string }[]
    table?: string
  }
  markName: string
  position: number
  promptBlockId: string
}): {
  source: string
  fractions: readonly PlannerFraction[]
  boardCost: number
  totalDuration: number
  padded: boolean
} {
  const { slideName, prompterDuration, step, markName, promptBlockId } = input
  const taken = new Set<string>(['board', 'chalkpaw', 'ragpaw', 'pawempty'])

  type Effect =
    | { kind: 'carry-in'; alias: string; name: string }
    | { kind: 'table-reveal'; alias: string; name: string; cost: number }
    | { kind: 'reveal'; alias: string; name: string; content: string }
    | { kind: 'mark'; alias: string; name: string }
    | { kind: 'carry-away'; alias: string }
    | { kind: 'wipe'; alias: string }

  const creations: string[] = []
  const effects: Effect[] = []
  const boardItems = new Map<string, { alias: string; kind: 'carried' | 'revealed' }>()

  // Appearance order: placed images first (doc order), then labels, tables,
  // and text reveals. Table chunks pair with `[reveal: table*]` ids in order;
  // surplus chunks auto-reveal, surplus table ids fall back to text.
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
    if (boardItems.has(name)) continue
    boardItems.set(name, { alias, kind: 'revealed' })
    creations.push(
      `create text "${escapeQuoted(name)}" as ${alias} inside board { content: "${escapeQuoted(visual.label)}", fontSize: 26, alignment: "center" }`,
    )
    effects.push({ kind: 'reveal', alias, name, content: visual.label })
  }

  const chunks = tableChunksOf(step)
  const tableRevealIds = step.reveals.filter(isTableRevealId)
  const textRevealIds = step.reveals.filter((id) => !isTableRevealId(id))
  const paired = Math.min(chunks.length, tableRevealIds.length)
  const tablePlans: { plan: TablePlan; revealId: string }[] = []
  for (let i = 0; i < paired; i += 1) {
    const parsed = planTableChunk(chunks[i]!, tableRevealIds[i]!)
    if (!parsed) continue
    tablePlans.push({ plan: parsed, revealId: tableRevealIds[i]! })
  }
  // Surplus chunks auto-reveal with generated names.
  for (let i = paired; i < chunks.length; i += 1) {
    const fallback = `table${input.position}-${i + 1}`
    const parsed = planTableChunk(chunks[i]!, fallback)
    if (!parsed) continue
    tablePlans.push({ plan: { ...parsed, name: fallback }, revealId: fallback })
  }
  // Surplus table ids without markdown fall back to text reveals later.
  const surplusTableIds = tableRevealIds.slice(paired)

  for (const { plan, revealId } of tablePlans) {
    const key = normalizeAssetKey(revealId)
    const mapKey = key === '' ? revealId : key
    if (mapKey === '' || boardItems.has(mapKey)) continue
    const alias = uniqueAlias(mapKey, taken, `table${taken.size}`)
    boardItems.set(mapKey, { alias, kind: 'revealed' })
    const width = plan.rows[0]?.length ?? 1
    const columns = Array.from({ length: width }, () => `${TABLE_COLUMN_WIDTH}`).join(', ')
    const rowsText = plan.rows
      .map((row) => `[${row.map((cell) => `"${escapeQuoted(cell)}"`).join(', ')}]`)
      .join(', ')
    creations.push(
      `create table "${escapeQuoted(revealId)}" as ${alias} inside board { columns: [${columns}], rows: [${rowsText}] }`,
    )
    effects.push({ kind: 'table-reveal', alias, name: revealId, cost: plan.cost })
  }

  const chalkText = step.text?.trim() ?? ''
  const textIds = [...textRevealIds, ...surplusTableIds]
  if (textIds.length > 0) {
    for (const id of textIds) {
      const key = normalizeAssetKey(id)
      const mapKey = key === '' ? id : key
      if (mapKey === '' || boardItems.has(mapKey)) continue
      const alias = uniqueAlias(mapKey, taken, `text${taken.size}`)
      // Keep the scenario id verbatim as the quoted node name.
      boardItems.set(mapKey, { alias, kind: 'revealed' })
      const content = textIds.length === 1 && chalkText !== '' ? chalkText : id
      creations.push(
        `create text "${escapeQuoted(id)}" as ${alias} inside board { content: "${escapeQuoted(content)}", fontSize: 26, alignment: "center" }`,
      )
      effects.push({ kind: 'reveal', alias, name: id, content })
    }
  } else if (chalkText !== '' && tablePlans.length === 0) {
    // Chalk copy without an explicit reveal marker still appears once.
    // (When tables already cover the step, bare chalk stays in the prompter.)
    const name = `text${input.position}`
    const alias = uniqueAlias(name, taken, name)
    if (!boardItems.has(name)) {
      boardItems.set(name, { alias, kind: 'revealed' })
      creations.push(
        `create text "${escapeQuoted(name)}" as ${alias} inside board { content: "${escapeQuoted(chalkText)}", fontSize: 26, alignment: "center" }`,
      )
      effects.push({ kind: 'reveal', alias, name, content: chalkText })
    }
  }

  // Temporary marks highlight same-slide items and expire — never removed.
  // Cross-slide targets have no alias in this self-contained slide and are
  // skipped (the parser already validated them against the doc-wide board).
  for (const id of step.marks) {
    const key = normalizeAssetKey(id)
    const item = boardItems.get(key === '' ? id : key)
    if (!item) continue
    effects.push({ kind: 'mark', alias: item.alias, name: id })
  }

  // Teardown within the same slide, kind-matched and in reverse appearance
  // order. Full `[wipe]` reverses everything; targeted `[remove:]/[wipe:]`
  // expands only the listed ids present here. Marks never appear in
  // boardItems, so they need no removal.
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

  // Budget: fixed table reveals first, then even shares for the rest.
  const tableTotal = effects
    .filter((e) => e.kind === 'table-reveal')
    .reduce((sum, e) => sum + (e as { cost: number }).cost, 0)
  const nonTableCount = effects.filter((e) => e.kind !== 'table-reveal').length
  let nonTableShare = 0
  let totalDuration = prompterDuration
  let padded = false
  if (nonTableCount === 0) {
    if (tableTotal > prompterDuration) {
      padded = true
      totalDuration = tableTotal
    } else {
      totalDuration = prompterDuration
    }
  } else if (
    tableTotal > prompterDuration ||
    (prompterDuration - tableTotal) / nonTableCount <= 1e-9
  ) {
    // Overflow: tables alone exceed the narrator, or leave zero for the
    // rest. Pad the owning part; non-cell actions get a fixed even share.
    padded = true
    nonTableShare = OVERFLOW_NONCELL_COST
    totalDuration = tableTotal + nonTableCount * nonTableShare
  } else {
    nonTableShare = (prompterDuration - tableTotal) / nonTableCount
    totalDuration = prompterDuration
  }
  const boardCost = totalDuration
  const durations = effects.map((e) => (e.kind === 'table-reveal' ? e.cost : nonTableShare))

  // Checker-clean order: paw creates precede `bind node(...)` so the binds
  // resolve to same-script nodes (no forward references).
  const lines: string[] = []
  lines.push(`script "${escapeQuoted(slideName)}" from 0`)
  lines.push(`let slideLen = ${Number(totalDuration.toFixed(2))}`)
  lines.push('create group "Board" as board')
  for (const paw of PARKED) {
    lines.push(
      `create asset "${paw.name}" as ${paw.alias} at (${paw.x}, ${paw.y}) { scaleX: 0.12, scaleY: 0.12 }`,
    )
  }
  lines.push('bind chalk = material("Chalk")')
  lines.push('bind chalkHand = node("paw with chalk")')
  lines.push('bind ragHand = node("paw with rag")')
  lines.push('bind emptyHand = node("paw empty")')
  lines.push('bind writeSfx = audio("writing-on-black-board")')
  lines.push('bind eraseSfx = audio("dry-erase")')
  lines.push('board.material(chalk)')
  lines.push(`mark("${markName}")`)
  lines.push(...creations)

  const fractions: PlannerFraction[] = []
  let cursor = 0
  effects.forEach((effect, index) => {
    const over = durations[index] ?? 0
    const overText = `, over: ${Number(over.toFixed(2))}`
    const action =
      effect.kind === 'carry-in' || effect.kind === 'carry-away'
        ? `carry(${effect.alias})`
        : effect.kind === 'reveal' || effect.kind === 'table-reveal'
          ? `reveal(${effect.alias})`
          : effect.kind === 'mark'
            ? `mark(${effect.alias})`
            : `wipe(${effect.alias})`
    const fraction = totalDuration > 0 ? (cursor + over / 2) / totalDuration : 0
    fractions.push({ action, block: promptBlockId, fraction })
    cursor += over
    switch (effect.kind) {
      case 'carry-in':
        lines.push(
          `carry(${effect.alias}, to: { x: ${BOARD_HOME.x}, y: ${BOARD_HOME.y} }${overText}, visual: emptyHand)`,
        )
        break
      case 'table-reveal':
      case 'reveal':
        lines.push(`reveal(${effect.alias}${overText}, visual: chalkHand, sound: writeSfx)`)
        break
      case 'mark':
        lines.push(`mark(${effect.alias}${overText}, visual: chalkHand)`)
        break
      case 'carry-away':
        lines.push(
          `carry(${effect.alias}, to: { x: ${PARKED_HOME.x}, y: ${PARKED_HOME.y} }${overText}, visual: emptyHand)`,
        )
        break
      case 'wipe':
        lines.push(`wipe(${effect.alias}${overText}, visual: ragHand, sound: eraseSfx)`)
        break
    }
  })
  lines.push(`// slide ends at ${Number(totalDuration.toFixed(2))}s = sum of prompter parts`)
  return { source: `${lines.join('\n')}\n`, fractions, boardCost, totalDuration, padded }
}
