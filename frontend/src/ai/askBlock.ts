/**
 * Extracts structured ask blocks from an assistant message. The template
 * contract asks every assistant to carry clarifying questions as one fenced
 * block per question instead of prose bullets:
 *
 * ```ask
 * id: landing-xy
 * question: Mid-sofa landing XY for the Cat root?
 * kind: single
 * options:
 * - id: use-sofa-center
 *   label: Sofa center from live context
 *   detail: world XY + shape-bounds offset
 * - id: keep-current
 *   label: Keep current Cat XY
 * allowCustom: true
 * ```
 *
 * Pure and read-only: parses text, never touches engine state. Answers are
 * submitted through the normal chat path (see formatAskAnswer) so history
 * stays append-only.
 */

export type AskKind = 'single' | 'multi' | 'text'

export interface AskOption {
  readonly id: string
  readonly label: string
  readonly detail: string | null
}

export interface AskBlock {
  readonly id: string
  readonly question: string
  readonly kind: AskKind
  readonly options: readonly AskOption[]
  readonly allowCustom: boolean
}

const FENCE_RE = /```(\w[\w-]*)\s*\n([\s\S]*?)```/g

function clean(value: string | undefined): string | null {
  if (value === undefined) return null
  const stripped = value
    .trim()
    .replace(/^["'](.*)["']$/, '$1')
    .trim()
  return stripped ? stripped : null
}

function parseAllowCustom(raw: string | undefined): boolean {
  if (!raw) return false
  const value = raw.trim().toLowerCase()
  return value === 'true' || value === 'yes' || value === '1' || value === 'on'
}

interface DraftOption {
  id: string
  label: string | null
  detail: string | null
}

/**
 * Parses one `- ...` line inside `options:`. Supports both the canonical
 * multi-line form (`- id: x` followed by `label:`/`detail:` lines) and the
 * compact single-line form models often emit (`- id: x / label: Y / detail: Z`,
 * with `/`, `|`, or `,` separators). Returns null when the line carries no
 * option id. A returned option may still miss its label/detail — those can
 * arrive on the following lines.
 */
function parseOptionLine(content: string): DraftOption | null {
  const keyRe = /(id|label|detail)\s*[:=]\s*/gi
  const hits = [...content.matchAll(keyRe)]
  if (hits.length === 0) return null
  const values: Record<string, string> = {}
  for (let i = 0; i < hits.length; i += 1) {
    const hit = hits[i]!
    const key = hit[1]!.toLowerCase()
    const start = (hit.index ?? 0) + hit[0].length
    const end = i + 1 < hits.length ? (hits[i + 1]!.index ?? content.length) : content.length
    const cleaned = clean(content.slice(start, end).replace(/[\s|/,;]+$/, ''))
    if (cleaned && values[key] === undefined) values[key] = cleaned
  }
  const optionId = values.id
  if (!optionId) return null
  return { id: optionId, label: values.label ?? null, detail: values.detail ?? null }
}

/** Parse one ```ask body; returns null when the block is malformed. */
function parseBlock(body: string): AskBlock | null {
  let id: string | null = null
  let question: string | null = null
  let kind: AskKind = 'single'
  let kindSeen = false
  let kindValid = true
  let allowCustom = false
  const options: AskOption[] = []
  let current: DraftOption | null = null
  let inOptions = false

  const flush = () => {
    const entry = current
    if (entry && entry.id && entry.label) {
      options.push({ id: entry.id, label: entry.label, detail: entry.detail })
    }
    current = null
  }

  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^[-*]\s*/.test(trimmed) && inOptions) {
      const inline = parseOptionLine(trimmed.replace(/^[-*]\s*/, ''))
      flush()
      current = inline
      continue
    }
    const field = /^\s*([A-Za-z][A-Za-z_-]*)\s*[:=]\s*(.*)?\s*$/.exec(line)
    if (!field?.[1]) continue
    const key = field[1].toLowerCase().replace(/[-_]/g, '')
    const raw = (field[2] ?? '').trim()
    if (key === 'options') {
      inOptions = true
      continue
    }
    if (current && (key === 'label' || key === 'detail')) {
      const value = clean(raw)
      if (value) {
        if (key === 'label') current.label = value
        else current.detail = value
      }
      continue
    }
    if (key === 'id' && !inOptions) {
      id = clean(raw) ?? id
      continue
    }
    if (key === 'question') {
      question = clean(raw) ?? question
      continue
    }
    if (key === 'kind') {
      kindSeen = true
      const wanted = raw.toLowerCase()
      if (wanted === 'single' || wanted === 'multi' || wanted === 'text') {
        kind = wanted
      } else {
        kindValid = false
      }
      continue
    }
    if (key === 'allowcustom') {
      allowCustom = parseAllowCustom(raw)
      continue
    }
  }
  flush()

  if (!id || !question) return null
  if (kindSeen && !kindValid) return null
  if ((kind === 'single' || kind === 'multi') && options.length === 0) return null
  return { id, question, kind, options, allowCustom }
}

/**
 * Every well-formed ```ask block wins, in order; malformed blocks are
 * skipped without failing the rest. Returns [] when absent.
 */
export function extractAskBlocks(content: string): AskBlock[] {
  if (!content) return []
  const out: AskBlock[] = []
  FENCE_RE.lastIndex = 0
  for (const match of content.matchAll(FENCE_RE)) {
    const lang = (match[1] ?? '').toLowerCase()
    if (lang !== 'ask') continue
    const parsed = parseBlock(match[2] ?? '')
    if (parsed) out.push(parsed)
  }
  return out
}

export function hasAskBlocks(content: string): boolean {
  return extractAskBlocks(content).length > 0
}

/**
 * Removes raw ```ask fences so the message shows just the interactive UI
 * (plus any surrounding prose) instead of the fence source and the UI.
 * Non-ask fences are left untouched.
 */
const STRIP_RE = /```(\w[\w-]*)\s*\n([\s\S]*?)```/g

export function stripAskBlocks(content: string): string {
  if (!content || !hasAskBlocks(content)) return content
  return content
    .replace(STRIP_RE, (match, lang) => (String(lang ?? '').toLowerCase() === 'ask' ? '' : match))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Formats one Answer submit as a single user message:
 * `Q (<id>): <selected labels> [+ custom: <text>]`. A lone custom answer on
 * a text block carries the raw text without the `custom:` prefix.
 */
export function formatAskAnswer(
  block: AskBlock,
  selectedIds: readonly string[],
  customText: string,
): string {
  const labels = selectedIds.map(
    (selected) => block.options.find((option) => option.id === selected)?.label ?? selected,
  )
  const custom = customText.trim()
  const parts: string[] = []
  if (labels.length > 0) parts.push(labels.join(', '))
  if (custom) {
    if (labels.length === 0 && block.kind === 'text') parts.push(custom)
    else parts.push(`custom: ${custom}`)
  }
  return `Q (${block.id}): ${parts.join(' + ')}`
}

/** Empty submit is a no-op — the Answer button stays disabled while true. */
export function isAskAnswerEmpty(selectedIds: readonly string[], customText: string): boolean {
  return selectedIds.length === 0 && !customText.trim()
}

/** Per-question draft backing one ask block in a grouped answer. */
export interface AskAnswerDraft {
  readonly selected: readonly string[]
  readonly customSelected: boolean
  readonly customText: string
  readonly freeText: string
}

export function emptyAskDraft(): AskAnswerDraft {
  return { selected: [], customSelected: false, customText: '', freeText: '' }
}

/** True while the draft for one block has no answer yet. */
export function isAskDraftEmpty(block: AskBlock, draft: AskAnswerDraft): boolean {
  if (block.kind === 'text') return !draft.freeText.trim()
  if (block.kind === 'single' && draft.customSelected) return !draft.customText.trim()
  return isAskAnswerEmpty(draft.selected, draft.customSelected ? draft.customText : '')
}

/**
 * Formats one block's draft as its `Q (<id>): ...` line. Single-choice is
 * exclusive: a selected Custom carries only the custom text.
 */
export function formatAskDraft(block: AskBlock, draft: AskAnswerDraft): string {
  if (block.kind === 'text') return formatAskAnswer(block, [], draft.freeText)
  const customInput = draft.customSelected ? draft.customText : ''
  const effectiveSelected = block.kind === 'single' && draft.customSelected ? [] : draft.selected
  return formatAskAnswer(block, effectiveSelected, customInput)
}

/**
 * Formats the combined send for every block under one assistant message:
 * one `Q (<id>): ...` line per question, in block order, sent as a single
 * user message so history stays append-only.
 */
export function formatAskAnswers(
  blocks: readonly AskBlock[],
  drafts: readonly AskAnswerDraft[],
): string {
  return blocks.map((block, index) => formatAskDraft(block, drafts[index]!)).join('\n')
}
