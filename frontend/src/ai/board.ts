/**
 * Stage E blackboard helpers (issue #427). Client mirror of the backend
 * `app/ai/boards.py` seam: one fresh Animation Script per middle slide from
 * zero with marks at every PrompterPart boundary, hard-locked to accepted
 * narration times (overrun/drift blocks, no auto-shift), create-then-reveal
 * text/tables with reveal/mark/wipe verbs using compiler built-ins only,
 * disappear via opacity holds, invalid targets and unresolved bindings
 * blocked at compile time, no cat in the middle, static board camera unless
 * the accepted scenario explicitly asks for a board move.
 */

export interface BoardPart {
  stepId: string
  order: number
  spokenLine: string
  partTag?: string
  estimatedDuration?: number
  audioDuration?: number | null
  timelineStart: number
  timelineEnd: number
}

export interface BoardMark {
  mark: string
  stepId: string
  time: number
  windowStart: number
  windowEnd: number
}

export interface BoardScript {
  slideId: string
  slideIndex?: number
  source: string
}

export interface BoardFootprintEffect {
  start: number
  duration: number
}

export interface BoardFootprint {
  from: number
  to: number
  effects?: BoardFootprintEffect[]
  entryVersions?: Record<string, number>
}

export interface BoardDiagnostic {
  severity: 'error' | 'warning'
  message: string
}

export const BOARD_COMMAND_TYPES: readonly string[] = ['SetSlideAnimationScript']

const FORBIDDEN_BOARD_METHODS: readonly string[] = [
  'play',
  'apply',
  'morph',
  'control',
  'shadow',
  'symmetry',
  'dataLabel',
]

const BOARD_MOVE_TOKENS: readonly string[] = [
  'board move',
  'pan',
  'zoom',
  'dolly',
  'camera move',
  'camera pan',
  'camera zoom',
]

export function markNameForPart(index: number): string {
  return `part-${Math.trunc(index)}`
}

export function middlePartsFromNarration(parts: readonly BoardPart[]): BoardPart[] {
  const out: BoardPart[] = []
  for (const part of parts) {
    if (!part || typeof part.stepId !== 'string' || !part.stepId) continue
    if (typeof part.spokenLine !== 'string' || !part.spokenLine) continue
    if (typeof part.partTag === 'string' && part.partTag && part.partTag !== 'middle') continue
    if (typeof part.timelineStart !== 'number' || typeof part.timelineEnd !== 'number')
      throw new Error(
        `part ${part.stepId} has no measurable narration window — fix PrompterPart timing before scripting`,
      )
    if (!(part.timelineEnd > part.timelineStart))
      throw new Error(
        `part ${part.stepId} has an empty narration window ([${part.timelineStart}, ${part.timelineEnd}]) — fix PrompterPart timing before scripting`,
      )
    out.push({ ...part })
  }
  if (out.length === 0) throw new Error('no measurable middle narration parts — nothing to script')
  out.sort((a, b) => a.timelineStart - b.timelineStart || a.order - b.order)
  return out
}

export function slideDurationForParts(parts: readonly BoardPart[]): number {
  let total = 0
  for (const part of parts) {
    if (typeof part.audioDuration === 'number' && part.audioDuration > 0) {
      total += part.audioDuration
      continue
    }
    total += typeof part.estimatedDuration === 'number' ? part.estimatedDuration : 0
  }
  return total
}

export function marksForParts(parts: readonly BoardPart[]): BoardMark[] {
  const ordered = middlePartsFromNarration(parts)
  return ordered.map((part, index) => ({
    mark: markNameForPart(index),
    stepId: part.stepId,
    time: part.timelineStart,
    windowStart: part.timelineStart,
    windowEnd: part.timelineEnd,
  }))
}

export function marksMapForParts(
  parts: readonly BoardPart[],
): Record<string, { stepId: string; time: number }> {
  const out: Record<string, { stepId: string; time: number }> = {}
  for (const entry of marksForParts(parts)) {
    out[entry.mark] = { stepId: entry.stepId, time: entry.time }
  }
  return out
}

export function buildTemplateSource(parts: readonly BoardPart[], title = 'Board middle'): string {
  const ordered = middlePartsFromNarration(parts)
  const clean = title.trim() || 'Board middle'
  const lines = [`script "${clean}" from 0`]
  ordered.forEach((_part, index) => {
    const mark = markNameForPart(index)
    lines.push(`mark("${mark}")`)
    const alias = `line${index}`
    lines.push(`create text "Board line ${index + 1}" as ${alias}`)
    lines.push(`reveal(${alias})`)
  })
  const lastEnd = ordered[ordered.length - 1]?.timelineEnd ?? 0
  lines.push(`// slide ends at ${lastEnd.toFixed(2)}s = sum of accepted part durations`)
  return `${lines.join('\n')}\n`
}

export function validateScriptHeader(source: string): string[] {
  if (typeof source !== 'string' || !source.trim()) {
    return ['script is empty — author one fresh script per middle slide from zero']
  }
  const firstLine = source.trim().split('\n', 1)[0] ?? ''
  if (!firstLine.trimStart().startsWith('script')) {
    return ['script must start with a header: script "<title>" from 0']
  }
  const match = /\bfrom\b\s+([0-9]+(?:\.[0-9]+)?)/.exec(firstLine)
  if (!match) {
    return ['script header must declare its origin: script "<title>" from 0']
  }
  const origin = Number(match[1])
  if (!(Math.abs(origin) <= 1e-9)) {
    return [
      `script must start at zero (from 0), got from ${match[1]} — one fresh script per middle slide, no per-part offsets`,
    ]
  }
  return []
}

export function validateMarksPresent(source: string, parts: readonly BoardPart[]): string[] {
  const errors: string[] = []
  const ordered = middlePartsFromNarration(parts)
  ordered.forEach((part, index) => {
    const mark = markNameForPart(index)
    if (!source.includes(`mark("${mark}")`) && !source.includes(`mark('${mark}')`)) {
      errors.push(
        `part ${part.stepId}: missing compile-time mark("${mark}") at its narration boundary — every effect needs an owning window`,
      )
    }
  })
  return errors
}

export function validateBoardContent(source: string): string[] {
  const errors: string[] = []
  if (typeof source !== 'string' || !source.trim()) {
    return ['script is empty — author board content via create-then-reveal']
  }
  const stripped = source
    .split('\n')
    .map((line) => line.split('//', 1)[0] ?? '')
    .join('\n')
  const lowered = stripped.toLowerCase()
  const hasText = lowered.includes('create text')
  const hasTable = lowered.includes('create table')
  if (!hasText && !hasTable) {
    errors.push(
      'board content must be authored via script-created nodes (create text and/or create table) then reveal/mark/wipe — no pre-placed board nodes',
    )
  }
  const hasEffect =
    lowered.includes('reveal(') || lowered.includes('wipe(') || lowered.includes('mark(')
  if (!hasEffect) {
    errors.push('board script must animate with reveal/mark/wipe verbs (compiler built-ins only)')
  }
  if (lowered.includes('function ')) {
    errors.push(
      'board scripts use compiler built-ins only — no local function definitions and no shared library entry in this spec',
    )
  }
  for (const method of FORBIDDEN_BOARD_METHODS) {
    if (lowered.includes(`${method}(`)) {
      errors.push(
        `board script must not call ${method}(...) — reveal/mark/wipe plus create-then-reveal only`,
      )
    }
  }
  if (/\bvisible\b/.test(lowered)) {
    errors.push(
      'disappear lowers to opacity holds (tween/set opacity to zero) — no Visible Track writes',
    )
  }
  return errors
}

export function boardMoveRequested(actions: readonly unknown[]): boolean {
  for (const action of actions) {
    if (typeof action !== 'string') continue
    const lowered = action.toLowerCase()
    for (const token of BOARD_MOVE_TOKENS) {
      if (token.includes(' ')) {
        if (lowered.includes(token)) return true
      } else if (new RegExp(`\\b${token}\\b`).test(lowered)) {
        return true
      }
    }
  }
  return false
}

export function verifyBoardScene(
  catNodes?: readonly unknown[] | null,
  cameraKeys?: readonly { property?: unknown }[] | null,
  boardMove = false,
): { ok: boolean; message: string } {
  const cats = (catNodes ?? []).filter((c) => typeof c === 'string' && (c as string).trim())
  if (cats.length > 0) {
    return {
      ok: false,
      message: `middle slides carry no cat nodes (found ${cats.length}) — the teaching beats stay locked on the board`,
    }
  }
  const keys = [...(cameraKeys ?? [])]
  for (const key of keys) {
    const prop = String((key as Record<string, unknown>).property ?? '')
    if (prop.trim().toLowerCase() === 'rotation') {
      return { ok: false, message: 'camera rotation is never written — static board framing' }
    }
  }
  if (keys.length > 0 && !boardMove) {
    return {
      ok: false,
      message:
        'board camera stays static unless the accepted scenario explicitly asks for a board move — remove the camera keys or accept a scenario with a board move first',
    }
  }
  return {
    ok: true,
    message: `board scene holds: no cat in the middle, ${keys.length > 0 ? 'board move licensed by the accepted scenario' : 'static board camera'}`,
  }
}

function owningPart(ordered: readonly BoardPart[], time: number): BoardPart | null {
  for (const part of ordered) {
    if (time >= part.timelineStart - 1e-9 && time < part.timelineEnd - 1e-9) return part
    if (Math.abs(time - part.timelineEnd) <= 1e-9 && part === ordered[ordered.length - 1])
      return part
  }
  const last = ordered[ordered.length - 1]
  if (last && Math.abs(time - last.timelineEnd) <= 1e-9) return last
  return null
}

export function validateHardLock(
  parts: readonly BoardPart[],
  footprints: readonly BoardFootprint[],
  marksMap?: Record<string, unknown> | null,
): string[] {
  const errors: string[] = []
  let ordered: BoardPart[]
  try {
    ordered = middlePartsFromNarration(parts)
  } catch (error) {
    return [error instanceof Error ? error.message : 'no measurable middle narration parts']
  }
  const duration = slideDurationForParts(ordered)
  if (!Array.isArray(footprints) || footprints.length === 0) {
    return ['no compiled footprints reported — compile each middle script first']
  }
  footprints.forEach((footprint, index) => {
    if (!footprint || typeof footprint !== 'object') {
      errors.push(`slide #${index}: footprint is corrupt — recompile`)
      return
    }
    if (Math.abs(footprint.from) > 1e-9) {
      errors.push(
        `slide #${index}: script must start at zero (from 0), got from ${footprint.from} — one fresh script per middle slide`,
      )
    }
    if (footprint.to - duration > 1e-6) {
      errors.push(
        `slide #${index}: script ends at ${footprint.to.toFixed(2)}s, past the narration duration (${duration.toFixed(2)}s) — overruns block the gate, no auto-shift`,
      )
    }
    for (const effect of footprint.effects ?? []) {
      const start = effect.start
      const length = effect.duration ?? 0
      const end = start + length
      const owner = owningPart(ordered, start)
      if (!owner) {
        errors.push(
          `slide #${index}: effect at ${start.toFixed(2)}s sits outside every narration window — every effect needs an owning part`,
        )
        continue
      }
      if (end - owner.timelineEnd > 1e-6) {
        errors.push(
          `slide #${index}: effect at ${start.toFixed(2)}s overruns part ${owner.stepId} ([${owner.timelineStart.toFixed(2)}s, ${owner.timelineEnd.toFixed(2)}s]) — visuals never slip voice, no auto-shift`,
        )
      }
      if (end - duration > 1e-6) {
        errors.push(
          `slide #${index}: effect ends at ${end.toFixed(2)}s, past the slide duration (${duration.toFixed(2)}s) — overruns block the gate`,
        )
      }
    }
  })
  if (marksMap !== undefined && marksMap !== null) {
    if (typeof marksMap !== 'object' || Array.isArray(marksMap)) {
      errors.push('marks-to-part map is corrupt — recompile')
    } else {
      for (const entry of marksForParts(ordered)) {
        const rawMapped = (marksMap as Record<string, unknown>)[entry.mark]
        const mapped = rawMapped as Record<string, unknown> | undefined
        if (!mapped) {
          errors.push(
            `missing mark "${entry.mark}" in the marks-to-part map — compile each script so marks land on part boundaries`,
          )
          continue
        }
        const mappedTime = (mapped.time ?? mapped.windowStart) as unknown
        if (typeof mappedTime !== 'number' || Math.abs(mappedTime - entry.time) > 1e-6) {
          errors.push(
            `mark "${entry.mark}" drifted to ${String(mappedTime)}s, accepted boundary is ${entry.time.toFixed(2)}s — drift blocks the gate, no auto-shift`,
          )
        }
      }
    }
  }
  return errors
}

export function validateTargetsAndBindings(
  diagnostics?: readonly BoardDiagnostic[] | null,
  footprints?: readonly BoardFootprint[] | null,
): string[] {
  const errors: string[] = []
  for (const diagnostic of diagnostics ?? []) {
    if (!diagnostic || diagnostic.severity !== 'error') continue
    errors.push(`compile blocks the gate: ${diagnostic.message}`)
  }
  for (const footprint of footprints ?? []) {
    const versions = footprint?.entryVersions
    if (versions && Object.keys(versions).length > 0) {
      errors.push(
        `board scripts use compiler built-ins only — no shared library entry in this spec (footprint inlined ${Object.keys(versions).sort().join(', ')})`,
      )
    }
  }
  return errors
}

export function buildBoardCommands(
  scripts: readonly BoardScript[],
): ({ type: string } & Record<string, unknown>)[] {
  if (scripts.length === 0)
    throw new Error('no board scripts — author one fresh script per middle slide')
  return scripts.map((script, index) => {
    if (!script.slideId.trim())
      throw new Error(`slide #${index}: no slideId mapped for this middle slide`)
    if (!script.source.trim())
      throw new Error(`slide #${index}: script is empty — author it before proposing`)
    return {
      type: 'SetSlideAnimationScript',
      slideId: script.slideId.trim(),
      source: script.source,
    }
  })
}

/** Accept-gate helper: board execution is SetSlideAnimationScript only. */
export function rejectForbiddenWrites(commands: readonly Record<string, unknown>[]): string[] {
  const errors: string[] = []
  commands.forEach((command, index) => {
    const ctype = String(command.type ?? '')
    if (ctype !== 'SetSlideAnimationScript') {
      errors.push(
        `command #${index} (${ctype || '?'}): Stage E executes board content as SetSlideAnimationScript only (create-then-reveal inside the script) — AiCreateBoardText/AiCreateBoardTable placeholders, mouth coefficients, and import writes are forbidden here`,
      )
      return
    }
    if ('shapeId' in command || 'fromShapeId' in command || 'toShapeId' in command) {
      errors.push(
        `command #${index} (${ctype}): baked shape ids are forbidden — board scripts stay portable`,
      )
    }
    if (
      String(command.property ?? '')
        .trim()
        .toLowerCase() === 'rotation'
    ) {
      errors.push(`command #${index} (${ctype}): camera rotation is never written`)
    }
  })
  return errors
}

export function boardAcceptBlockers(board: {
  parts?: readonly BoardPart[] | null
  scripts?: readonly (BoardScript & { source?: unknown })[] | null
  footprints?: readonly BoardFootprint[] | null
  marksMap?: Record<string, unknown> | null
  diagnostics?: readonly BoardDiagnostic[] | null
  checks?: { parts?: readonly BoardPart[]; scene?: Record<string, unknown> } | null
}): string[] {
  const blockers: string[] = []
  const parts = board.parts
  const scripts = board.scripts
  const footprints = board.footprints ?? []
  const marksMap = board.marksMap ?? {}
  const diagnostics = board.diagnostics ?? []
  const checks = board.checks ?? {}
  if (!Array.isArray(parts) || parts.length === 0) {
    return ['no accepted narration parts on this board — create it from accepted narration']
  }
  if (!Array.isArray(scripts) || scripts.length === 0) {
    blockers.push('no board scripts authored — author one fresh script per middle slide')
    return blockers
  }
  let ordered: BoardPart[]
  try {
    ordered = middlePartsFromNarration(parts as readonly BoardPart[])
  } catch (error) {
    return [error instanceof Error ? error.message : 'no measurable middle narration parts']
  }
  scripts.forEach((script, index) => {
    const source = (script as { source?: unknown }).source
    if (typeof source !== 'string' || !source.trim()) {
      blockers.push(`slide #${index}: script is empty — author it before accepting`)
      return
    }
    for (const message of validateScriptHeader(source)) blockers.push(`slide #${index}: ${message}`)
    for (const message of validateMarksPresent(source, ordered))
      blockers.push(`slide #${index}: ${message}`)
    for (const message of validateBoardContent(source)) blockers.push(`slide #${index}: ${message}`)
  })
  for (const message of validateHardLock(
    ordered,
    footprints,
    marksMap as Record<string, { time?: unknown }>,
  ))
    blockers.push(message)
  for (const message of validateTargetsAndBindings(diagnostics, footprints)) blockers.push(message)
  const scene = (checks as { scene?: unknown }).scene ?? checks
  if (scene && typeof scene === 'object') {
    const record = scene as Record<string, unknown>
    const cats = Array.isArray(record.catNodes) ? (record.catNodes as unknown[]) : []
    const keys = Array.isArray(record.cameraKeys)
      ? (record.cameraKeys as { property?: unknown }[])
      : []
    const move = Boolean(record.boardMove ?? record.boardMoveRequested ?? false)
    const verdict = verifyBoardScene(cats, keys, move)
    if (!verdict.ok) blockers.push(`scene: ${verdict.message}`)
  }
  return blockers
}
