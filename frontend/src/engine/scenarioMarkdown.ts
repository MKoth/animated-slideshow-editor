/**
 * Scenario markdown doc seam (issue #461).
 *
 * Pure client markdown parse / validate / normalize plus legacy Stage-A
 * upgrade. No I/O, no engine access — tested at the pure seam.
 *
 * Template contract (from #454 decision, extended with the board-script vocabulary):
 * - One `# Lesson title` H1 naming the subject only, then steps opening with
 *   `## Step N — Title`, N sequential from 1.
 * - Each step splits voice from board: a `**Narrator:** ...` spoken line plus
 *   screen-action lines carrying what the viewer sees (short chalk text).
 * - Each visual is `![alt](asset:slug)` (one subject per visual) + `> Brief: ...`
 *   generation brief + optional `> Label: ...` chalk text written under the
 *   placed image + optional `<!-- reuse: Name -->`. Brief required unless
 *   reuse present.
 * - `[remove: id]` takes a board item down; `[wipe]` clears the whole board
 *   (or `[wipe: id, ...]` clears listed ids). Steps end with `[wipe]` unless
 *   the next step continues the same board.
 * - Every appearance is marked with an id — images under their slug,
 *   chalk blocks under `[reveal: text1]`/`[reveal: table1]`-style ids.
 *   `[place: slug]` places the image declared by the visual, `[reveal: id]`
 *   reveals a chalk block. Board actions must pair with content (wipe only a
 *   shown board, remove/wipe-target only an id on the board, place only a
 *   declared visual).
 * - Tables are plain markdown grids, any column count.
 * - Asset key mirrors normalized alt (trim, collapse whitespace,
 *   lowercase, spaces to hyphens); doc-unique with warnings.
 * - Validation is warnings-only; nothing blocks save.
 */

export interface ScenarioVisual {
  readonly alt: string
  readonly key: string
  readonly slug: string
  readonly brief?: string
  /** Chalk text written on the board under the placed image. */
  readonly label?: string
  readonly reuse?: string
  readonly line: number
}

export interface ScenarioStep {
  readonly index: number
  readonly title: string
  readonly narrator?: string
  readonly visuals: readonly ScenarioVisual[]
  readonly table?: string
  readonly text?: string
  /**
   * Content blocks in document order (visuals, tables, and text paragraphs
   * interleaved as authored). `visuals`/`table`/`text` above stay as the
   * grouped views; renderers that must keep image↔text association walk
   * `blocks` instead of the grouped fields.
   */
  readonly blocks: readonly ScenarioBlock[]
  /** Slugs explicitly placed on the board via `[place: slug]`. */
  readonly placed: readonly string[]
  /** Board ids revealed via `[reveal: id]` (`text1`/`table1`-style). */
  readonly reveals: readonly string[]
  /** Board ids this step takes down. */
  readonly removes: readonly string[]
  /** Board ids a targeted `[wipe: id, ...]` clears (empty when wiping all). */
  readonly wipeTargets: readonly string[]
  /** True when the step ends by clearing the board. */
  readonly wiped: boolean
  readonly rawHeading: string
  readonly bare: boolean
}

/** One content block in document order within a step. */
export type ScenarioBlock =
  | { readonly kind: 'visual'; readonly visual: ScenarioVisual }
  | { readonly kind: 'table'; readonly table: string }
  | { readonly kind: 'text'; readonly text: string }

export interface ScenarioWarning {
  readonly code:
    | 'non-sequential-heading'
    | 'bare-heading'
    | 'empty-title'
    | 'empty-alt'
    | 'duplicate-key'
    | 'missing-brief-and-reuse'
    | 'malformed-table'
    | 'slug-mismatch'
    | 'missing-title'
    | 'unknown-remove'
    | 'dangling-place'
    | 'dangling-wipe'
  readonly message: string
  readonly step?: number
}

export interface ParsedScenario {
  /** First `# ` H1: the short lesson title (undefined when absent). */
  readonly title?: string
  readonly steps: readonly ScenarioStep[]
  readonly warnings: readonly ScenarioWarning[]
}

export interface LegacyScenarioStep {
  readonly partTag: string
  readonly spokenLine: string
  readonly onScreenAction: string
  readonly assetHints: readonly string[]
}

/** Trim, collapse whitespace, lowercase, spaces to hyphens. */
export function normalizeAssetKey(alt: string): string {
  return alt.trim().replace(/\s+/g, ' ').toLowerCase().replace(/ /g, '-')
}

const STEP_HEADING_RE = /^##\s+Step\s+(\d+)\s*(?:[—–\-:.]?\s*(.*))?$/
const TITLE_RE = /^#\s+(.+?)\s*$/
const NARRATOR_RE = /^\s*(?:\*\*Narrator:\*\*|Narrator:)\s*(.*)$/i
const VISUAL_RE = /!\[([^\]]*)\]\(\s*asset:([^)\s]+)\s*\)/
const BRIEF_RE = /^\s*>\s*Brief:\s*(.*)$/i
const LABEL_RE = /^\s*>\s*Label:\s*(.*)$/i
const REMOVE_RE = /^\s*\[remove:\s*(.+?)\s*\]\s*$/i
const WIPE_RE = /^\s*\[wipe(?::\s*(.+?))?\s*\]\s*$/i
const PLACE_RE = /^\s*\[place:\s*(.+?)\s*\]\s*$/i
const REVEAL_RE = /^\s*\[reveal:\s*(.+?)\s*\]\s*$/i
const REUSE_RE = /^\s*<!--\s*reuse:\s*(.+?)\s*-->\s*$|^<!--\s*reuse:\s*(.+?)\s*-->/
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/

function isDelimiterRow(line: string): boolean {
  const trimmed = line.trim()
  if (!TABLE_ROW_RE.test(trimmed)) return false
  const cells = trimmed
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim())
  if (cells.length === 0) return false
  return cells.every((cell) => /^:?-+:?$/.test(cell))
}

function splitTableCells(line: string): string[] {
  const trimmed = line.trim()
  const inner = trimmed.startsWith('|') && trimmed.endsWith('|') ? trimmed.slice(1, -1) : trimmed
  return inner.split('|').map((c) => c.trim())
}

export function parseScenarioMarkdown(markdown: string): ParsedScenario {
  const lines = markdown.split('\n')
  const warnings: ScenarioWarning[] = []

  interface RawStep {
    index: number
    title: string
    rawHeading: string
    headingLine: number
    bodyLines: { text: string; line: number }[]
  }

  const rawSteps: RawStep[] = []
  let current: RawStep | null = null
  let title: string | undefined

  lines.forEach((text, i) => {
    const lineNumber = i + 1
    const trimmed = text.trim()
    const match = STEP_HEADING_RE.exec(trimmed)
    if (match && trimmed.startsWith('##')) {
      const index = Number.parseInt(match[1] ?? '0', 10)
      const stepTitle = (match[2] ?? '').trim()
      if (current) rawSteps.push(current)
      current = {
        index,
        title: stepTitle,
        rawHeading: trimmed,
        headingLine: lineNumber,
        bodyLines: [],
      }
      if (stepTitle === '') {
        warnings.push({
          code: 'empty-title',
          message: `Step ${index} heading carries no title`,
          step: index,
        })
      }
    } else if (current) {
      current.bodyLines.push({ text, line: lineNumber })
    } else if (title === undefined) {
      const titleMatch = TITLE_RE.exec(trimmed)
      if (titleMatch && (titleMatch[1] ?? '').trim() !== '') {
        title = (titleMatch[1] ?? '').trim()
      }
    }
  })
  if (current) rawSteps.push(current)

  // Non-sequential check: must open at 1 and increment by 1.
  let expected = 1
  for (const step of rawSteps) {
    if (step.index !== expected) {
      warnings.push({
        code: 'non-sequential-heading',
        message: `Expected Step ${expected} but found Step ${step.index}`,
        step: step.index,
      })
      expected = step.index + 1
    } else {
      expected += 1
    }
  }

  const steps: ScenarioStep[] = []
  const seenKeys = new Map<string, number>()

  for (const raw of rawSteps) {
    let narrator: string | undefined
    const visuals: ScenarioVisual[] = []
    let table: string | undefined
    const textParts: string[] = []
    const blocks: ScenarioBlock[] = []

    const tableBuffer: { text: string; line: number }[] = []
    const flushTableBufferAsText = () => {
      for (const entry of tableBuffer) {
        if (entry.text.trim() !== '') {
          textParts.push(entry.text.trim())
          blocks.push({ kind: 'text', text: entry.text.trim() })
        }
      }
      tableBuffer.length = 0
    }

    let pendingVisual: { alt: string; slug: string; line: number } | null = null
    let pendingBrief: string | undefined
    let pendingLabel: string | undefined
    let pendingReuse: string | undefined
    const placed: string[] = []
    const reveals: string[] = []
    const removes: string[] = []
    const wipeTargets: string[] = []
    let wiped = false

    const flushPendingVisual = () => {
      if (!pendingVisual) return
      const alt = pendingVisual.alt
      const key = normalizeAssetKey(alt)
      const visual: ScenarioVisual = {
        alt,
        key,
        slug: pendingVisual.slug,
        line: pendingVisual.line,
        ...(pendingBrief !== undefined ? { brief: pendingBrief } : {}),
        ...(pendingLabel !== undefined ? { label: pendingLabel } : {}),
        ...(pendingReuse !== undefined ? { reuse: pendingReuse } : {}),
      }
      if (alt.trim() === '') {
        warnings.push({
          code: 'empty-alt',
          message: `Step ${raw.index} visual has an empty alt`,
          step: raw.index,
        })
      }
      if (key !== pendingVisual.slug) {
        warnings.push({
          code: 'slug-mismatch',
          message: `Step ${raw.index} visual slug "${pendingVisual.slug}" does not mirror normalized alt "${key}"`,
          step: raw.index,
        })
      }
      if (key !== '' && seenKeys.has(key)) {
        warnings.push({
          code: 'duplicate-key',
          message: `Duplicate asset key "${key}"`,
          step: raw.index,
        })
      } else if (key !== '') {
        seenKeys.set(key, raw.index)
      } else {
        // Empty keys collide too once more than one empty alt exists.
        const count = seenKeys.get('') ?? 0
        if (count >= 1) {
          warnings.push({
            code: 'duplicate-key',
            message: 'Duplicate asset key "" (empty alt)',
            step: raw.index,
          })
        }
        seenKeys.set('', count + 1)
      }
      if (
        (pendingBrief === undefined || pendingBrief.trim() === '') &&
        (pendingReuse === undefined || pendingReuse.trim() === '')
      ) {
        warnings.push({
          code: 'missing-brief-and-reuse',
          message: `Step ${raw.index} visual "${alt || pendingVisual.slug}" has neither brief nor reuse reference`,
          step: raw.index,
        })
      }
      visuals.push(visual)
      blocks.push({ kind: 'visual', visual })
      pendingVisual = null
      pendingBrief = undefined
      pendingLabel = undefined
      pendingReuse = undefined
    }

    let idx = 0
    while (idx < raw.bodyLines.length) {
      const entry = raw.bodyLines[idx]!
      const trimmed = entry.text.trim()

      if (trimmed === '') {
        idx += 1
        continue
      }

      const narratorMatch = NARRATOR_RE.exec(entry.text)
      if (narratorMatch) {
        flushPendingVisual()
        flushTableBufferAsText()
        const content = (narratorMatch[1] ?? '').trim()
        narrator = narrator === undefined ? content : `${narrator}\n${content}`
        idx += 1
        continue
      }

      const visualMatch = VISUAL_RE.exec(entry.text)
      if (visualMatch) {
        flushPendingVisual()
        flushTableBufferAsText()
        pendingVisual = {
          alt: visualMatch[1] ?? '',
          slug: (visualMatch[2] ?? '').trim(),
          line: entry.line,
        }
        pendingBrief = undefined
        pendingReuse = undefined
        idx += 1
        continue
      }

      const briefMatch = BRIEF_RE.exec(entry.text)
      if (briefMatch && pendingVisual && pendingBrief === undefined) {
        pendingBrief = (briefMatch[1] ?? '').trim()
        idx += 1
        continue
      }
      if (briefMatch) {
        // Orphan brief (no open visual, or a duplicate): briefs stay in
        // markdown only and never leak into reader text with their marker.
        flushPendingVisual()
        flushTableBufferAsText()
        idx += 1
        continue
      }

      const labelMatch = LABEL_RE.exec(entry.text)
      if (labelMatch && pendingVisual && pendingLabel === undefined) {
        pendingLabel = (labelMatch[1] ?? '').trim()
        idx += 1
        continue
      }
      if (labelMatch) {
        // Orphan label (no open visual, or a duplicate): keep the content
        // as reader text but drop the `Label:` marker word.
        flushPendingVisual()
        flushTableBufferAsText()
        const content = (labelMatch[1] ?? '').trim()
        if (content !== '') {
          textParts.push(content)
          blocks.push({ kind: 'text', text: content })
        }
        idx += 1
        continue
      }

      const reuseMatch = REUSE_RE.exec(trimmed)
      if (reuseMatch && pendingVisual && pendingReuse === undefined) {
        pendingReuse = (reuseMatch[1] ?? reuseMatch[2] ?? '').trim()
        idx += 1
        continue
      }

      const removeMatch = REMOVE_RE.exec(entry.text)
      if (removeMatch) {
        flushPendingVisual()
        flushTableBufferAsText()
        const target = normalizeAssetKey(removeMatch[1] ?? '')
        if (target !== '') removes.push(target)
        idx += 1
        continue
      }

      const wipeMatch = WIPE_RE.exec(entry.text)
      if (wipeMatch) {
        flushPendingVisual()
        flushTableBufferAsText()
        wiped = true
        const listed = (wipeMatch[1] ?? '')
          .split(',')
          .map((part) => normalizeAssetKey(part))
          .filter((part) => part !== '')
        for (const target of listed) {
          if (!wipeTargets.includes(target)) wipeTargets.push(target)
        }
        idx += 1
        continue
      }

      const placeMatch = PLACE_RE.exec(entry.text)
      if (placeMatch) {
        flushPendingVisual()
        flushTableBufferAsText()
        const target = normalizeAssetKey(placeMatch[1] ?? '')
        if (target !== '' && !placed.includes(target)) placed.push(target)
        idx += 1
        continue
      }

      const revealMatch = REVEAL_RE.exec(entry.text)
      if (revealMatch) {
        flushPendingVisual()
        flushTableBufferAsText()
        const target = normalizeAssetKey(revealMatch[1] ?? '')
        if (target !== '' && !reveals.includes(target)) reveals.push(target)
        idx += 1
        continue
      }

      if (TABLE_ROW_RE.test(trimmed)) {
        flushPendingVisual()
        tableBuffer.push(entry)
        idx += 1
        // Consume consecutive table rows.
        while (idx < raw.bodyLines.length) {
          const next = raw.bodyLines[idx]!
          if (next.text.trim() === '') break
          if (!TABLE_ROW_RE.test(next.text.trim())) break
          tableBuffer.push(next)
          idx += 1
        }
        // Validate the buffered table.
        if (tableBuffer.length >= 2 && isDelimiterRow(tableBuffer[1]!.text)) {
          const headerCount = splitTableCells(tableBuffer[0]!.text).length
          let malformed = false
          for (let r = 2; r < tableBuffer.length; r += 1) {
            if (splitTableCells(tableBuffer[r]!.text).length !== headerCount) {
              malformed = true
              break
            }
          }
          if (malformed) {
            warnings.push({
              code: 'malformed-table',
              message: `Step ${raw.index} table has inconsistent column counts`,
              step: raw.index,
            })
            flushTableBufferAsText()
          } else if (table === undefined) {
            const chunk = tableBuffer.map((e) => e.text.trim()).join('\n')
            table = chunk
            blocks.push({ kind: 'table', table: chunk })
            tableBuffer.length = 0
          } else {
            // Multiple table blocks: concatenate so no content silently demotes to text.
            const chunk = tableBuffer.map((e) => e.text.trim()).join('\n')
            table += `\n\n${chunk}`
            blocks.push({ kind: 'table', table: chunk })
            tableBuffer.length = 0
          }
        } else {
          warnings.push({
            code: 'malformed-table',
            message: `Step ${raw.index} table is malformed (missing delimiter row)`,
            step: raw.index,
          })
          flushTableBufferAsText()
        }
        continue
      }

      // Any other line while a visual is pending closes the visual first.
      if (pendingVisual) {
        flushPendingVisual()
      }
      if (tableBuffer.length > 0) flushTableBufferAsText()
      textParts.push(trimmed)
      blocks.push({ kind: 'text', text: trimmed })
      idx += 1
    }
    flushPendingVisual()
    flushTableBufferAsText()

    const text = textParts.length > 0 ? textParts.join('\n\n') : undefined
    const bare =
      narrator === undefined &&
      visuals.length === 0 &&
      table === undefined &&
      text === undefined &&
      removes.length === 0 &&
      wipeTargets.length === 0 &&
      !wiped
    if (bare) {
      warnings.push({
        code: 'bare-heading',
        message: `Step ${raw.index} has a heading but no blocks`,
        step: raw.index,
      })
    }

    steps.push({
      index: raw.index,
      title: raw.title,
      rawHeading: raw.rawHeading,
      bare,
      placed: [...placed],
      reveals: [...reveals],
      removes: [...removes],
      wipeTargets: [...wipeTargets],
      wiped,
      ...(narrator !== undefined ? { narrator } : {}),
      visuals,
      ...(table !== undefined ? { table } : {}),
      ...(text !== undefined ? { text } : {}),
      blocks: [...blocks],
    })
  }

  if (steps.length > 0 && title === undefined) {
    warnings.push({
      code: 'missing-title',
      message: 'Doc carries no `# Lesson title` heading',
    })
  }

  // Board-state pass: actions must pair with content. Images live on the
  // board under their slug, chalk blocks under their reveal id; a wipe clears
  // everything (or the listed ids), a remove takes down one listed id.
  // Narrator is voice, never board content.
  const visualKeys = new Set<string>()
  for (const step of steps) {
    for (const visual of step.visuals) {
      if (visual.key !== '') visualKeys.add(visual.key)
    }
  }
  const boardIds = new Set<string>()
  let boardChalk = false
  for (const step of steps) {
    const stepAdds: string[] = []
    for (const visual of step.visuals) {
      if (visual.key !== '' && !stepAdds.includes(visual.key)) stepAdds.push(visual.key)
    }
    for (const key of [...step.placed, ...step.reveals]) {
      if (!stepAdds.includes(key)) stepAdds.push(key)
    }
    for (const key of step.placed) {
      if (!visualKeys.has(key)) {
        warnings.push({
          code: 'dangling-place',
          message: `Step ${step.index} places "${key}" with no visual in the doc`,
          step: step.index,
        })
      }
    }
    const stepChalk = step.table !== undefined || step.text !== undefined
    const takes = [...step.removes, ...step.wipeTargets]
    for (const target of takes) {
      if (!boardIds.has(target) && !stepAdds.includes(target)) {
        warnings.push({
          code: 'unknown-remove',
          message: `Step ${step.index} clears "${target}" which is not on the board`,
          step: step.index,
        })
      }
    }
    if (
      step.wiped &&
      step.wipeTargets.length === 0 &&
      boardIds.size === 0 &&
      !boardChalk &&
      stepAdds.length === 0 &&
      !stepChalk
    ) {
      warnings.push({
        code: 'dangling-wipe',
        message: `Step ${step.index} wipes an empty board`,
        step: step.index,
      })
    }
    for (const target of takes) boardIds.delete(target)
    for (const key of stepAdds) boardIds.add(key)
    if (step.wiped && step.wipeTargets.length === 0) {
      boardIds.clear()
      boardChalk = false
    } else if (stepChalk) {
      boardChalk = true
    }
  }

  return { ...(title !== undefined ? { title } : {}), steps, warnings }
}

export function upgradeLegacyScenarioToMarkdown(steps: readonly LegacyScenarioStep[]): string {
  const out: string[] = []
  steps.forEach((step, i) => {
    const num = i + 1
    const tag = step.partTag.trim()
    const title = tag ? tag.charAt(0).toUpperCase() + tag.slice(1) : `Part ${num}`
    out.push(`## Step ${num} — ${title}`)
    out.push('')
    if (step.spokenLine.trim() !== '') {
      out.push(`**Narrator:** ${step.spokenLine.trim()}`)
      out.push('')
    }
    for (const hint of step.assetHints) {
      const alt = hint.trim()
      if (alt === '') continue
      out.push(`![${alt}](asset:${normalizeAssetKey(alt)})`)
      out.push('')
      const seed = step.onScreenAction.trim()
      if (seed !== '') {
        out.push(`> Brief: ${seed}`)
        out.push('')
      }
    }
    if (step.onScreenAction.trim() !== '') {
      out.push(step.onScreenAction.trim())
      out.push('')
    }
  })
  return out.join('\n')
}
