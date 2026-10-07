import { isRecord, requireFiniteNumber, requireString } from './guards'

export interface RevealEffect {
  readonly kind: 'reveal'
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
    | { readonly kind: 'none' }
    | { readonly kind: 'asset'; readonly nodeId: string }
}

export type SceneEffect = RevealEffect

export function sceneEffectToJSON(effect: SceneEffect): unknown {
  return {
    ...effect,
    nodeIds: [...effect.nodeIds],
    bounds: { ...effect.bounds },
    visual: { ...effect.visual },
  }
}

export function sceneEffectFromJSON(value: unknown): SceneEffect {
  if (!isRecord(value) || value.kind !== 'reveal') throw new Error('Scene effect must be a reveal')
  if (
    !Array.isArray(value.scopeNodeIds) ||
    !Array.isArray(value.nodeIds) ||
    !isRecord(value.bounds) ||
    !isRecord(value.visual)
  ) {
    throw new Error('Reveal effect requires scopeNodeIds, nodeIds, bounds, and visual')
  }
  const scopeNodeIds = value.scopeNodeIds.map((id, index) =>
    requireString(id, `Reveal scopeNodeIds[${index}]`),
  )
  const nodeIds = value.nodeIds.map((id, index) => requireString(id, `Reveal nodeIds[${index}]`))
  if (scopeNodeIds.length === 0 || nodeIds.length === 0) {
    throw new Error('Reveal effect requires non-empty scope and renderable target membership')
  }
  if (
    new Set(scopeNodeIds).size !== scopeNodeIds.length ||
    new Set(nodeIds).size !== nodeIds.length
  ) {
    throw new Error('Reveal effect target membership must not contain duplicate node ids')
  }
  const visualKind = value.visual.kind
  const visual =
    visualKind === 'paw' || visualKind === 'none'
      ? ({ kind: visualKind } as const)
      : visualKind === 'asset'
        ? {
            kind: 'asset' as const,
            nodeId: requireString(value.visual.nodeId, 'Reveal visual.nodeId'),
          }
        : (() => {
            throw new Error('Reveal visual.kind must be paw, none, or asset')
          })()
  const effect: RevealEffect = {
    kind: 'reveal',
    id: requireString(value.id, 'Reveal id'),
    start: requireFiniteNumber(value.start, 'Reveal start'),
    duration: requireFiniteNumber(value.duration, 'Reveal duration'),
    scopeNodeIds,
    nodeIds,
    bounds: {
      minX: requireFiniteNumber(value.bounds.minX, 'Reveal bounds.minX'),
      minY: requireFiniteNumber(value.bounds.minY, 'Reveal bounds.minY'),
      maxX: requireFiniteNumber(value.bounds.maxX, 'Reveal bounds.maxX'),
      maxY: requireFiniteNumber(value.bounds.maxY, 'Reveal bounds.maxY'),
    },
    visual,
  }
  if (effect.start < 0 || effect.duration <= 0) {
    throw new Error('Reveal start must be non-negative and duration must be greater than zero')
  }
  if (effect.bounds.maxX < effect.bounds.minX || effect.bounds.maxY < effect.bounds.minY) {
    throw new Error('Reveal bounds must have non-negative width and height')
  }
  return effect
}

export function revealCoverage(effect: RevealEffect, time: number): number {
  return Math.max(0, Math.min(1, (time - effect.start) / effect.duration))
}
