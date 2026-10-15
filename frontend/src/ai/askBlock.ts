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
    const item = /^-+\s*id\s*[:=]\s*(.+?)\s*$/.exec(trimmed)
    if (item?.[1] && inOptions) {
      flush()
      const optionId = clean(item[1])
      if (!optionId) {
        current = null
        continue
      }
      current = { id: optionId, label: null, detail: null }
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
