import { isRecord, requireFiniteNumber, requireString } from './guards'

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
    | { readonly kind: 'asset'; readonly nodeId: string }
}

export interface RevealEffect extends Omit<SweepEffect, 'kind' | 'visual'> {
  readonly kind: 'reveal'
  readonly visual:
    | { readonly kind: 'paw' }
    | { readonly kind: 'none' }
    | { readonly kind: 'asset'; readonly nodeId: string }
}

export interface WipeEffect extends Omit<SweepEffect, 'kind' | 'visual'> {
  readonly kind: 'wipe'
  readonly visual:
    | { readonly kind: 'cloth' }
    | { readonly kind: 'none' }
    | { readonly kind: 'asset'; readonly nodeId: string }
}

export interface TemporaryMark extends Omit<SweepEffect, 'kind' | 'visual'> {
  readonly kind: 'mark'
  readonly visual:
    | { readonly kind: 'marker' }
    | { readonly kind: 'none' }
    | { readonly kind: 'asset'; readonly nodeId: string }
}

export type SceneEffect = RevealEffect | WipeEffect | TemporaryMark

export function sceneEffectToJSON(effect: SceneEffect): unknown {
  return {
    ...effect,
    nodeIds: [...effect.nodeIds],
    bounds: { ...effect.bounds },
    visual: { ...effect.visual },
  }
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
  const effect: SceneEffect =
    value.kind === 'mark'
      ? { ...shared, kind: 'mark', visual: visual as TemporaryMark['visual'] }
      : value.kind === 'reveal'
        ? { ...shared, kind: 'reveal', visual: visual as RevealEffect['visual'] }
        : { ...shared, kind: 'wipe', visual: visual as WipeEffect['visual'] }
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
