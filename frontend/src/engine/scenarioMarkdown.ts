/**
 * Scenario markdown doc seam (issue #461).
 *
 * Pure client markdown parse / validate / normalize plus legacy Stage-A
 * upgrade. No I/O, no engine access — tested at the pure seam.
 *
 * Template contract (from #454 decision):
 * - Steps open with `## Step N — Title`, N sequential from 1.
 * - Body blocks in canonical narrator → visuals → table → text order when
 *   present; any subset allowed with at least one block per step.
 * - Narrator is the spoken voiceover (`**Narrator:** ...`); text is the
 *   distilled on-screen chalk wording (remaining paragraphs).
 * - Each visual is `![alt](asset:slug)` + `> Brief: ...` + optional
 *   `<!-- reuse: Name -->`. Brief required unless reuse present.
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
  readonly rawHeading: string
  readonly bare: boolean
}

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
  readonly message: string
  readonly step?: number
}

export interface ParsedScenario {
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
const NARRATOR_RE = /^\s*(?:\*\*Narrator:\*\*|Narrator:)\s*(.*)$/i
const VISUAL_RE = /!\[([^\]]*)\]\(\s*asset:([^)\s]+)\s*\)/
const BRIEF_RE = /^\s*>\s*Brief:\s*(.*)$/i
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

  lines.forEach((text, i) => {
    const lineNumber = i + 1
    const match = STEP_HEADING_RE.exec(text.trim())
    if (match && text.trim().startsWith('##')) {
      const index = Number.parseInt(match[1] ?? '0', 10)
      const title = (match[2] ?? '').trim()
      if (current) rawSteps.push(current)
      current = { index, title, rawHeading: text.trim(), headingLine: lineNumber, bodyLines: [] }
      if (title === '') {
        warnings.push({
          code: 'empty-title',
          message: `Step ${index} heading carries no title`,
          step: index,
        })
      }
    } else if (current) {
      current.bodyLines.push({ text, line: lineNumber })
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

    const tableBuffer: { text: string; line: number }[] = []
    const flushTableBufferAsText = () => {
      for (const entry of tableBuffer) {
        if (entry.text.trim() !== '') textParts.push(entry.text.trim())
      }
      tableBuffer.length = 0
    }

    let pendingVisual: { alt: string; slug: string; line: number } | null = null
    let pendingBrief: string | undefined
    let pendingReuse: string | undefined

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
      pendingVisual = null
      pendingBrief = undefined
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

      const reuseMatch = REUSE_RE.exec(trimmed)
      if (reuseMatch && pendingVisual && pendingReuse === undefined) {
        pendingReuse = (reuseMatch[1] ?? reuseMatch[2] ?? '').trim()
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
            table = tableBuffer.map((e) => e.text.trim()).join('\n')
            tableBuffer.length = 0
          } else {
            // Multiple table blocks: concatenate so no content silently demotes to text.
            table += `\n\n${tableBuffer.map((e) => e.text.trim()).join('\n')}`
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
      idx += 1
    }
    flushPendingVisual()
    flushTableBufferAsText()

    const text = textParts.length > 0 ? textParts.join('\n\n') : undefined
    const bare =
      narrator === undefined && visuals.length === 0 && table === undefined && text === undefined
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
      ...(narrator !== undefined ? { narrator } : {}),
      visuals,
      ...(table !== undefined ? { table } : {}),
      ...(text !== undefined ? { text } : {}),
    })
  }

  return { steps, warnings }
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
