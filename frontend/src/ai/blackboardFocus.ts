/**
 * United Blackboard focus (issue #472): active-slide-only polish context.
 *
 * Pure seam: given the live active slide, derives the LLM-facing summary the
 * Blackboard assistant polishes from — slide id/name/length plus prompt block
 * ids with windows and text, and per-action block fractions — without reading
 * whole scripts.
 *
 * Prompt blocks are the slide's live PrompterParts (id, [start, end), text).
 * Actions are the sequential board effects in the slide's Animation Script
 * source (`reveal/carry/wipe/mark(alias, ..., over: X)`), each tied to its
 * owning prompt block (the block whose window contains the action midpoint)
 * with a fractional position (midpoint over slide duration). Fractions live in
 * context metadata only; generated sources stay purely sequential.
 */

export interface BlackboardPromptBlock {
  readonly id: string
  readonly start: number
  readonly end: number
  readonly text: string
}

export interface BlackboardActionFraction {
  readonly action: string
  readonly block: string
  readonly fraction: number
}

export interface BlackboardFocus {
  readonly slideId: string
  readonly slideName: string
  readonly duration: number
  readonly promptBlocks: readonly BlackboardPromptBlock[]
  readonly actions: readonly BlackboardActionFraction[]
}

interface FocusSlide {
  readonly id: string
  readonly name: string
  readonly duration: number
  readonly prompter?: { readonly parts?: readonly FocusPart[] } | null
  readonly animationScript?: { readonly source?: string } | null
}

interface FocusPart {
  readonly id: string
  readonly text: string
  readonly startTime: number
  readonly endTime: number
}

const MAX_BLOCK_TEXT = 500
const MAX_BLOCKS = 50
const MAX_ACTIONS = 100

const EFFECT_RE = /\b(reveal|carry|wipe|mark)\s*\(\s*([A-Za-z0-9_]+)/g
const OVER_RE = /\bover\s*:\s*([0-9]+(?:\.[0-9]+)?)/

function toFinite(value: unknown, otherwise: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : otherwise
}

function readPromptBlocks(slide: FocusSlide): BlackboardPromptBlock[] {
  const parts = slide.prompter?.parts ?? []
  const sorted = [...parts]
    .filter((p) => p && typeof p.id === 'string' && p.id.trim() !== '')
    .sort((a, b) => toFinite(a.startTime, 0) - toFinite(b.startTime, 0))
    .slice(0, MAX_BLOCKS)
  return sorted.map((part) => ({
    id: part.id,
    start: toFinite(part.startTime, 0),
    end: toFinite((part as { endTime?: unknown }).endTime, 0),
    text: typeof part.text === 'string' ? part.text.slice(0, MAX_BLOCK_TEXT) : '',
  }))
}

function owningBlock(blocks: readonly BlackboardPromptBlock[], midpoint: number): string {
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]!
    const isLast = i === blocks.length - 1
    const inside =
      midpoint >= block.start - 1e-9 &&
      (midpoint < block.end - 1e-9 || (isLast && midpoint <= block.end + 1e-9))
    if (inside) return block.id
  }
  // Midpoint outside every window (gap or no parts): nearest by start.
  if (blocks.length === 0) return ''
  let best = blocks[0]!.id
  let bestDist = Math.abs(midpoint - blocks[0]!.start)
  for (const block of blocks) {
    const dist = Math.abs(midpoint - block.start)
    if (dist < bestDist) {
      bestDist = dist
      best = block.id
    }
  }
  return best
}

function parseEffectOvers(source: string): { action: string; over: number }[] {
  const out: { action: string; over: number }[] = []
  const lines = source.split('\n')
  for (const line of lines) {
    const code = line.split('//', 1)[0] ?? ''
    EFFECT_RE.lastIndex = 0
    const match = EFFECT_RE.exec(code)
    if (!match) continue
    const verb = (match[1] ?? '').toLowerCase()
    const alias = match[2] ?? ''
    if (!alias) continue
    const overMatch = OVER_RE.exec(code)
    const over = overMatch ? Number(overMatch[1]) : 0
    out.push({
      action: `${verb}(${alias})`,
      over: Number.isFinite(over) && over >= 0 ? over : 0,
    })
    if (out.length >= MAX_ACTIONS) break
  }
  return out
}

/**
 * Derives the active-slide focus for Blackboard chat context. Pure and
 * read-only: never touches engine state. Returns null when there is no
 * active slide.
 */
export function buildBlackboardFocus(slide: FocusSlide | null): BlackboardFocus | null {
  if (!slide || typeof slide.id !== 'string' || slide.id.trim() === '') return null
  const duration = toFinite(slide.duration, 0)
  const promptBlocks = readPromptBlocks(slide)
  const source =
    typeof slide.animationScript?.source === 'string' ? slide.animationScript.source : ''
  const effects = source.trim() === '' ? [] : parseEffectOvers(source)
  const actions: BlackboardActionFraction[] = []
  let cursor = 0
  for (const effect of effects) {
    const midpoint = cursor + effect.over / 2
    const fraction = duration > 0 ? midpoint / duration : 0
    actions.push({
      action: effect.action,
      block: promptBlocks.length > 0 ? owningBlock(promptBlocks, midpoint) : '',
      fraction,
    })
    cursor += effect.over
  }
  return {
    slideId: slide.id,
    slideName: typeof slide.name === 'string' ? slide.name : '',
    duration,
    promptBlocks,
    actions,
  }
}
