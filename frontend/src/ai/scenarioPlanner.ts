/**
 * Scenario planner core + tables/teardown economy (issues #469, #470).
 *
 * Deterministic, LLM-free pure seam: accepted scenario markdown plus the
 * project secondsPerCharacter setting yields a strict Slide N = Step N plan
 * with split prompter parts per slide and a fixture-styled absolute board
 * draft (ser-estar-lesson.script).
 *
 * Identity (#469): positional convergence of middle slides to steps; display
 * name mirrors the step heading; insert/delete/rename middles, intro/outro
 * left to the caller.
 *
 * Prompter: narrator split like manual paste but sentence-level — `.`, `!`,
 * `?`, line breaks, em dash (commas/semicolons/colons never split generated
 * blocks) — plus isolated foreign words/phrases as their own blocks
 * (foreign list from chalk HTML `<strong class="foreign">` with stored
 * fallback); duration = sum of part lengths × secondsPerCharacter.
 *
 * Board (fixture-styled absolute timing):
 * - Sequential sources with absolute `at:` placements anchored to the
 *   owning prompt block (`at: markTime("part-N") + offset`, so voice
 *   retiming shifts the board); the new `markTime("marker")` read makes the
 *   arithmetic possible and `let` calibration variables compose with it.
 *   Marks are placed first at the voice window starts (`at(<seconds>)`),
 *   then effects reference them — never the reverse.
 * - Content-sized sweeps: reveal/wipe `over:` ≈ 0.1s per character clamped
 *   to [0.4, 4.0]; carries 1.5s with a 0.8s approach; table borders 1.2s;
 *   mask-setup wipes 0.01s with `visual: none`; temporary marks 0.6s;
 *   subtree wipes 1.0s. A 0.5s breath separates consecutive sweeps.
 * - Fixture staging: backdrop asset first, title top-center (64pt centered
 *   card when the step stages nothing, else 40/36/32pt), carried cards at
 *   y 360 (0.34 scale, split across 340/750 for pairs), labels stacked at
 *   y 505 + 43, tables centered below the content with empty cells plus
 *   per-cell text (mask wipes, then chained cell reveals), kind-matched
 *   teardown in reverse appearance order with `wipe(subtree(...))` for
 *   tables. Reveals carry the chalk hand, wobbles, `visualScale: 4`,
 *   `visualAnchor: "top-center"` and sounds (write/erase); carries and
 *   temporary marks take no wobble or sound. Text nodes are tinted
 *   #F5E6C8.
 * - The backdrop group is reused per slide, paw performers start parked
 *   off-screen, scenario normalized asset keys stay verbatim in quoted names.
 * - Overflow: when the board choreography outruns the narrator, the slide
 *   pads to the board end (`padded: true` plus an `overflow-padded`
 *   warning); voice part durations never stretch.
 * - Anchoring: every board action ties to its owning prompt block
 *   (proportional voice position, table chains pinned to their border's
 *   block) with a fractional position (midpoint over the slide total).
 *   Fractions live in preview metadata only.
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
import { DEFAULT_PROMPTER_SPLIT_CHARS } from '../engine/prompter'
import { resolveForeignWords, splitNarratorToPromptParts } from './scenarioPromptSplit'

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

export interface PlannerPromptPart {
  /** Split prompter text for one block (delimiters stripped, like manual paste). */
  readonly text: string
  /** Padded duration (sums to the slide total). */
  readonly duration: number
  /** Presentation id for this block (`prompt-N-M`). */
  readonly promptBlockId: string
  /** Compile-time mark for this block (`part-M`). */
  readonly markName: string
}

export interface PlannerSlide {
  /** 1-based position in the draft (Slide N). */
  readonly position: number
  /** Original `## Step N` number from the doc. */
  readonly stepIndex: number
  readonly title: string
  readonly slideName: string
  /**
   * Slide length = voice total (sum of part estimates), or the board
   * choreography end when the board outruns the voice (`padded`). Multiple
   * parts per slide: sentences split on sentence terminators with foreign
   * words isolated as their own blocks (mirrors manual prompter paste).
   */
  readonly duration: number
  /** Narrator estimate (sum of part lengths × secondsPerCharacter). */
  readonly prompterDuration: number
  /** Board choreography end (equals duration when the board sets the length). */
  readonly boardCost: number
  /** True when the board choreography outran the narrator and padded the slide. */
  readonly padded: boolean
  /** Original verbatim narrator (reference; parts carry the split texts). */
  readonly prompterText: string
  /** Ordered prompt blocks for this slide (one PrompterPart each on apply). */
  readonly prompterParts: readonly PlannerPromptPart[]
  readonly source: string
  /** First part mark (`part-0`) — kept for single-mark readers. */
  readonly markName: string
  /** Base presentation id for the slide (`prompt-N`) — parts use `prompt-N-M`. */
  readonly promptBlockId: string
  /** Per-action block fractions (preview/context metadata, never syntax). */
  readonly fractions: readonly PlannerFraction[]
}

export interface PlannerOptions {
  /** Split delimiters (defaults to prompter setting / DEFAULT_PROMPTER_SPLIT_CHARS). */
  readonly splitChars?: readonly string[]
  /** Pre-resolved foreign words/phrases (unioned with HTML extraction). */
  readonly foreignWords?: readonly string[]
  /** Stored chalk HTML — `<strong class="foreign">` spans are parsed for foreigns. */
  readonly html?: string
  /** Checklist bindings: normalized scenario key → bound asset id. */
  readonly bindings?: Readonly<Record<string, string>>
  /** Asset names by id (embedded + library) — bound `create asset` names. */
  readonly assetNames?: Readonly<Record<string, string>>
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
  // Single-line string literals only: the script tokenizer ends a string at
  // a raw newline (unterminated-string diagnostic), and `\n` escapes compile
  // to a literal `n`, so newlines must never reach the quotes — callers pass
  // one paragraph per node and this is the backstop.
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r\n?/g, ' ').replace(/\n/g, ' ')
}

/** Chalk paragraphs (blank-line separated) as single-line board contents. */
function splitChalkParagraphs(chalkText: string): string[] {
  return chalkText
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part !== '')
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
  options: PlannerOptions = {},
): PlannerResult {
  return planFromParsed(parsed, secondsPerCharacter, existingSlides, rawMarkdown, options)
}

export function planScenarioDraft(
  markdown: string,
  secondsPerCharacter: number,
  existingSlides: readonly PlannerExistingSlide[] = [],
  options: PlannerOptions = {},
): PlannerResult {
  if (!(secondsPerCharacter > 0)) throw new Error('secondsPerCharacter must be > 0')
  const parsed = parseScenarioMarkdown(markdown)
  return planFromParsed(parsed, secondsPerCharacter, existingSlides, markdown, options)
}

function planFromParsed(
  parsed: ParsedScenario,
  secondsPerCharacter: number,
  existingSlides: readonly PlannerExistingSlide[],
  rawMarkdown: string,
  options: PlannerOptions = {},
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

  const configuredSplitChars = options.splitChars ?? [...DEFAULT_PROMPTER_SPLIT_CHARS]
  // Prompt blocks are sentence-level (`.`, `!`, `?`, line breaks, em dash):
  // commas/semicolons/colons fragment narration into unspeakable shards
  // (`like identity`, `origin`) and starve the board into 10s crawls, so they
  // stay manual-paste-only and never split generated blocks.
  const SENTENCE_SPLIT = new Set(['.', '!', '?', '\n', '—'])
  let splitChars = configuredSplitChars.filter((c) => SENTENCE_SPLIT.has(c))
  if (splitChars.length === 0) splitChars = ['.', '!', '?', '\n']
  const foreignWords = resolveForeignWords(options.html, options.foreignWords)

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
    // Split like manual prompter paste (sentence delimiters) and isolate
    // foreign words as their own blocks. Falls back to verbatim so a slide
    // never plans zero parts.
    let splitTexts = splitNarratorToPromptParts(prompterText, splitChars, foreignWords)
    if (splitTexts.length === 0) {
      const fallback = prompterText.trim()
      splitTexts = fallback !== '' ? [fallback] : ['']
    }
    const estimates = splitTexts.map((text) => estimatePartDuration(text, secondsPerCharacter))
    // Reuses the duration estimator via the narration mirror (same function).
    const prompterDuration = estimates.reduce((sum, value) => sum + value, 0)
    const basePromptBlockId = `prompt-${position}`
    const subBlockIds = splitTexts.map((_, index) => `${basePromptBlockId}-${index + 1}`)
    const subMarkNames = splitTexts.map((_, index) => markNameForPart(index))
    const markName = subMarkNames[0] ?? markNameForPart(0)
    // Bound library names win over raw md slugs: the checklist binds each
    // normalized scenario key to an asset id, and `create asset` must name
    // the asset the user actually bound (e.g. "fox"), not the md slug
    // (e.g. "red-fox"). Unbound slugs fall back to verbatim.
    const assetNameForPlaced = (slug: string): string => {
      const boundId = options.bindings?.[normalizeAssetKey(slug)]
      if (boundId !== undefined) {
        const name = options.assetNames?.[boundId]
        if (name !== undefined && name !== '') return name
      }
      return slug
    }
    const built = buildBoardSource({
      slideName,
      prompterDuration,
      step,
      position,
      basePromptBlockId,
      subBlockIds,
      subMarkNames,
      partEstimates: estimates,
      assetNameForPlaced,
      stepIndex: step.index,
      html: options.html,
    })
    if (built.padded) {
      diagnostics.push({
        severity: 'warning',
        code: 'overflow-padded',
        message:
          `Step ${step.index} board needs ${built.boardCost.toFixed(2)}s ` +
          `but the narrator sizes ${prompterDuration.toFixed(2)}s — ` +
          `slide padded to ${built.totalDuration.toFixed(2)}s past the voice`,
        step: step.index,
      })
    }
    const prompterParts: PlannerPromptPart[] = splitTexts.map((text, index) => ({
      text,
      duration: built.partDurations[index] ?? 0,
      promptBlockId: subBlockIds[index]!,
      markName: subMarkNames[index]!,
    }))
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
      prompterParts,
      source: built.source,
      markName,
      promptBlockId: basePromptBlockId,
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
  // Rectangularize ragged rows so `create table` stays valid.
  const rect = rows.map((row) => {
    const out = [...row]
    while (out.length < width) out.push('')
    return out.slice(0, width)
  })
  return { name: fallbackName, rows: rect }
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
  position: number
  basePromptBlockId: string
  subBlockIds: readonly string[]
  subMarkNames: readonly string[]
  partEstimates: readonly number[]
  assetNameForPlaced: (slug: string) => string
  stepIndex: number
  html?: string
}): {
  source: string
  fractions: readonly PlannerFraction[]
  boardCost: number
  totalDuration: number
  padded: boolean
  partDurations: readonly number[]
} {
  const {
    slideName,
    prompterDuration,
    step,
    basePromptBlockId,
    subBlockIds,
    subMarkNames,
    partEstimates,
    assetNameForPlaced,
    stepIndex,
    html,
  } = input
  const taken = new Set<string>(['board', 'background', 'chalkpaw', 'ragpaw', 'pawempty'])

  type Effect =
    | {
        kind: 'carry-in'
        alias: string
        name: string
        fromX: number
        fromY: number
        toX: number
        toY: number
      }
    | { kind: 'table-border'; alias: string; name: string; tableAlias: string }
    | { kind: 'table-mask'; alias: string; tableAlias: string }
    | { kind: 'table-cell'; alias: string; name: string; content: string; tableAlias: string }
    | { kind: 'reveal'; alias: string; name: string; content: string }
    | { kind: 'mark'; alias: string; name: string }
    | {
        kind: 'carry-away'
        alias: string
        fromX: number
        fromY: number
        toX: number
        toY: number
      }
    | { kind: 'wipe'; alias: string; content?: string }
    | { kind: 'wipe-subtree'; alias: string; name: string; tableAlias?: string }

  const creations: string[] = []
  const effects: Effect[] = []
  /** Removal sweeps from the teardown section — clustered at the slide tail. */
  const teardownEffects = new Set<Effect>()
  const boardItems = new Map<
    string,
    {
      alias: string
      kind: 'carried' | 'revealed' | 'table'
      content?: string
      parkedX?: number
      parkedY?: number
      slotX?: number
      slotY?: number
      title?: boolean
    }
  >()
  const binds: string[] = []
  const tints: string[] = []

  /** Fixture staging: the lesson backdrop as placed in the project. */
  const BG_ASSET = 'blackboar-background'
  const BG_AT = { x: 545, y: 446.5 } as const
  const BG_SCALE = 0.20671296296296296
  const CARD_SCALE = 0.34
  const CARD_PARKED: readonly { readonly x: number; readonly y: number }[] = [
    { x: 1500, y: 1200 },
    { x: 1640, y: 1200 },
    { x: 1780, y: 1200 },
  ]

  function tintAlias(alias: string): void {
    tints.push(`${alias}.tint("${TITLE_TINT}")`)
  }

  const TITLE_TINT = '#F5E6C8'

  /** Chalk accent palette shared with scenarioChalkRender (accent-* classes). */
  const ACCENT_HEX: Record<string, string> = {
    'accent-yellow': '#F2D98C',
    'accent-pink': '#F2A9C4',
    'accent-blue': '#A9CDF2',
    'accent-green': '#A8D5A2',
    'accent-orange': '#F2B880',
  }

  function decodeHtmlEntities(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  }

  function normalizeMatchText(text: string): string {
    return decodeHtmlEntities(text.replace(/<[^>]*>/g, ''))
      .replace(/\*\*/g, '')
      .replace(/__/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  interface HtmlColorEntry {
    text: string
    color: string
    used: boolean
  }

  /** Board-text colors in document order for this step's HTML section. */
  function htmlColorEntries(): HtmlColorEntry[] {
    if (!html) return []
    const sectionRe = new RegExp(
      `<section[^>]*data-step="${stepIndex}"[^>]*>([\\s\\S]*?)<\\/section>`,
      'i',
    )
    const sectionMatch = sectionRe.exec(html)
    const scope = sectionMatch?.[1] ?? html
    const out: HtmlColorEntry[] = []
    // figcaptions (visual labels), board-label paragraphs, chalk-text
    // paragraphs — the exact sources board titles/labels are built from.
    const re =
      /<(figcaption|p)[^>]*class="[^"]*\b(accent-[a-z]+)\b[^"]*"[^>]*>([\s\S]*?)<\/(?:figcaption|p)>/gi
    let match: RegExpExecArray | null
    while ((match = re.exec(scope)) !== null) {
      const color = ACCENT_HEX[match[2]!] ?? TITLE_TINT
      const text = normalizeMatchText(match[3] ?? '')
      if (text === '') continue
      out.push({ text, color, used: false })
    }
    return out
  }

  const htmlColors = htmlColorEntries()

  /** Steal the label/title color from the generated HTML when it matches. */
  function tintAliasForContent(alias: string, content: string): void {
    const needle = normalizeMatchText(content)
    if (needle !== '') {
      const exact = htmlColors.find((entry) => !entry.used && entry.text === needle)
      const fuzzy = exact ?? htmlColors.find((entry) => !entry.used && entry.text.includes(needle))
      if (fuzzy) {
        fuzzy.used = true
        tints.push(`${alias}.tint("${fuzzy.color}")`)
        return
      }
    }
    tintAlias(alias)
  }

  /** Content-sized sweep: ~0.1s per character, clamped to [0.4, 4.0]. */
  function contentOver(text: string): number {
    const symbols = Array.from(text.trim()).length
    return Math.min(4, Math.max(0.4, symbols * 0.1))
  }

  /**
   * Wobble per the fixture scheme: full words, little for two-glyph cells,
   * none for lone dashes. Mark overlays never wobble (the language forbids it).
   */
  function wobbleFor(text: string): string {
    const trimmed = text.trim()
    if (trimmed === '' || trimmed === '-' || trimmed === '—') return ''
    if (Array.from(trimmed).length <= 2) {
      return ', wobbleX: { from: 4, to: 8 }, wobbleY: { from: 3, to: 6 }, wobbleSpeed: 7'
    }
    return ', wobbleX: { from: 12, to: 24 }, wobbleY: { from: 8, to: 18 }, wobbleSpeed: 7'
  }

  const VISUAL_SUFFIX = ', visualScale: 4, visualAnchor: "top-center"'
  /** Table border draw wobble: Y grows with row count (2x at 4 rows, 3x at 6). */
  function tableBorderWobble(rows: number): string {
    const factor = Math.min(3, Math.max(1, rows / 2))
    const fromY = Math.round(8 * factor)
    const toY = Math.round(18 * factor)
    return `, wobbleX: { from: 12, to: 24 }, wobbleY: { from: ${fromY}, to: ${toY} }, wobbleSpeed: 7`
  }
  /** Vertical gap between cascaded tables sharing one slide. */
  const TABLE_STACK_GAP = 60
  /** Estimated table row height for cascade spacing. */
  const EST_TABLE_ROW_H = 34
  /** Planned table homes (y + estimated height) for cascade spacing. */
  const tableHomes: { y: number; h: number }[] = []
  /** Table row counts by table node alias for border wobble scaling. */
  const tableRowCounts = new Map<string, number>()

  // Appearance order: placed images first (doc order), then labels, tables,
  // and text reveals. Table chunks pair with `[reveal: table*]` ids in order;
  // surplus chunks auto-reveal, surplus table ids fall back to text.
  const placedSlugs: string[] = []
  for (const slug of step.placed) {
    const key = normalizeAssetKey(slug)
    if (key === '' || boardItems.has(key)) continue
    const parked = CARD_PARKED[placedSlugs.length % CARD_PARKED.length]!
    const alias = uniqueAlias(key, taken, `item${taken.size}`)
    boardItems.set(key, { alias, kind: 'carried', parkedX: parked.x, parkedY: parked.y })
    placedSlugs.push(slug)
    creations.push(
      `create asset "${escapeQuoted(assetNameForPlaced(slug))}" as ${alias} at (${parked.x}, ${parked.y}) { scaleX: ${CARD_SCALE}, scaleY: ${CARD_SCALE} }`,
    )
  }

  /** Board slots for carried cards: center solo, split pairs, spread crowds. */
  function cardSlots(count: number): { x: number; y: number }[] {
    if (count <= 1) return [{ x: BOARD_HOME.x, y: BOARD_HOME.y }]
    if (count === 2)
      return [
        { x: 340, y: 330 },
        { x: 750, y: 330 },
      ]
    return Array.from({ length: count }, (_, i) => ({
      x: 340 + (410 * i) / (count - 1),
      y: 330,
    }))
  }

  const slots = cardSlots(placedSlugs.length)
  placedSlugs.forEach((slug, index) => {
    const key = normalizeAssetKey(slug)
    const item = boardItems.get(key === '' ? slug : key)
    if (!item) return
    const slot = slots[index]!
    item.slotX = slot.x
    item.slotY = slot.y
    effects.push({
      kind: 'carry-in',
      alias: item.alias,
      name: slug,
      fromX: item.parkedX ?? PARKED_HOME.x,
      fromY: item.parkedY ?? PARKED_HOME.y,
      toX: slot.x,
      toY: slot.y,
    })
  })

  // Title + label slots. The first chalk paragraph is the board title;
  // visual labels and surplus paragraphs stack below the card.
  const hasCard = placedSlugs.length > 0
  let labelY = 505
  const nextLabelY = (): number => {
    const y = labelY
    labelY += 43
    return y
  }
  const titlePos =
    placedSlugs.length >= 2 ? { x: 545, y: 120 } : hasCard ? { x: 545, y: 150 } : { x: 545, y: 220 }
  function titleSize(text: string): number {
    if (!hasCard) return 64
    const len = Array.from(text.trim()).length
    if (len <= 25) return 40
    if (len <= 35) return 36
    return 32
  }

  function pushTitleOrLabel(name: string, content: string, role: 'title' | 'label'): void {
    const key = normalizeAssetKey(name)
    const mapKey = key === '' ? name : key
    if (mapKey === '' || boardItems.has(mapKey)) return
    const alias = uniqueAlias(mapKey, taken, `text${taken.size}`)
    // Keep the scenario id verbatim as the quoted node name.
    boardItems.set(mapKey, { alias, kind: 'revealed', content, title: role === 'title' })
    const pos = role === 'title' ? titlePos : { x: 545, y: nextLabelY() }
    const fontSize = role === 'title' ? titleSize(content) : 26
    creations.push(
      `create text "${escapeQuoted(name)}" as ${alias} at (${pos.x}, ${pos.y}) inside board { content: "${escapeQuoted(content)}", fontSize: ${fontSize}, alignment: "center" }`,
    )
    tintAliasForContent(alias, content)
    effects.push({ kind: 'reveal', alias, name, content })
    if (role === 'title' && titleEffectIndex < 0) titleEffectIndex = effects.length - 1
  }

  // Index of the step title reveal: the fixture opens every step with the
  // title before any card, label or table moves. Hoisted to the front of the
  // effect order below (ownership follows the moved position).
  let titleEffectIndex = -1

  // Visual labels ride with their image: chalk text revealed under the card.
  for (const visual of step.visuals) {
    if (!visual.label || visual.label.trim() === '') continue
    const name = `${visual.key}-label`
    if (boardItems.has(name)) continue
    pushTitleOrLabel(name, visual.label, 'label')
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

  let previousTableAlias: string | null = null
  let previousTableName = ''
  for (const { plan, revealId } of tablePlans) {
    const key = normalizeAssetKey(revealId)
    const mapKey = key === '' ? revealId : key
    if (mapKey === '' || boardItems.has(mapKey)) continue
    const alias = uniqueAlias(mapKey, taken, `table${taken.size}`)
    boardItems.set(mapKey, { alias, kind: 'table' })
    const width = plan.rows[0]?.length ?? 1
    const height = plan.rows.length
    const columns = Array.from({ length: width }, () => `${TABLE_COLUMN_WIDTH}`).join(', ')
    // Empty cells: content lives in per-cell text nodes (fixture style) so
    // each cell reveals on its own chained sweep after a mask-setup wipe.
    const emptyRows = Array.from(
      { length: height },
      () => `[${Array.from({ length: width }, () => `""`).join(', ')}]`,
    ).join(', ')
    const tableWidth = width * TABLE_COLUMN_WIDTH
    // Below the card/labels when the step stages any, recap height otherwise.
    // Stacked tables cascade down: each next table starts below the previous
    // table's estimated band plus a gap, so tables never share the same area.
    const tableX = Math.round(545 - tableWidth / 2)
    const tableY =
      tableHomes.length === 0
        ? hasCard || labelY > 505
          ? 580
          : 300
        : (tableHomes[tableHomes.length - 1]?.y ?? 300) +
          (tableHomes[tableHomes.length - 1]?.h ?? 0) +
          TABLE_STACK_GAP
    tableHomes.push({ y: tableY, h: height * EST_TABLE_ROW_H + 4 })
    tableRowCounts.set(alias, height)
    creations.push(
      `create table "${escapeQuoted(revealId)}" as ${alias} at (${tableX}, ${tableY}) inside board { columns: [${columns}], rows: [${emptyRows}], padding: 6, borderWidth: 2, borderColor: "#FFFFFF", background: "transparent" }`,
    )
    if (previousTableAlias !== null) {
      // Recap pattern: clear the previous grid before the next border draws.
      effects.push({
        kind: 'wipe-subtree',
        alias: previousTableAlias,
        name: previousTableName,
        tableAlias: alias,
      })
    }
    previousTableAlias = alias
    previousTableName = revealId
    effects.push({ kind: 'table-border', alias, name: revealId, tableAlias: alias })
    plan.rows.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (c >= width) return
        const cellName = `${revealId}c${r}${c}`
        const cellKey = normalizeAssetKey(cellName)
        const cellMapKey = cellKey === '' ? cellName : cellKey
        if (cellMapKey === '' || boardItems.has(cellMapKey)) return
        const cellAlias = uniqueAlias(cellMapKey, taken, `cell${taken.size}`)
        // Cells are covered by the table teardown; no individual removal.
        creations.push(
          `create text "${escapeQuoted(cellName)}" as ${cellAlias} at (5, 5) inside ${alias}.cell(${r}, ${c}) { content: "${escapeQuoted(cell)}", fontSize: 17 }`,
        )
        tintAlias(cellAlias)
        effects.push({ kind: 'table-mask', alias: cellAlias, tableAlias: alias })
        effects.push({
          kind: 'table-cell',
          alias: cellAlias,
          name: cellName,
          content: cell,
          tableAlias: alias,
        })
      })
    })
  }

  const chalkText = step.text?.trim() ?? ''
  const textIds = [...textRevealIds, ...surplusTableIds]
  // One board node per chalk paragraph: quoted strings are single-line in
  // the script grammar, so a multi-paragraph `step.text` (chalk line plus
  // orphan `> Label:` paragraphs) must never share one `content: "..."`.
  // The first paragraph is the board title; surplus paragraphs auto-reveal
  // as caption labels like surplus table chunks.
  if (textIds.length > 0) {
    if (textIds.length === 1 && chalkText !== '') {
      const paragraphs = splitChalkParagraphs(chalkText)
      if (paragraphs.length <= 1) {
        pushTitleOrLabel(
          textIds[0]!,
          paragraphs[0] ?? chalkText.replace(/\s+/g, ' ').trim(),
          'title',
        )
      } else {
        pushTitleOrLabel(textIds[0]!, paragraphs[0]!, 'title')
        paragraphs.slice(1).forEach((paragraph, index) => {
          pushTitleOrLabel(`${textIds[0]}-${index + 2}`, paragraph, 'label')
        })
      }
    } else {
      textIds.forEach((id, index) => {
        pushTitleOrLabel(id, id, index === 0 ? 'title' : 'label')
      })
    }
  } else if (chalkText !== '' && tablePlans.length === 0) {
    // Chalk copy without an explicit reveal marker still appears once.
    // (When tables already cover the step, bare chalk stays in the prompter.)
    const name = `text${input.position}`
    const paragraphs = splitChalkParagraphs(chalkText)
    if (paragraphs.length <= 1) {
      if (!boardItems.has(name)) {
        pushTitleOrLabel(name, paragraphs[0] ?? chalkText.replace(/\s+/g, ' ').trim(), 'title')
      }
    } else {
      paragraphs.forEach((paragraph, index) => {
        pushTitleOrLabel(
          index === 0 ? name : `${name}-${index + 1}`,
          paragraph,
          index === 0 ? 'title' : 'label',
        )
      })
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

  // Teardown within the same slide, kind-matched in fixture order: caption
  // labels clear first, carried cards fly home, tables wipe as subtrees,
  // the title wipes last. A bare `[wipe]` always clears the whole board,
  // even when targeted `[remove:]/[wipe:]` entries are also present (those
  // only pin mid-slide recaps like the previous-table clear); without a bare
  // wipe, targeted entries expand in listed order instead. Marks never appear
  // in boardItems, so they need no removal.
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
    if (item.kind === 'carried') {
      return {
        kind: 'carry-away',
        alias: item.alias,
        fromX: item.slotX ?? BOARD_HOME.x,
        fromY: item.slotY ?? BOARD_HOME.y,
        toX: item.parkedX ?? PARKED_HOME.x,
        toY: item.parkedY ?? PARKED_HOME.y,
      }
    }
    if (item.kind === 'table') return { kind: 'wipe-subtree', alias: item.alias, name: key }
    return { kind: 'wipe', alias: item.alias, content: item.content }
  }
  // Already-hidden guard: a teardown removal whose whole target was wiped
  // after its last reveal would flash hidden content back (a wipe starts
  // fully open and only hides as it sweeps), so it is dropped instead.
  // Cell ownership for subtree coverage (cell alias → table alias).
  const cellOwner = new Map<string, string>()
  effects.forEach((effect) => {
    if (effect.kind === 'table-mask' || effect.kind === 'table-cell') {
      cellOwner.set(effect.alias, effect.tableAlias)
    }
  })
  const REVEAL_LIKE: ReadonlySet<Effect['kind']> = new Set([
    'reveal',
    'carry-in',
    'table-border',
    'table-cell',
  ])
  const WIPE_LIKE: ReadonlySet<Effect['kind']> = new Set([
    'wipe',
    'wipe-subtree',
    'table-mask',
    'carry-away',
  ])
  /** Aliases a removal sweep covers: itself, plus table cells for subtrees. */
  function coveredMembers(alias: string, subtree: boolean): string[] {
    if (!subtree) return [alias]
    const out = [alias]
    cellOwner.forEach((table, cell) => {
      if (table === alias) out.push(cell)
    })
    return out
  }
  /**
   * Whether every covered member's latest visibility effect is a wipe: the
   * border sweep also uncovers cell texts while drawing, so it counts as a
   * reveal for its table's cells.
   */
  function isAlreadyHidden(alias: string, subtree: boolean): boolean {
    return coveredMembers(alias, subtree).every((member) => {
      const ownerTable = cellOwner.get(member)
      let lastReveal = -1
      let lastWipe = -1
      effects.forEach((effect, index) => {
        const onMember = effect.alias === member
        const onTable =
          ownerTable !== undefined &&
          effect.kind === 'table-border' &&
          effect.tableAlias === ownerTable
        const inSubtree =
          effect.kind === 'wipe-subtree' && (effect.alias === member || effect.alias === ownerTable)
        if ((onMember && REVEAL_LIKE.has(effect.kind)) || onTable) lastReveal = index
        if ((onMember && WIPE_LIKE.has(effect.kind)) || inSubtree) lastWipe = index
      })
      return lastWipe > lastReveal
    })
  }
  if (step.wiped) {
    const labels = appearanceKeys.filter((key) => {
      const item = boardItems.get(key)
      return item?.kind === 'revealed' && !item.title
    })
    const carried = appearanceKeys.filter((key) => boardItems.get(key)?.kind === 'carried')
    const tables = appearanceKeys.filter((key) => boardItems.get(key)?.kind === 'table')
    const titles = appearanceKeys.filter((key) => {
      const item = boardItems.get(key)
      return item?.kind === 'revealed' && item.title
    })
    for (const key of [...labels, ...carried, ...tables, ...titles]) {
      const removal = kindMatchedRemoval(key)
      if (!removal) continue
      // Skip removals of already-hidden targets: re-wiping flashes them back.
      if (isAlreadyHidden(removal.alias, removal.kind === 'wipe-subtree')) continue
      effects.push(removal)
      teardownEffects.add(removal)
    }
  } else {
    for (const id of [...step.removes, ...step.wipeTargets]) {
      const key = normalizeAssetKey(id)
      const removal = kindMatchedRemoval(key === '' ? id : key)
      if (!removal) continue
      // Skip removals of already-hidden targets: re-wiping flashes them back.
      if (isAlreadyHidden(removal.alias, removal.kind === 'wipe-subtree')) continue
      effects.push(removal)
      teardownEffects.add(removal)
    }
  }

  // Voice windows stay exactly as estimated: absolute board timing no longer
  // stretches sweeps to fill the voice, so parts are never padded — the
  // slide extends past the voice only when the board choreography needs it.
  const partCount = partEstimates.length
  const partDurations: readonly number[] = [...partEstimates]
  const partStarts: number[] = []
  const partEnds: number[] = []
  {
    let cursor = 0
    for (const dur of partDurations) {
      partStarts.push(cursor)
      cursor += dur
      partEnds.push(cursor)
    }
  }
  function owningPartIndex(position: number): number {
    if (partCount === 0) return -1
    for (let i = 0; i < partEnds.length; i += 1) {
      if (position < partEnds[i]! - 1e-9 || i === partEnds.length - 1) return i
    }
    return partEnds.length - 1
  }

  // The step title opens the choreography (fixture order: title, cards,
  // labels, tables, teardown), so hoist its reveal ahead of everything else.
  if (titleEffectIndex > 0) {
    const [titleEffect] = effects.splice(titleEffectIndex, 1)
    if (titleEffect) effects.unshift(titleEffect)
  }

  // Own each effect to the prompt block holding its proportional voice
  // position: effect i of n sits at (i + 0.5) / n of the voice timeline.
  // A table's border, mask wipes, cell reveals and preceding grid wipe pin to
  // the border's owner so the grid builds in one chained sweep instead of
  // scattering.
  const effectOwners: number[] = effects.map((_, index) =>
    prompterDuration > 0
      ? owningPartIndex(((index + 0.5) / Math.max(1, effects.length)) * prompterDuration)
      : 0,
  )
  {
    const borderOwner = new Map<string, number>()
    effects.forEach((effect, index) => {
      if (effect.kind === 'table-border')
        borderOwner.set(effect.tableAlias, effectOwners[index] ?? 0)
    })
    effects.forEach((effect, index) => {
      const tableAlias =
        effect.kind === 'table-border' ||
        effect.kind === 'table-mask' ||
        effect.kind === 'table-cell' ||
        effect.kind === 'wipe-subtree'
          ? effect.tableAlias
          : undefined
      if (tableAlias !== undefined && borderOwner.has(tableAlias)) {
        effectOwners[index] = borderOwner.get(tableAlias) ?? effectOwners[index] ?? 0
      }
    })
  }

  // Global first starts at zero: pin the opening action to part-0 so the
  // slide never opens mid-timeline when proportional ownership lands the
  // first effect in a later block. A leading table border carries its whole
  // chain (masks, cells, grid wipe) with it. Teardown sweeps are never first
  // (they need board items, so a build always precedes them).
  if (effects.length > 0 && !teardownEffects.has(effects[0]!)) {
    effectOwners[0] = 0
    const first = effects[0]!
    if (first.kind === 'table-border') {
      const alias = first.tableAlias
      effects.forEach((effect, index) => {
        if (
          (effect.kind === 'table-border' ||
            effect.kind === 'table-mask' ||
            effect.kind === 'table-cell' ||
            effect.kind === 'wipe-subtree') &&
          effect.tableAlias === alias
        ) {
          effectOwners[index] = 0
        }
      })
    }
  }

  // Checker-clean order: every create precedes the binds that reference it,
  // so node/table bindings resolve to same-script nodes (no forward refs).
  const lines: string[] = []
  lines.push(`script "${escapeQuoted(slideName)}" from 0`)
  lines.push('defaults { duration: 0.5s, ease: easeInOut }')
  lines.push(
    `create asset "${BG_ASSET}" as background at (${BG_AT.x}, ${BG_AT.y}) { scaleX: ${BG_SCALE}, scaleY: ${BG_SCALE} }`,
  )
  lines.push('create group "Board" as board')
  for (const paw of PARKED) {
    lines.push(
      `create asset "${paw.name}" as ${paw.alias} at (${paw.x}, ${paw.y}) { scaleX: 0.12, scaleY: 0.12 }`,
    )
  }
  lines.push(...creations)
  lines.push('bind chalk = material("Chalk")')
  lines.push('bind chalkHand = node("paw with chalk")')
  lines.push('bind ragHand = node("paw with rag")')
  lines.push('bind emptyHand = node("paw empty")')
  lines.push('bind writeSfx = audio("writing-on-black-board")')
  lines.push('bind eraseSfx = audio("dry-erase")')
  lines.push(...binds)
  lines.push('board.material(chalk)')
  lines.push(...tints)

  // Content-sized overs (fixture economy): writes scale with text length,
  // carries, masks and borders use fixed fixture beats.
  function overFor(effect: Effect): number {
    switch (effect.kind) {
      case 'carry-in':
      case 'carry-away':
        return 1.5
      case 'table-border':
        return 1.2
      case 'table-mask':
        return 0.01
      case 'table-cell':
      case 'reveal':
        return contentOver(effect.content)
      case 'mark':
        return 0.6
      case 'wipe':
        return effect.content !== undefined ? contentOver(effect.content) : 1
      case 'wipe-subtree':
        return 1
    }
  }

  const overs = effects.map(overFor)
  /** Full board span of an effect: carries also occupy their approach flight. */
  const spans = effects.map((effect, index) => {
    const over = overs[index] ?? 0
    return effect.kind === 'carry-in' || effect.kind === 'carry-away' ? over + 0.8 : over
  })

  // Builds spread space-between per prompt block (flex): a part's first
  // build starts at its own voice window start (never earlier, so `at:`
  // offsets stay non-negative), its last build ends at its window end, and
  // middles spread evenly between with equal gaps. Mask-setup wipes all fire
  // together just after their border starts (pinned below), so cell contents
  // stay hidden for the whole border sweep and appear exactly once. The board cursor never
  // rewinds, so sweeps never overlap; when the board outruns the voice the
  // slide pads past the board end plus a 1s tail (the `overflow-padded`
  // diagnostic below). The global first action is pinned to part-0 and starts
  // at zero seconds. Teardown sweeps (targeted/full-wipe removals) stack in
  // one end cluster right before the slide end with 1s padding between
  // sweeps. Each effect anchors to its owning block — `at: markTime("part-N")`
  // plus its in-window offset — so a later voice recalibration shifts the
  // board with the narration instead of leaving absolute seconds behind.
  // Bound asset names replace raw md slugs in `create asset`.
  const BOARD_GAP = 0.5
  /** Trailing silence after the last board sweep when the board sets the length. */
  const END_TAIL = 1
  /** Padding between consecutive teardown sweeps in the end cluster. */
  const TEARDOWN_GAP = 1
  /** Minimum read time: finished board lingers before teardown starts. */
  const TEARDOWN_DWELL = 0.5
  const effectAt: number[] = new Array<number>(effects.length).fill(0)
  const byOwner: number[][] = subMarkNames.map(() => [])
  effects.forEach((_, index) => {
    const owner = effectOwners[index] ?? -1
    if (owner >= 0 && owner < byOwner.length) byOwner[owner]!.push(index)
  })
  const isTeardown = (index: number): boolean => teardownEffects.has(effects[index]!)
  /** Build-only groups: teardown sweeps leave the per-block spread for the end cluster. */
  const buildByOwner: number[][] = byOwner.map((group) =>
    group.filter((index) => !isTeardown(index)),
  )
  // Packed estimate first: minimal gaps (0.5, 0 for masks) chained from each
  // window start with a never-rewinding cursor. Sets the initial slide total
  // (voice vs board overrun) that space-between then distributes within.
  let packedEnd = 0
  {
    let cursor = 0
    let firstOverall = true
    byOwner.forEach((group, partIndex) => {
      const windowStart = partStarts[partIndex] ?? 0
      for (const index of group) {
        let start: number
        if (firstOverall) {
          start = windowStart
          firstOverall = false
        } else {
          const gap = effects[index]!.kind === 'table-mask' ? 0 : BOARD_GAP
          start = Math.max(windowStart, cursor + gap)
        }
        cursor = start + (spans[index] ?? 0)
      }
      packedEnd = Math.max(packedEnd, cursor)
    })
  }
  let totalInitial = prompterDuration
  if (packedEnd > totalInitial + 1e-9) totalInitial = packedEnd
  // Per-block space-between distribution of builds within [windowStart, windowEnd].
  // The last window extends to the slide total so trailing builds can use the
  // padded region; earlier windows end at their voice part ends. Teardown
  // sweeps are excluded here — they stack in the end cluster below.
  {
    let cursor = 0
    const lastPartIndex = subMarkNames.length - 1
    buildByOwner.forEach((group, partIndex) => {
      if (group.length === 0) return
      const windowStart = Math.max(partStarts[partIndex] ?? 0, cursor)
      const voiceEnd = partEnds[partIndex] ?? totalInitial
      const isLastBlock = partIndex === lastPartIndex
      const windowEnd = isLastBlock ? totalInitial : voiceEnd
      const lastIndex = group[group.length - 1]!
      const isGlobalLast = lastIndex === effects.length - 1
      // Last start: exact end-at-window, except the global last uses the
      // user rule `start = end − round(span)` (1.5s over → ~2s before end).
      const lastSpan = spans[lastIndex] ?? 0
      let lastStart: number
      if (group.length === 1) {
        if (isGlobalLast && effects.length > 1) lastStart = windowEnd - Math.round(lastSpan)
        else lastStart = windowStart
        lastStart = Math.max(lastStart, windowStart)
        effectAt[lastIndex] = lastStart
        cursor = lastStart + lastSpan
        return
      }
      if (isGlobalLast) lastStart = windowEnd - Math.round(lastSpan)
      else lastStart = windowEnd - lastSpan
      lastStart = Math.max(lastStart, windowStart)
      // Equal gaps between the packed spans; masks take 0 gap.
      const intervals = group.length - 1
      let maskGaps = 0
      for (let i = 1; i < group.length; i += 1) {
        if (effects[group[i]!]!.kind === 'table-mask') maskGaps += 1
      }
      const freeGaps = intervals - maskGaps
      let packedSpans = 0
      for (let i = 0; i < group.length - 1; i += 1) packedSpans += spans[group[i]!] ?? 0
      const gap = freeGaps > 0 ? (lastStart - windowStart - packedSpans) / freeGaps : 0
      if (!(gap >= 0) || !Number.isFinite(gap)) {
        // Window too tight for even spacing: fall back to packed chaining so
        // sweeps never overlap; the cursor carries the overrun forward.
        let runStart = windowStart
        let first = true
        for (const index of group) {
          let start: number
          if (first) {
            start = runStart
            first = false
          } else {
            const g = effects[index]!.kind === 'table-mask' ? 0 : BOARD_GAP
            start = runStart + g
          }
          effectAt[index] = start
          runStart = start + (spans[index] ?? 0)
        }
        cursor = runStart
        return
      }
      let run = windowStart
      group.forEach((index, position) => {
        if (position === 0) {
          effectAt[index] = run
        } else {
          const g = effects[index]!.kind === 'table-mask' ? 0 : gap
          run = run + g
          effectAt[index] = run
        }
        run = (effectAt[index] ?? 0) + (spans[index] ?? 0)
      })
      // Nudge the tail to the intended last start (absorbs float drift).
      const drift = lastStart - (effectAt[lastIndex] ?? 0)
      if (Math.abs(drift) > 1e-9) effectAt[lastIndex] = lastStart
      cursor = (effectAt[lastIndex] ?? 0) + lastSpan
    })
  }
  // Mask-setup wipes fire together just after their border starts drawing, so
  // cell contents stay hidden for the whole border sweep and appear exactly
  // once, via their own reveal — never prefilled, never disappearing and
  // reappearing. (The chained layout above still spaces the reveals; only
  // the mask pins move.)
  {
    const borderStartByTable = new Map<string, number>()
    effects.forEach((effect, index) => {
      if (effect.kind === 'table-border')
        borderStartByTable.set(effect.tableAlias, effectAt[index] ?? 0)
    })
    effects.forEach((effect, index) => {
      if (effect.kind === 'table-mask') {
        const borderStart = borderStartByTable.get(effect.tableAlias)
        if (borderStart !== undefined) effectAt[index] = borderStart + 0.01
      }
    })
  }
  // Teardown cluster: removal sweeps stack right before the slide end with 1s
  // padding between sweeps, so one `[wipe]` clears the board in a tight run
  // instead of scattering across the voice. Backwards from the initial total
  // (last teardown ends one second before it) when the finished board keeps
  // read time; forwards past the builds plus dwell when the backwards cluster
  // would overlap them or cut the linger short. Owners reassign by time so
  // `at:` offsets stay non-negative.
  const teardownIdx: number[] = []
  effects.forEach((_, index) => {
    if (isTeardown(index)) teardownIdx.push(index)
  })
  if (teardownIdx.length > 0) {
    const lastTeardown = teardownIdx[teardownIdx.length - 1]!
    const lastTeardownSpan = spans[lastTeardown] ?? 0
    const backStarts = new Map<number, number>()
    backStarts.set(lastTeardown, totalInitial - END_TAIL - Math.round(lastTeardownSpan))
    for (let k = teardownIdx.length - 2; k >= 0; k -= 1) {
      const cur = teardownIdx[k]!
      const next = teardownIdx[k + 1]!
      backStarts.set(cur, (backStarts.get(next) ?? 0) - TEARDOWN_GAP - (spans[cur] ?? 0))
    }
    const buildEnd = effects.reduce(
      (max, _, index) =>
        isTeardown(index) ? max : Math.max(max, (effectAt[index] ?? 0) + (spans[index] ?? 0)),
      0,
    )
    if ((backStarts.get(teardownIdx[0]!) ?? 0) >= buildEnd + TEARDOWN_DWELL - 1e-9) {
      backStarts.forEach((start, index) => {
        effectAt[index] = start
      })
    } else {
      // Forwards past the builds with read time: the finished board lingers
      // before the teardown run so a freshly drawn table is seen, not flashed.
      let run = buildEnd + TEARDOWN_DWELL
      for (const index of teardownIdx) {
        effectAt[index] = run
        run += (spans[index] ?? 0) + TEARDOWN_GAP
      }
    }
    for (const index of teardownIdx) {
      const start = effectAt[index] ?? 0
      let owner = 0
      subMarkNames.forEach((_, partIndex) => {
        if ((partStarts[partIndex] ?? Number.POSITIVE_INFINITY) <= start + 1e-9) owner = partIndex
      })
      effectOwners[index] = owner
    }
  }
  const boardEndActual =
    effects.length === 0
      ? 0
      : effects.reduce(
          (max, _, index) => Math.max(max, (effectAt[index] ?? 0) + (spans[index] ?? 0)),
          0,
        )
  // The slide ends where the voice or the redistributed board ends plus a
  // 1s tail: rounding the cluster tail may tighten the total below the packed
  // estimate, which keeps the last sweep one second shy of the slide end
  // while gaps stay non-negative.
  const totalDuration = Math.max(
    prompterDuration,
    boardEndActual + (effects.length > 0 ? END_TAIL : 0),
  )
  let padded = false
  if (totalDuration > prompterDuration + 1e-9) {
    padded = true
  }
  const boardCost = totalDuration

  const fmt = (value: number): number => Number(value.toFixed(2))

  /** `at:` anchor for an effect: its owning block start plus the in-window offset. */
  function anchorText(owner: number, offset: number): string {
    const safeOwner =
      subMarkNames.length === 0 ? -1 : Math.min(Math.max(owner, 0), subMarkNames.length - 1)
    const mark =
      safeOwner < 0 ? markNameForPart(0) : (subMarkNames[safeOwner] ?? markNameForPart(safeOwner))
    if (offset <= 1e-9) return `markTime("${mark}")`
    return `markTime("${mark}") + ${fmt(offset)}`
  }

  function emitEffect(effect: Effect, at: string, over: number): void {
    const overText = `, over: ${fmt(over)}`
    const atText = `, at: ${at}`
    switch (effect.kind) {
      case 'carry-in':
        lines.push(
          `carry(${effect.alias}, to: { x: ${effect.toX}, y: ${effect.toY} }, approach: { x: ${effect.fromX}, y: ${effect.fromY - 300} }, approachOver: 0.8${atText}${overText}, visual: emptyHand${VISUAL_SUFFIX})`,
        )
        break
      case 'table-border':
        lines.push(
          `reveal(${effect.alias}${atText}${overText}, visual: chalkHand${VISUAL_SUFFIX}${tableBorderWobble(tableRowCounts.get(effect.alias) ?? 3)}, sound: writeSfx)`,
        )
        break
      case 'table-mask':
        lines.push(`wipe(${effect.alias}${atText}${overText}, visual: none)`)
        break
      case 'table-cell':
      case 'reveal':
        lines.push(
          `reveal(${effect.alias}${atText}${overText}, visual: chalkHand${VISUAL_SUFFIX}${wobbleFor(effect.content)}, sound: writeSfx)`,
        )
        break
      case 'mark':
        lines.push(`mark(${effect.alias}${atText}${overText}, visual: chalkHand${VISUAL_SUFFIX})`)
        break
      case 'carry-away':
        lines.push(
          `carry(${effect.alias}, to: { x: ${effect.toX}, y: ${effect.toY} }, approach: { x: ${effect.fromX}, y: ${effect.fromY} }, approachOver: 0.8${atText}${overText}, visual: emptyHand${VISUAL_SUFFIX})`,
        )
        break
      case 'wipe':
        lines.push(
          `wipe(${effect.alias}${atText}${overText}, visual: ragHand${VISUAL_SUFFIX}${wobbleFor(effect.content ?? '')}, sound: eraseSfx)`,
        )
        break
      case 'wipe-subtree':
        lines.push(
          `wipe(subtree(${effect.alias})${atText}${overText}, visual: ragHand${VISUAL_SUFFIX}${tableBorderWobble(tableRowCounts.get(effect.alias) ?? 3)}, sound: eraseSfx)`,
        )
        break
    }
  }

  function actionFor(effect: Effect): string {
    switch (effect.kind) {
      case 'carry-in':
      case 'carry-away':
        return `carry(${effect.alias})`
      case 'table-border':
      case 'table-cell':
      case 'reveal':
        return `reveal(${effect.alias})`
      case 'mark':
        return `mark(${effect.alias})`
      case 'table-mask':
      case 'wipe':
      case 'wipe-subtree':
        return `wipe(${effect.alias})`
    }
  }

  const fractions: PlannerFraction[] = []
  effects.forEach((effect, index) => {
    const at = effectAt[index] ?? 0
    const span = spans[index] ?? 0
    const fraction = totalDuration > 0 ? (at + span / 2) / totalDuration : 0
    const owner = effectOwners[index] ?? -1
    const block =
      owner >= 0 && owner < subBlockIds.length
        ? (subBlockIds[owner] ?? basePromptBlockId)
        : basePromptBlockId
    fractions.push({ action: actionFor(effect), block, fraction })
  })

  // One mark per prompt block, placed at the voice window starts via `at()`
  // (marks label the target time without moving the cursor). Effects then
  // reference them symbolically, so voice retiming shifts the board.
  if (subMarkNames.length === 0) {
    lines.push(`mark("${markNameForPart(0)}")`)
  } else {
    subMarkNames.forEach((mark, partIndex) => {
      if (partIndex === 0) lines.push(`mark("${mark}")`)
      else lines.push(`at(${fmt(partStarts[partIndex] ?? 0)}) mark("${mark}")`)
    })
  }
  effects.forEach((effect, index) => {
    const owner = effectOwners[index] ?? 0
    const offset = (effectAt[index] ?? 0) - (partStarts[owner] ?? 0)
    emitEffect(effect, anchorText(owner, offset), overs[index] ?? 0)
  })
  lines.push(`// slide ends at ${fmt(totalDuration)}s = voice plus board overrun`)
  return {
    source: `${lines.join('\n')}\n`,
    fractions,
    boardCost,
    totalDuration,
    padded,
    partDurations,
  }
}
