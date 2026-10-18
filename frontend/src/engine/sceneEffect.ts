import { isRecord, requireFiniteNumber, requireString } from './guards'

function optionalVisualNumber(
  raw: unknown,
  what: string,
  fallback: number,
  allowZero: boolean,
): Record<string, number> {
  if (raw === undefined) return {}
  const value = requireFiniteNumber(raw, what)
  if (!allowZero && !(value > 0)) throw new Error(`${what} must be greater than 0`)
  if (value === fallback) return {}
  const key = what.endsWith('.scale') ? 'scale' : what.endsWith('.dx') ? 'dx' : 'dy'
  return { [key]: value }
}

function optionalVisualAnchor(raw: unknown, what: string): Record<string, number> {
  if (raw === undefined) return {}
  const value = requireFiniteNumber(raw, what)
  if (value < 0 || value > 1) throw new Error(`${what} must be between 0 and 1`)
  if (value === 0.5) return {}
  const key = what.endsWith('anchorX') ? 'anchorX' : 'anchorY'
  return { [key]: value }
}

interface SweepEffect {
  readonly kind: 'reveal' | 'wipe' | 'mark'
  readonly id: string
  readonly start: number
  readonly duration: number
  /** Binding members that define the selected node/subtree paths. */
  readonly scopeNodeIds: readonly string[]
  /** Visible, measurable renderable members masked by the effect. */
  readonly nodeIds: readonly string[]
  readonly bounds: {
    readonly minX: number
    readonly minY: number
    readonly maxX: number
    readonly maxY: number
  }
  readonly visual:
    | { readonly kind: 'paw' }
    | { readonly kind: 'cloth' }
    | { readonly kind: 'marker' }
    | { readonly kind: 'none' }
    | {
        readonly kind: 'asset'
        readonly nodeId: string
        readonly scale?: number
        readonly anchorX?: number
        readonly anchorY?: number
        readonly dx?: number
        readonly dy?: number
      }
}

/** Sweep direction for reveal/wipe performers and masks. Omitted when left-to-right. */
export type SweepDirection = 'left-to-right' | 'right-to-left'

export const SWEEP_DIRECTIONS: readonly SweepDirection[] = ['left-to-right', 'right-to-left']

/** Erratic amplitude range in world units: per-wiggle magnitude sampled from [from, to]. */
export interface WobbleRange {
  readonly from: number
  readonly to: number
}

export interface RevealEffect extends Omit<SweepEffect, 'kind' | 'visual'> {
  readonly kind: 'reveal'
  readonly visual:
    | { readonly kind: 'paw' }
    | { readonly kind: 'none' }
    | {
        readonly kind: 'asset'
        readonly nodeId: string
        /** Multiplier over the parked performer's own scale. Omitted when 1. */
        readonly scale?: number
        /** Normalized sprite anchor (0..1). Omitted when centered (0.5, 0.5). */
        readonly anchorX?: number
        readonly anchorY?: number
        /** World-unit nudge applied to the pen point. Omitted when 0. */
        readonly dx?: number
        readonly dy?: number
      }
  /** Sweep direction. Omitted when 'left-to-right'. */
  readonly direction?: SweepDirection
  /** Horizontal erratic amplitude range in world units. Omitted when zero. */
  readonly wobbleX?: WobbleRange
  /** Vertical erratic amplitude range in world units. Omitted when zero. */
  readonly wobbleY?: WobbleRange
  /** Erratic wiggle rate in wiggles per second. Omitted when using the legacy fixed rate. */
  readonly wobbleSpeed?: number
}

export interface WipeEffect extends Omit<SweepEffect, 'kind' | 'visual'> {
  readonly kind: 'wipe'
  readonly visual:
    | { readonly kind: 'cloth' }
    | { readonly kind: 'none' }
    | {
        readonly kind: 'asset'
        readonly nodeId: string
        /** Multiplier over the parked performer's own scale. Omitted when 1. */
        readonly scale?: number
        /** Normalized sprite anchor (0..1). Omitted when centered (0.5, 0.5). */
        readonly anchorX?: number
        readonly anchorY?: number
        /** World-unit nudge applied to the pen point. Omitted when 0. */
        readonly dx?: number
        readonly dy?: number
      }
  /** Sweep direction. Omitted when 'left-to-right'. */
  readonly direction?: SweepDirection
  /** Horizontal erratic amplitude range in world units. Omitted when zero. */
  readonly wobbleX?: WobbleRange
  /** Vertical erratic amplitude range in world units. Omitted when zero. */
  readonly wobbleY?: WobbleRange
  /** Erratic wiggle rate in wiggles per second. Omitted when using the legacy fixed rate. */
  readonly wobbleSpeed?: number
}

export interface TemporaryMark extends Omit<SweepEffect, 'kind' | 'visual'> {
  readonly kind: 'mark'
  readonly visual:
    | { readonly kind: 'marker' }
    | { readonly kind: 'none' }
    | {
        readonly kind: 'asset'
        readonly nodeId: string
        /** Multiplier over the parked performer's own scale. Omitted when 1. */
        readonly scale?: number
        /** Normalized sprite anchor (0..1). Omitted when centered (0.5, 0.5). */
        readonly anchorX?: number
        readonly anchorY?: number
        /** World-unit nudge applied to the pen point. Omitted when 0. */
        readonly dx?: number
        readonly dy?: number
      }
}

export type SceneEffect = RevealEffect | WipeEffect | TemporaryMark

function optionalWobbleRange(raw: unknown, what: string): Record<string, WobbleRange> {
  if (raw === undefined) return {}
  if (!isRecord(raw)) throw new Error(`${what} must be a record like { from: 0, to: 8 }`)
  const from = requireFiniteNumber(raw.from, `${what}.from`)
  const to = requireFiniteNumber(raw.to, `${what}.to`)
  if (from < 0 || to < 0) throw new Error(`${what}.from and ${what}.to must be non-negative`)
  if (from > to) throw new Error(`${what}.from must not exceed ${what}.to`)
  if (from === 0 && to === 0) return {}
  return { [what.endsWith('wobbleX') ? 'wobbleX' : 'wobbleY']: { from, to } }
}

function optionalWobbleSpeed(raw: unknown, what: string): Record<string, number> {
  if (raw === undefined) return {}
  const value = requireFiniteNumber(raw, what)
  if (!(value > 0)) throw new Error(`${what} must be greater than 0`)
  return { wobbleSpeed: value }
}

function optionalSweepDirection(raw: unknown, what: string): Record<string, SweepDirection> {
  if (raw === undefined) return {}
  if (raw !== 'left-to-right' && raw !== 'right-to-left') {
    throw new Error(`${what} must be "left-to-right" or "right-to-left"`)
  }
  if (raw === 'left-to-right') return {}
  return { direction: raw }
}

export function sceneEffectToJSON(effect: SceneEffect): unknown {
  const json: Record<string, unknown> = {
    ...effect,
    nodeIds: [...effect.nodeIds],
    bounds: { ...effect.bounds },
    visual: { ...effect.visual },
  }
  if (effect.kind !== 'mark') {
    if (effect.direction === 'left-to-right') delete json.direction
    const isZeroWobble = (range: WobbleRange | undefined) =>
      range !== undefined && range.from === 0 && range.to === 0
    if (effect.wobbleX !== undefined) {
      if (isZeroWobble(effect.wobbleX)) delete json.wobbleX
      else json.wobbleX = { ...effect.wobbleX }
    }
    if (effect.wobbleY !== undefined) {
      if (isZeroWobble(effect.wobbleY)) delete json.wobbleY
      else json.wobbleY = { ...effect.wobbleY }
    }
  } else {
    delete json.direction
    delete json.wobbleX
    delete json.wobbleY
    delete json.wobbleSpeed
  }
  return json
}

export function sceneEffectFromJSON(value: unknown): SceneEffect {
  if (!isRecord(value) || !['reveal', 'wipe', 'mark'].includes(String(value.kind))) {
    throw new Error('Scene effect must be a reveal, wipe, or mark')
  }
  const label = value.kind === 'wipe' ? 'Wipe' : value.kind === 'mark' ? 'Mark' : 'Reveal'
  if (
    !Array.isArray(value.scopeNodeIds) ||
    !Array.isArray(value.nodeIds) ||
    !isRecord(value.bounds) ||
    !isRecord(value.visual)
  ) {
    throw new Error(`${label} effect requires scopeNodeIds, nodeIds, bounds, and visual`)
  }
  const scopeNodeIds = value.scopeNodeIds.map((id, index) =>
    requireString(id, `Reveal scopeNodeIds[${index}]`),
  )
  const nodeIds = value.nodeIds.map((id, index) => requireString(id, `Reveal nodeIds[${index}]`))
  if (scopeNodeIds.length === 0 || nodeIds.length === 0) {
    throw new Error(`${label} effect requires non-empty scope and renderable target membership`)
  }
  if (
    new Set(scopeNodeIds).size !== scopeNodeIds.length ||
    new Set(nodeIds).size !== nodeIds.length
  ) {
    throw new Error(`${label} effect target membership must not contain duplicate node ids`)
  }
  const visualKind = value.visual.kind
  const visual =
    visualKind === 'paw' ||
    visualKind === 'cloth' ||
    visualKind === 'none' ||
    visualKind === 'marker'
      ? ({ kind: visualKind } as const)
      : visualKind === 'asset'
        ? {
            kind: 'asset' as const,
            nodeId: requireString(value.visual.nodeId, 'Reveal visual.nodeId'),
            ...optionalVisualNumber(value.visual.scale, 'Reveal visual.scale', 0, false),
            ...optionalVisualAnchor(value.visual.anchorX, 'Reveal visual.anchorX'),
            ...optionalVisualAnchor(value.visual.anchorY, 'Reveal visual.anchorY'),
            ...optionalVisualNumber(value.visual.dx, 'Reveal visual.dx', 0, true),
            ...optionalVisualNumber(value.visual.dy, 'Reveal visual.dy', 0, true),
          }
        : (() => {
            throw new Error(`${label} visual.kind must be paw, cloth, marker, none, or asset`)
          })()
  if (
    (value.kind === 'reveal' && visual.kind === 'cloth') ||
    (value.kind === 'wipe' && visual.kind === 'paw') ||
    (value.kind === 'mark' && (visual.kind === 'paw' || visual.kind === 'cloth')) ||
    (value.kind !== 'mark' && visual.kind === 'marker')
  ) {
    throw new Error(`${label} visual is incompatible with its effect kind`)
  }
  const shared = {
    id: requireString(value.id, `${label} id`),
    start: requireFiniteNumber(value.start, `${label} start`),
    duration: requireFiniteNumber(value.duration, `${label} duration`),
    scopeNodeIds,
    nodeIds,
    bounds: {
      minX: requireFiniteNumber(value.bounds.minX, `${label} bounds.minX`),
      minY: requireFiniteNumber(value.bounds.minY, `${label} bounds.minY`),
      maxX: requireFiniteNumber(value.bounds.maxX, `${label} bounds.maxX`),
      maxY: requireFiniteNumber(value.bounds.maxY, `${label} bounds.maxY`),
    },
    visual,
  }
  if (
    value.kind === 'mark' &&
    (value.direction !== undefined ||
      value.wobbleX !== undefined ||
      value.wobbleY !== undefined ||
      value.wobbleSpeed !== undefined)
  ) {
    throw new Error('Mark effect must not carry direction, wobbleX, wobbleY, or wobbleSpeed')
  }
  const sweep =
    value.kind === 'mark'
      ? {}
      : {
          ...optionalSweepDirection(value.direction, `${label} direction`),
          ...optionalWobbleRange(value.wobbleX, `${label} wobbleX`),
          ...optionalWobbleRange(value.wobbleY, `${label} wobbleY`),
          ...optionalWobbleSpeed(value.wobbleSpeed, `${label} wobbleSpeed`),
        }
  const effect: SceneEffect =
    value.kind === 'mark'
      ? { ...shared, kind: 'mark', visual: visual as TemporaryMark['visual'] }
      : value.kind === 'reveal'
        ? { ...shared, ...sweep, kind: 'reveal', visual: visual as RevealEffect['visual'] }
        : { ...shared, ...sweep, kind: 'wipe', visual: visual as WipeEffect['visual'] }
  if (effect.start < 0 || effect.duration <= 0) {
    throw new Error(`${label} start must be non-negative and duration must be greater than zero`)
  }
  if (effect.bounds.maxX < effect.bounds.minX || effect.bounds.maxY < effect.bounds.minY) {
    throw new Error(`${label} bounds must have non-negative width and height`)
  }
  return effect
}

export function revealCoverage(effect: SceneEffect, time: number): number {
  return Math.max(0, Math.min(1, (time - effect.start) / effect.duration))
}

/** Latest scheduled reveal/wipe governing one node: later starts win once reached. */
export function selectRevealWipeForNode(
  effects: readonly SceneEffect[],
  nodeId: string,
  time: number,
): Exclude<SceneEffect, TemporaryMark> | undefined {
  const relevant = effects
    .filter((effect) => effect.kind !== 'mark' && effect.nodeIds.includes(nodeId))
    .sort((a, b) => a.start - b.start || effects.indexOf(a) - effects.indexOf(b))
  return ([...relevant].reverse().find((candidate) => candidate.start <= time) ?? relevant[0]) as
    Exclude<SceneEffect, TemporaryMark> | undefined
}

/** Active marks with latest-scheduled precedence on overlapping targets. */
export function selectActiveMarks(effects: readonly SceneEffect[], time: number): TemporaryMark[] {
  const active = effects.filter(
    (effect): effect is TemporaryMark =>
      effect.kind === 'mark' && time >= effect.start && time < effect.start + effect.duration,
  )
  return active.filter(
    (mark) =>
      !active.some((other) => {
        if (other === mark) return false
        const later =
          other.start > mark.start ||
          (other.start === mark.start && effects.indexOf(other) > effects.indexOf(mark))
        return later && other.nodeIds.some((nodeId) => mark.nodeIds.includes(nodeId))
      }),
  )
}

/** The mark is drawn, held, then faded in fixed 50/20/30 phase proportions. */
export function markLifecycle(
  effect: TemporaryMark,
  time: number,
): {
  readonly drawProgress: number
  readonly opacity: number
} {
  const progress = revealCoverage(effect, time)
  return {
    drawProgress: Math.min(1, progress / 0.5),
    opacity: progress < 0.7 ? 1 : Math.max(0, (1 - progress) / 0.3),
  }
}
