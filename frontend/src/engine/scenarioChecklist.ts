/**
 * Scenario checklist pure seam (issue #463).
 *
 * Doc-first modal helpers: one row per normalized asset key in doc order,
 * Generate hard-blocked while any row is unbound, View lifecycle
 * empty / ready / stale, and one-click brief edits.
 *
 * Bound means a stored binding resolves to a known asset id (library or
 * embedded). Brief text alone never unblocks. Rows derive from a live
 * markdown scan on every open; stored bindings never create rows.
 *
 * No I/O, no engine access — tested at the pure seam.
 */

import { normalizeAssetKey, parseScenarioMarkdown } from './scenarioMarkdown'

export type ScenarioHtmlState = 'empty' | 'ready' | 'stale'

export interface ScenarioChecklistRow {
  readonly key: string
  readonly alt: string
  readonly slug: string
  readonly brief?: string
  /** Chalk text written on the board under the placed image. */
  readonly label?: string
  readonly reuse?: string
  readonly bindingAssetId?: string
  readonly bound: boolean
  readonly hasBrief: boolean
}

/** Human title for a row: the visual alt, or the key prettified as fallback. */
export function checklistTitleFor(key: string, alt: string): string {
  const clean = alt.trim()
  if (clean) return clean
  const words = key
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  return words.length > 0 ? words.join(' ') : key
}

/** Self-contained generation prompt: title, picture description, sticker style. */
export function checklistPromptFor(key: string, alt: string, brief?: string): string {
  const text = (brief ?? '').trim()
  return [
    checklistTitleFor(key, alt),
    '',
    text || '(no brief yet — describe the image before generating)',
    '',
    'Style: cartoonish sticker with thick white padding around the image on a dark background, no text.',
  ].join('\n')
}

/** Combine embedded plus library definition ids into the bound-check set. */
export function buildScenarioAvailableIds(
  embeddedIds: readonly string[],
  ...definitionLists: readonly (readonly { id: string }[])[]
): Set<string> {
  const ids = new Set<string>(embeddedIds)
  for (const list of definitionLists) {
    for (const def of list) ids.add(def.id)
  }
  return ids
}

/**
 * Build one row per normalized asset key in first-appearance order.
 * Empty alts are skipped (they warn in `parseScenarioMarkdown`).
 */
export function buildScenarioChecklistRows(
  markdown: string,
  bindings: Readonly<Record<string, string>>,
  availableIds: ReadonlySet<string>,
): ScenarioChecklistRow[] {
  const parsed = parseScenarioMarkdown(markdown || '')
  const order: string[] = []
  const firstAlt = new Map<string, string>()
  const firstSlug = new Map<string, string>()
  const briefByKey = new Map<string, string>()
  const labelByKey = new Map<string, string>()
  const reuseByKey = new Map<string, string>()

  for (const step of parsed.steps) {
    for (const visual of step.visuals) {
      if (visual.key === '') continue
      if (!order.includes(visual.key)) order.push(visual.key)
      if (!firstAlt.has(visual.key)) {
        firstAlt.set(visual.key, visual.alt)
        firstSlug.set(visual.key, visual.slug)
      }
      if (visual.brief !== undefined && !briefByKey.has(visual.key)) {
        briefByKey.set(visual.key, visual.brief)
      }
      if (visual.label !== undefined && !labelByKey.has(visual.key)) {
        labelByKey.set(visual.key, visual.label)
      }
      if (visual.reuse !== undefined && !reuseByKey.has(visual.key)) {
        reuseByKey.set(visual.key, visual.reuse)
      }
    }
  }

  return order.map((key) => {
    const rawBinding = bindings[key]
    const bindingAssetId =
      typeof rawBinding === 'string' && rawBinding !== '' ? rawBinding : undefined
    const bound = bindingAssetId !== undefined && availableIds.has(bindingAssetId)
    const brief = briefByKey.get(key)
    const label = labelByKey.get(key)
    return {
      key,
      alt: firstAlt.get(key) ?? key,
      slug: firstSlug.get(key) ?? key,
      ...(brief !== undefined ? { brief } : {}),
      ...(label !== undefined ? { label } : {}),
      ...(reuseByKey.has(key) ? { reuse: reuseByKey.get(key)! } : {}),
      ...(bindingAssetId !== undefined ? { bindingAssetId } : {}),
      bound,
      hasBrief: brief !== undefined && brief.trim() !== '',
    }
  })
}

/** Count of rows without resolved bytes — shown on the blocked Generate button. */
export function getScenarioUnboundCount(rows: readonly ScenarioChecklistRow[]): number {
  return rows.filter((row) => !row.bound).length
}

/** Generate is hard-blocked while any checklist row is unbound. */
export function isScenarioGenerateBlocked(rows: readonly ScenarioChecklistRow[]): boolean {
  return getScenarioUnboundCount(rows) > 0
}

/**
 * View lifecycle for the modal top-bar.
 * - empty: no stored HTML yet — View disabled with a no-HTML-yet explanation.
 * - ready: stored HTML matches the current doc via the generation pointer.
 * - stale: doc edited after generation — View still opens the old render.
 */
export function getScenarioHtmlState(input: {
  lastHtml?: string
  currentMarkdown: string
  generatedFromVersionId?: string | null
  versions: readonly { id: string; content: string }[]
}): ScenarioHtmlState {
  const { lastHtml, currentMarkdown, generatedFromVersionId, versions } = input
  if (lastHtml === undefined || lastHtml === '') return 'empty'
  if (generatedFromVersionId) {
    const source = versions.find((v) => v.id === generatedFromVersionId)
    if (source && source.content === currentMarkdown) return 'ready'
    return 'stale'
  }
  return 'stale'
}

const VISUAL_LINE_RE = /!\[([^\]]*)\]\(\s*asset:([^)\s]+)\s*\)/
const BRIEF_LINE_RE = /^\s*>\s*Brief:\s*(.*)$/
const STEP_HEADING_RE = /^\s*##\s+Step\b/

/**
 * Replace the brief line for every visual with the normalized key, or insert
 * one after the visual when absent. One click in the checklist rail.
 */
export function updateScenarioBrief(markdown: string, assetKey: string, newBrief: string): string {
  const normalized = normalizeAssetKey(assetKey || '')
  if (normalized === '') return markdown
  const cleanBrief = (newBrief || '').trim()
  const lines = (markdown || '').split('\n')
  const visualIndexes: number[] = []
  lines.forEach((line, i) => {
    const m = VISUAL_LINE_RE.exec(line)
    if (!m) return
    if (normalizeAssetKey(m[1] ?? '') === normalized) visualIndexes.push(i)
  })
  if (visualIndexes.length === 0) return markdown

  // Work back-to-front so splices never shift pending indexes.
  const next = [...lines]
  for (let v = visualIndexes.length - 1; v >= 0; v -= 1) {
    const at = visualIndexes[v]!
    let briefAt: number | null = null
    for (let i = at + 1; i < next.length; i += 1) {
      const trimmed = next[i]!.trim()
      if (trimmed === '') continue
      if (BRIEF_LINE_RE.test(next[i]!)) {
        briefAt = i
        break
      }
      // A new visual, step heading, table row, or reuse comment ends the
      // visual's brief window — anything else is doc text.
      if (VISUAL_LINE_RE.test(next[i]!) || STEP_HEADING_RE.test(next[i]!)) break
      break
    }
    if (cleanBrief === '') {
      if (briefAt !== null) next.splice(briefAt, 1)
    } else if (briefAt !== null) {
      next[briefAt] = `> Brief: ${cleanBrief}`
    } else {
      next.splice(at + 1, 0, '', `> Brief: ${cleanBrief}`)
    }
  }
  return next.join('\n')
}
