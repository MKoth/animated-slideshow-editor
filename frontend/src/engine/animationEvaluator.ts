import { requireFiniteNumber } from './guards'
import type { Keyframe } from './keyframe'
import type { MaterialOverrideValue, MaterialOverrides } from './materialInstance'
import type { MaterialParameterKindOf } from './keyframeTarget'
import type { SceneNode } from './sceneNode'
import { isGroupNode } from './sceneNode'
import type { Slide } from './slide'
import { identityTransform, pivotsEqual } from './transform'
import type { Transform, Pivot } from './transform'
import { evaluateSegment } from './interpolators'
import { evaluateMaterialTrackValue } from './materialTrackEvaluation'
import type { AnimationProperty } from './animationProperties'
import type { ClipDefinition } from './clipDefinition'
import { circleSegmentsForArc } from './circleComponent'
import type { MeshVertex } from './mesh'
import type { Shape } from './shape'
import { resolveCrossBlendedVertices, resolveMorphedVerticesFromKeyframe } from './shape'
import type { MorphKeyframeValue, MorphClipKeyframeValue } from './shape'
import type { ShadowEffect, ShadowProperty } from './shadowEffect'
import { SHADOW_PROPERTIES, lerpHexColor } from './shadowEffect'

export interface EvaluatedNodeState {
  readonly transform: Transform
  readonly opacity: number
  readonly visible: boolean
}

type MutableTransform = {
  x: number
  y: number
  rotation: number
  scaleX: number
  scaleY: number
  localPivot?: Pivot
}

export interface EvaluatedNodeScratch {
  transform: MutableTransform
  opacity: number
  visible: boolean
}

export interface EvaluatedCircleState {
  readonly radius: number
  readonly startAngle: number
  readonly endAngle: number
  readonly segments: number
}

export interface EvaluatedTableState {
  readonly borderRadius: number
  readonly padding: number
}

export function evaluatedNodeScratch(): EvaluatedNodeScratch {
  return { transform: { ...identityTransform() }, opacity: 1, visible: true }
}

/** A reusable target for evaluated material overrides (Spec 07 R29). */
export interface EvaluatedMaterialOverridesScratch {
  keys: string[]
  values: Record<string, MaterialOverrideValue>
}

export function evaluatedMaterialOverridesScratch(): EvaluatedMaterialOverridesScratch {
  return { keys: [], values: {} }
}

export function evaluatedStatesEqual(
  previous: EvaluatedNodeScratch,
  state: EvaluatedNodeState,
): boolean {
  const prevPivot = previous.transform.localPivot
  const statePivot = state.transform.localPivot
  const pivotEqual =
    (!prevPivot && !statePivot) ||
    (prevPivot !== undefined && statePivot !== undefined && pivotsEqual(prevPivot, statePivot))
  return (
    previous.transform.x === state.transform.x &&
    previous.transform.y === state.transform.y &&
    previous.transform.rotation === state.transform.rotation &&
    previous.transform.scaleX === state.transform.scaleX &&
    previous.transform.scaleY === state.transform.scaleY &&
    pivotEqual &&
    previous.opacity === state.opacity &&
    previous.visible === state.visible
  )
}

export function copyEvaluatedState(target: EvaluatedNodeScratch, state: EvaluatedNodeState): void {
  target.transform.x = state.transform.x
  target.transform.y = state.transform.y
  target.transform.rotation = state.transform.rotation
  target.transform.scaleX = state.transform.scaleX
  target.transform.scaleY = state.transform.scaleY
  if (state.transform.localPivot) {
    target.transform.localPivot = { ...state.transform.localPivot }
  } else {
    delete target.transform.localPivot
  }
  target.opacity = state.opacity
  target.visible = state.visible
}

const CHANNEL_TO_TRANSFORM_KEY: Record<AnimationProperty, string> = {
  positionX: 'x',
  positionY: 'y',
  rotation: 'rotation',
  scaleX: 'scaleX',
  scaleY: 'scaleY',
  opacity: 'opacity',
}

export class AnimationEvaluator {
  readonly #nodeLookup: (nodeId: string) => SceneNode
  readonly #slideLookup: (nodeId: string) => Slide
  readonly #parameterKindOf: MaterialParameterKindOf
  readonly #clipLookup: (clipId: string) => ClipDefinition

  constructor(
    nodeLookup: (nodeId: string) => SceneNode,
    slideLookup: (nodeId: string) => Slide,
    parameterKindOf: MaterialParameterKindOf,
    clipLookup: (clipId: string) => ClipDefinition,
  ) {
    this.#nodeLookup = nodeLookup
    this.#slideLookup = slideLookup
    this.#parameterKindOf = parameterKindOf
    this.#clipLookup = clipLookup
  }

  evaluateNode(nodeId: string, time: number, target?: EvaluatedNodeScratch): EvaluatedNodeState {
    const node = this.#nodeLookup(nodeId)
    const slide = this.#slideLookup(nodeId)
    const boundedTime = requireFiniteNumber(time, 'Evaluation time')
    const clampedTime = Math.min(Math.max(boundedTime, 0), slide.duration)
    const animation = slide.animation.node(nodeId)
    const transform = node.transform
    const state = target ?? evaluatedNodeScratch()
    const evaluated = state.transform
    evaluated.x = this.#evaluate(animation?.keyframes('positionX'), clampedTime, transform.x)
    evaluated.y = this.#evaluate(animation?.keyframes('positionY'), clampedTime, transform.y)
    evaluated.rotation = this.#evaluate(
      animation?.keyframes('rotation'),
      clampedTime,
      transform.rotation,
    )
    evaluated.scaleX = this.#evaluate(animation?.keyframes('scaleX'), clampedTime, transform.scaleX)
    evaluated.scaleY = this.#evaluate(animation?.keyframes('scaleY'), clampedTime, transform.scaleY)
    if (transform.localPivot) {
      evaluated.localPivot = { ...transform.localPivot }
    } else {
      delete evaluated.localPivot
    }
    state.opacity = this.#evaluate(animation?.keyframes('opacity'), clampedTime, node.opacity)
    state.visible = this.evaluateVisible(nodeId, clampedTime)

    this.#applyClipInstances(node, clampedTime, state)

    return state
  }

  evaluateVisible(nodeId: string, time: number): boolean {
    const node = this.#nodeLookup(nodeId)
    const slide = this.#slideLookup(nodeId)
    const boundedTime = requireFiniteNumber(time, 'Evaluation time')
    const clampedTime = Math.min(Math.max(boundedTime, 0), slide.duration)
    const animation = slide.animation.node(nodeId)
    const keyframes = animation?.visibleKeyframes()
    if (!keyframes || keyframes.length === 0) {
      return node.visible
    }
    const first = keyframes[0]
    if (clampedTime <= first.time) {
      return first.value as boolean
    }
    const last = keyframes[keyframes.length - 1]
    if (clampedTime >= last.time) {
      return last.value as boolean
    }
    for (let i = 0; i < keyframes.length - 1; i += 1) {
      const from = keyframes[i]
      const to = keyframes[i + 1]
      if (clampedTime >= from.time && clampedTime < to.time) {
        if (from.interpolation !== 'hold') {
          throw new Error('Visible track only supports hold interpolation')
        }
        return from.value as boolean
      }
    }
    return last.value as boolean
  }

  evaluateShadow(nodeId: string, time: number): ShadowEffect | null {
    const node = this.#nodeLookup(nodeId)
    const slide = this.#slideLookup(nodeId)
    if (!isGroupNode(node) || !node.shadowEffect) return null
    const boundedTime = requireFiniteNumber(time, 'Evaluation time')
    const clampedTime = Math.min(Math.max(boundedTime, 0), slide.duration)
    const animation = slide.animation.node(nodeId)
    const base = node.shadowEffect
    const result: ShadowEffect = { ...base }
    // Evaluate each shadow track after visible (so we can compute shadowAlpha), before clip layering
    // Nine numerics via evaluateSegment, color via lerpHexColor
    for (const prop of SHADOW_PROPERTIES) {
      const keyframes = animation?.shadowKeyframes(prop as ShadowProperty)
      if (!keyframes || keyframes.length === 0) continue
      if (prop === 'color') {
        result.color = this.#evaluateShadowColor(keyframes, clampedTime, base.color)
      } else {
        const fallback = base[prop as Exclude<ShadowProperty, 'color'>] as number
        const evaluated = this.#evaluateShadowNumeric(keyframes, clampedTime, fallback)
        ;(result as unknown as Record<string, unknown>)[prop] = evaluated
      }
    }
    // shadowAlpha = nodeOpacity * shadowOpacity (evaluated)
    // Need evaluated node opacity (including its own clips via evaluateNode)
    // Do this before clip layering per spec ordering
    const nodeOpacity = this.evaluateNode(nodeId, clampedTime).opacity
    result.opacity = Math.max(0, Math.min(1, nodeOpacity * result.opacity))
    // Blur clamp
    if (!Number.isFinite(result.blur) || result.blur < 0) result.blur = 0
    else if (result.blur > 32) result.blur = 32
    // Apply clip layering last-wins
    this.#applyClipShadowInstances(node, clampedTime, result)
    this.#evaluateClipShadowColor(node, clampedTime, result)
    // Final clamp for numeric after clip
    if (!Number.isFinite(result.blur) || result.blur < 0) result.blur = 0
    else if (result.blur > 32) result.blur = 32
    result.opacity = Math.max(0, Math.min(1, result.opacity))
    if (typeof result.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(result.color)) {
      result.color = '#000000'
    } else {
      result.color = result.color.toLowerCase()
    }
    // Ensure finite for other numerics (fallback to base if NaN)
    for (const k of [
      'offsetX',
      'offsetY',
      'scaleX',
      'scaleY',
      'skewX',
      'skewY',
      'rotation',
    ] as const) {
      const v = result[k] as unknown
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        result[k] = base[k]
      }
    }
    return result
  }

  #evaluateShadowNumeric(keyframes: readonly Keyframe[], time: number, fallback: number): number {
    if (!keyframes || keyframes.length === 0) return fallback
    const first = keyframes[0]
    if (time <= first.time) return first.value as number
    const last = keyframes[keyframes.length - 1]
    if (time >= last.time) return last.value as number
    for (let i = 0; i < keyframes.length - 1; i += 1) {
      const from = keyframes[i]
      const to = keyframes[i + 1]
      if (to.time > from.time && time >= from.time && time < to.time) {
        return evaluateSegment(from, to, time)
      }
    }
    return last.value as number
  }

  #evaluateShadowColor(keyframes: readonly Keyframe[], time: number, fallback: string): string {
    if (!keyframes || keyframes.length === 0) return fallback
    const first = keyframes[0]
    if (time <= first.time) return (first.value as string).toLowerCase()
    const last = keyframes[keyframes.length - 1]
    if (time >= last.time) return (last.value as string).toLowerCase()
    for (let i = 0; i < keyframes.length - 1; i += 1) {
      const from = keyframes[i]
      const to = keyframes[i + 1]
      if (time >= from.time && time < to.time) {
        if (from.interpolation === 'hold') return (from.value as string).toLowerCase()
        const ratio = (time - from.time) / (to.time - from.time)
        return lerpHexColor(from.value as string, to.value as string, ratio)
      }
    }
    return (last.value as string).toLowerCase()
  }

  #applyClipShadowInstances(node: SceneNode, time: number, state: ShadowEffect): void {
    const instances = node.clipInstances
    if (instances.length === 0) return
    for (const instance of instances) {
      if (!instance.enabled) continue
      let clip: ClipDefinition
      try {
        clip = this.#clipLookup(instance.clipId)
      } catch {
        continue
      }
      if (clip.duration <= 0) continue
      if (time < instance.startTime) continue
      const u = Math.min(
        Math.max(((time - instance.startTime) * instance.speed) / clip.duration, 0),
        1,
      )
      for (const prop of SHADOW_PROPERTIES) {
        if (prop === 'color') continue
        const anim = clip.shadowChannelAnimation(prop as ShadowProperty)
        if (!anim || anim.length === 0) continue
        const kfValue = this.#evaluateClipShadowNumeric(anim.keyframes(), u)
        // Opacity clip should not be re-multiplied by nodeOpacity; last-wins directly
        ;(state as unknown as Record<string, unknown>)[prop] = kfValue
      }
    }
  }

  #evaluateClipShadowColor(node: SceneNode, time: number, state: ShadowEffect): void {
    const instances = node.clipInstances
    if (instances.length === 0) return
    for (const instance of instances) {
      if (!instance.enabled) continue
      let clip: ClipDefinition
      try {
        clip = this.#clipLookup(instance.clipId)
      } catch {
        continue
      }
      if (clip.duration <= 0) continue
      if (time < instance.startTime) continue
      const u = Math.min(
        Math.max(((time - instance.startTime) * instance.speed) / clip.duration, 0),
        1,
      )
      const anim = clip.shadowChannelAnimation('color' as ShadowProperty)
      if (!anim || anim.length === 0) continue
      const kfValue = this.#evaluateClipShadowColorValue(anim.keyframes(), u)
      state.color = kfValue
    }
  }

  #evaluateClipShadowNumeric(keyframes: readonly Keyframe[], u: number): number {
    if (keyframes.length === 0) return 0
    const first = keyframes[0]
    if (u <= first.time) return first.value as number
    const last = keyframes[keyframes.length - 1]
    if (u >= last.time) return last.value as number
    for (let i = 0; i < keyframes.length - 1; i += 1) {
      const from = keyframes[i]
      const to = keyframes[i + 1]
      if (to.time > from.time && u >= from.time && u < to.time) {
        return evaluateSegment(from, to, u)
      }
    }
    return last.value as number
  }

  #evaluateClipShadowColorValue(keyframes: readonly Keyframe[], u: number): string {
    if (keyframes.length === 0) return '#000000'
    const first = keyframes[0]
    if (u <= first.time) return (first.value as string).toLowerCase()
    const last = keyframes[keyframes.length - 1]
    if (u >= last.time) return (last.value as string).toLowerCase()
    for (let i = 0; i < keyframes.length - 1; i += 1) {
      const from = keyframes[i]
      const to = keyframes[i + 1]
      if (u >= from.time && u < to.time) {
        if (from.interpolation === 'hold') return (from.value as string).toLowerCase()
        const ratio = (u - from.time) / (to.time - from.time)
        return lerpHexColor(from.value as string, to.value as string, ratio)
      }
    }
    return (last.value as string).toLowerCase()
  }

  evaluateMorph(nodeId: string, time: number): number {
    // Legacy scalar accessor — returns coefficient of evaluated morph value (for backward compat/tests).
    // New code should use evaluateMorphValue or evaluateMorphVertices.
    const value = this.evaluateMorphValue(nodeId, time)
    return value ? value.coefficient : 0
  }

  evaluateMorphValue(nodeId: string, time: number): MorphKeyframeValue | null {
    const slide = this.#slideLookup(nodeId)
    const boundedTime = requireFiniteNumber(time, 'Evaluation time')
    const clampedTime = Math.min(Math.max(boundedTime, 0), slide.duration)
    const animation = slide.animation.node(nodeId)
    const keyframes = animation?.morphKeyframes()
    let baseValue: MorphKeyframeValue | null = null
    if (keyframes && keyframes.length > 0) {
      baseValue = this.#evaluateMorphKeyframes(keyframes, clampedTime)
    }
    // Layer enabled clip instances in order that have started (last-wins), name-based resolution
    const node = this.#nodeLookup(nodeId)
    const shapes = (node.components.mesh as { shapes?: readonly Shape[] } | undefined)?.shapes
    const instances = node.clipInstances
    if (instances.length > 0) {
      for (const instance of instances) {
        if (!instance.enabled) continue
        let clip: ClipDefinition
        try {
          clip = this.#clipLookup(instance.clipId)
        } catch {
          continue
        }
        if (clip.duration <= 0) continue
        if (clampedTime < instance.startTime) continue
        const u = Math.min(
          Math.max(((clampedTime - instance.startTime) * instance.speed) / clip.duration, 0),
          1,
        )
        const anim = clip.morphAnimation()
        if (!anim || anim.length === 0) continue
        let clipValue = this.#evaluateMorphClipKeyframes(anim.keyframes(), u, shapes)
        if (clipValue) {
          // Legacy clip scalar (null binding) should inherit base binding if present
          if (
            clipValue.fromShapeId === null &&
            clipValue.toShapeId === null &&
            baseValue &&
            baseValue.fromShapeId !== null &&
            baseValue.toShapeId !== null
          ) {
            clipValue = {
              fromShapeId: baseValue.fromShapeId,
              toShapeId: baseValue.toShapeId,
              coefficient: clipValue.coefficient,
            }
          }
          baseValue = clipValue
        }
      }
    }
    return baseValue
  }

  /**
   * Evaluate morphed rest vertices for a mesh node at given time, with cross-blend
   * between differing shape pairs and name-based clip layering (last-wins).
   * Returns null if node has no mesh.
   */
  evaluateMorphVertices(
    nodeId: string,
    time: number,
    baseVertices: readonly MeshVertex[],
    shapes: readonly Shape[] | undefined,
  ): readonly MeshVertex[] | null {
    const node = this.#nodeLookup(nodeId)
    if (!node.components.mesh) return null
    const slide = this.#slideLookup(nodeId)
    const boundedTime = requireFiniteNumber(time, 'Evaluation time')
    const clampedTime = Math.min(Math.max(boundedTime, 0), slide.duration)
    const animation = slide.animation.node(nodeId)
    const keyframes = animation?.morphKeyframes()
    let morphed: readonly MeshVertex[] | null = null
    if (keyframes && keyframes.length > 0) {
      morphed = this.#evaluateMorphVerticesForTrack(keyframes, clampedTime, baseVertices, shapes)
    }
    // Clip layering last-wins: if any clip contributes, it overrides base vertices entirely
    const instances = node.clipInstances
    if (instances.length > 0) {
      for (const instance of instances) {
        if (!instance.enabled) continue
        let clip: ClipDefinition
        try {
          clip = this.#clipLookup(instance.clipId)
        } catch {
          continue
        }
        if (clip.duration <= 0) continue
        if (clampedTime < instance.startTime) continue
        const u = Math.min(
          Math.max(((clampedTime - instance.startTime) * instance.speed) / clip.duration, 0),
          1,
        )
        const anim = clip.morphAnimation()
        if (!anim || anim.length === 0) continue
        const clipMorphed = this.#evaluateMorphClipVertices(
          anim.keyframes(),
          u,
          baseVertices,
          shapes,
        )
        if (clipMorphed) morphed = clipMorphed
      }
    }
    return morphed
  }

  #evaluateMorphKeyframes(keyframes: readonly Keyframe[], time: number): MorphKeyframeValue | null {
    if (keyframes.length === 0) return null
    const first = keyframes[0]
    const last = keyframes[keyframes.length - 1]
    const firstVal = this.#morphValueOf(first)
    const lastVal = this.#morphValueOf(last)
    if (time <= first.time) return firstVal
    if (time >= last.time) return lastVal
    for (let i = 0; i < keyframes.length - 1; i += 1) {
      const from = keyframes[i]
      const to = keyframes[i + 1]
      if (time >= from.time && time < to.time) {
        if (from.interpolation === 'hold') {
          return this.#morphValueOf(from)
        }
        // linear interpolation of coefficient between differing pairs yields blended coefficient;
        // binding is held from the segment's start (so scalar evaluate remains deterministic)
        const fromVal = this.#morphValueOf(from)
        const toVal = this.#morphValueOf(to)
        const ratio = (time - from.time) / (to.time - from.time)
        // eased progress via segment interpolator on synthetic 0→1
        const u = this.#easedProgress(from, to, time, ratio)
        const coeff = fromVal.coefficient + (toVal.coefficient - fromVal.coefficient) * u
        // Keep binding from the start of segment when bindings differ (cross-blend handled in vertex evaluator)
        return {
          fromShapeId: fromVal.fromShapeId,
          toShapeId: fromVal.toShapeId,
          coefficient: coeff,
        }
      }
    }
    return lastVal
  }

  #evaluateMorphVerticesForTrack(
    keyframes: readonly Keyframe[],
    time: number,
    baseVertices: readonly MeshVertex[],
    shapes: readonly Shape[] | undefined,
  ): readonly MeshVertex[] | null {
    if (keyframes.length === 0) return null
    if (!shapes || shapes.length === 0) return baseVertices
    const first = keyframes[0]
    const last = keyframes[keyframes.length - 1]
    if (time <= first.time) {
      return resolveMorphedVerticesFromKeyframe(baseVertices, shapes, this.#morphValueOf(first))
    }
    if (time >= last.time) {
      return resolveMorphedVerticesFromKeyframe(baseVertices, shapes, this.#morphValueOf(last))
    }
    for (let i = 0; i < keyframes.length - 1; i += 1) {
      const from = keyframes[i]
      const to = keyframes[i + 1]
      if (time >= from.time && time < to.time) {
        if (from.interpolation === 'hold') {
          return resolveMorphedVerticesFromKeyframe(baseVertices, shapes, this.#morphValueOf(from))
        }
        const fromVal = this.#morphValueOf(from)
        const toVal = this.#morphValueOf(to)
        const ratio = (time - from.time) / (to.time - from.time)
        const u = this.#easedProgress(from, to, time, ratio)
        return resolveCrossBlendedVertices(baseVertices, shapes, fromVal, toVal, u)
      }
    }
    return resolveMorphedVerticesFromKeyframe(baseVertices, shapes, this.#morphValueOf(last))
  }

  #morphValueOf(keyframe: Keyframe): MorphKeyframeValue {
    const v = keyframe.value as unknown
    if (typeof v === 'number') {
      // legacy scalar
      return { fromShapeId: null, toShapeId: null, coefficient: v as number }
    }
    if (typeof v === 'object' && v !== null && 'coefficient' in (v as Record<string, unknown>)) {
      const r = v as Record<string, unknown>
      return {
        fromShapeId: (r.fromShapeId as string | null) ?? null,
        toShapeId: (r.toShapeId as string | null) ?? null,
        coefficient: r.coefficient as number,
      }
    }
    // fallback
    return { fromShapeId: null, toShapeId: null, coefficient: 0 }
  }

  #morphClipValueOf(keyframe: Keyframe): MorphClipKeyframeValue {
    const v = keyframe.value as unknown
    if (typeof v === 'number') {
      return { fromShapeName: null, toShapeName: null, coefficient: v as number }
    }
    if (typeof v === 'object' && v !== null && 'coefficient' in (v as Record<string, unknown>)) {
      const r = v as Record<string, unknown>
      // support both clip (name) and node (id) shapes
      if ('fromShapeName' in r || 'toShapeName' in r) {
        return {
          fromShapeName: (r.fromShapeName as string | null) ?? null,
          toShapeName: (r.toShapeName as string | null) ?? null,
          coefficient: r.coefficient as number,
        }
      }
      // if stored as id-based (legacy), interpret as name via id fallback (should be migrated)
      return {
        fromShapeName: (r.fromShapeId as string | null) ?? null,
        toShapeName: (r.toShapeId as string | null) ?? null,
        coefficient: r.coefficient as number,
      }
    }
    return { fromShapeName: null, toShapeName: null, coefficient: 0 }
  }

  #resolveClipValueToNode(
    clipVal: MorphClipKeyframeValue,
    shapes: readonly Shape[] | undefined,
  ): MorphKeyframeValue {
    if (!shapes || shapes.length === 0) {
      return { fromShapeId: null, toShapeId: null, coefficient: clipVal.coefficient }
    }
    const fromShape = clipVal.fromShapeName
      ? shapes.find((s) => s.name === clipVal.fromShapeName)
      : undefined
    const toShape = clipVal.toShapeName
      ? shapes.find((s) => s.name === clipVal.toShapeName)
      : undefined
    // If name not found, keep null to trigger fallback to base; soft-warn is in resolveMorphedVertices
    return {
      fromShapeId: fromShape ? fromShape.id : null,
      toShapeId: toShape ? toShape.id : null,
      coefficient: clipVal.coefficient,
    }
  }

  #evaluateMorphClipKeyframes(
    keyframes: readonly Keyframe[],
    u: number,
    shapes: readonly Shape[] | undefined,
  ): MorphKeyframeValue | null {
    if (keyframes.length === 0) return null
    // clip keyframes time in 0..1 normalized
    const first = keyframes[0]
    const last = keyframes[keyframes.length - 1]
    const firstVal = this.#morphClipValueOf(first)
    // clip Value is MorphClipKeyframeValue already; but we need to resolve to node ids for layering?
    // For evaluateMorphValue we resolve names to ids to produce MorphKeyframeValue
    const resolve = (v: MorphClipKeyframeValue) => this.#resolveClipValueToNode(v, shapes)
    if (u <= first.time) return resolve(firstVal)
    if (u >= last.time) return resolve(this.#morphClipValueOf(last))
    for (let i = 0; i < keyframes.length - 1; i += 1) {
      const from = keyframes[i]
      const to = keyframes[i + 1]
      if (u >= from.time && u < to.time) {
        if (from.interpolation === 'hold') return resolve(this.#morphClipValueOf(from))
        const fromVal = this.#morphClipValueOf(from)
        const toVal = this.#morphClipValueOf(to)
        const ratio = (u - from.time) / (to.time - from.time)
        const eased = this.#easedProgress(from, to, u, ratio)
        const coeff = fromVal.coefficient + (toVal.coefficient - fromVal.coefficient) * eased
        // keep from binding for scalar evaluate
        const blended: MorphClipKeyframeValue = {
          fromShapeName: fromVal.fromShapeName,
          toShapeName: fromVal.toShapeName,
          coefficient: coeff,
        }
        return resolve(blended)
      }
    }
    return resolve(this.#morphClipValueOf(last))
  }

  #evaluateMorphClipVertices(
    keyframes: readonly Keyframe[],
    u: number,
    baseVertices: readonly MeshVertex[],
    shapes: readonly Shape[] | undefined,
  ): readonly MeshVertex[] | null {
    if (keyframes.length === 0) return null
    if (!shapes || shapes.length === 0) return baseVertices
    const first = keyframes[0]
    const last = keyframes[keyframes.length - 1]
    if (u <= first.time) {
      const v = this.#resolveClipValueToNode(this.#morphClipValueOf(first), shapes)
      return resolveMorphedVerticesFromKeyframe(baseVertices, shapes, v)
    }
    if (u >= last.time) {
      const v = this.#resolveClipValueToNode(this.#morphClipValueOf(last), shapes)
      return resolveMorphedVerticesFromKeyframe(baseVertices, shapes, v)
    }
    for (let i = 0; i < keyframes.length - 1; i += 1) {
      const from = keyframes[i]
      const to = keyframes[i + 1]
      if (u >= from.time && u < to.time) {
        if (from.interpolation === 'hold') {
          const v = this.#resolveClipValueToNode(this.#morphClipValueOf(from), shapes)
          return resolveMorphedVerticesFromKeyframe(baseVertices, shapes, v)
        }
        const fromVal = this.#resolveClipValueToNode(this.#morphClipValueOf(from), shapes)
        const toVal = this.#resolveClipValueToNode(this.#morphClipValueOf(to), shapes)
        const ratio = (u - from.time) / (to.time - from.time)
        const eased = this.#easedProgress(from, to, u, ratio)
        return resolveCrossBlendedVertices(baseVertices, shapes, fromVal, toVal, eased)
      }
    }
    const v = this.#resolveClipValueToNode(this.#morphClipValueOf(last), shapes)
    return resolveMorphedVerticesFromKeyframe(baseVertices, shapes, v)
  }

  #easedProgress(from: Keyframe, to: Keyframe, time: number, linearRatio: number): number {
    // Reuse interpolators: evaluateSegment with 0→1 gives eased progress
    if (from.interpolation === 'hold') return 0
    if (from.interpolation === 'linear') return linearRatio
    // Use registry via evaluateSegment on synthetic values
    const synthFrom = { ...from, value: 0 } as Keyframe
    const synthTo = { ...to, value: 1 } as Keyframe
    try {
      const v = evaluateSegment(synthFrom, synthTo, time)
      // clamp progress 0..1 for vertex blend (extrapolation beyond uses 0/1 via hold at ends)
      return Math.max(0, Math.min(1, v))
    } catch {
      return linearRatio
    }
  }

  /**
   * The node's static material overrides overlaid with its material keyframe
   * tracks (later wins for the same key, Spec 07 R29). Continuous kinds
   * interpolate linearly with per-channel clamping where material resolution
   * clamps; discrete kinds hold. Tracks for parameters the material no
   * longer defines are ignored.
   */
  evaluateMaterialOverrides(
    nodeId: string,
    time: number,
    target: EvaluatedMaterialOverridesScratch = evaluatedMaterialOverridesScratch(),
  ): MaterialOverrides {
    const node = this.#nodeLookup(nodeId)
    const slide = this.#slideLookup(nodeId)
    const boundedTime = requireFiniteNumber(time, 'Evaluation time')
    const clampedTime = Math.min(Math.max(boundedTime, 0), slide.duration)
    const animation = slide.animation.node(nodeId)
    const { keys, values } = target
    for (const key of keys) {
      delete values[key]
    }
    keys.length = 0
    const overrides = node.material.overrides
    for (const key of Object.keys(overrides)) {
      keys.push(key)
      values[key] = overrides[key]
    }
    if (animation) {
      for (const parameter of animation.materialTrackParameterKeys()) {
        const kind = this.#parameterKindOf(node, parameter)
        if (kind === undefined) {
          continue
        }
        if (!Object.prototype.hasOwnProperty.call(values, parameter)) {
          keys.push(parameter)
        }
        values[parameter] = evaluateMaterialTrackValue(
          kind,
          parameter,
          animation.materialKeyframes(parameter),
          clampedTime,
        )
      }
    }

    // Apply clip-driven material parameter overrides (after standard channels,
    // per Spec 07 R29 material parameter channels)
    this.#applyClipMaterialOverrides(node, clampedTime, target)

    return values
  }

  /**
   * Evaluate data label values for a node at the given time.
   * Returns a map from label to evaluated numeric value.
   */
  evaluateDataLabels(nodeId: string, time: number): Map<string, number> {
    const result = new Map<string, number>()
    const slide = this.#slideLookup(nodeId)
    const boundedTime = requireFiniteNumber(time, 'Evaluation time')
    const clampedTime = Math.min(Math.max(boundedTime, 0), slide.duration)
    const animation = slide.animation.node(nodeId)

    if (animation) {
      for (const label of animation.dataLabelTrackLabels()) {
        const keyframes = animation.dataLabelKeyframes(label)
        const value = this.#evaluate(keyframes, clampedTime, 0)
        result.set(label, value)
      }
    }

    return result
  }

  evaluateCircle(nodeId: string, time: number): EvaluatedCircleState | null {
    const node = this.#nodeLookup(nodeId)
    const circle = node.components.circle
    if (!circle) {
      return null
    }
    const slide = this.#slideLookup(nodeId)
    const boundedTime = requireFiniteNumber(time, 'Evaluation time')
    const clampedTime = Math.min(Math.max(boundedTime, 0), slide.duration)
    const animation = slide.animation.node(nodeId)
    const radius = this.#evaluate(animation?.circleKeyframes('radius'), clampedTime, circle.radius)
    const startAngle = this.#evaluate(
      animation?.circleKeyframes('startAngle'),
      clampedTime,
      circle.startAngle,
    )
    const endAngle = this.#evaluate(
      animation?.circleKeyframes('endAngle'),
      clampedTime,
      circle.endAngle,
    )
    const segmentsFallback = (() => {
      const arc = (((endAngle - startAngle) % 360) + 360) % 360
      const effectiveArc = arc === 0 ? 360 : arc
      return circle.segments ?? circleSegmentsForArc(effectiveArc)
    })()
    const segmentsRaw = this.#evaluate(
      animation?.circleKeyframes('segments'),
      clampedTime,
      segmentsFallback,
    )
    const segments = Math.max(3, Math.min(256, Math.round(segmentsRaw)))
    return { radius, startAngle, endAngle, segments }
  }

  evaluateTable(nodeId: string, time: number): EvaluatedTableState | null {
    const node = this.#nodeLookup(nodeId)
    const hasTable = Boolean(node.components.table || node.components.tableCell)
    if (!hasTable) {
      return null
    }
    const slide = this.#slideLookup(nodeId)
    const boundedTime = requireFiniteNumber(time, 'Evaluation time')
    const clampedTime = Math.min(Math.max(boundedTime, 0), slide.duration)
    const animation = slide.animation.node(nodeId)
    // Resolve base values with inheritance for padding/borderRadius
    let baseBorderRadius = 0
    let basePadding = 0
    if (node.components.table) {
      baseBorderRadius = node.components.table.borderRadius ?? 0
      basePadding = node.components.table.padding ?? 0
    } else if (node.components.tableCell) {
      baseBorderRadius = node.components.tableCell.borderRadius ?? 0
      basePadding = node.components.tableCell.padding ?? 0
      if (node.components.tableCell.borderRadius === undefined) {
        const owning = this.#findOwningTable(node)
        if (owning?.components.table?.borderRadius !== undefined) {
          baseBorderRadius = owning.components.table.borderRadius
        }
      }
      if (node.components.tableCell.padding === undefined) {
        const owning = this.#findOwningTable(node)
        if (owning?.components.table?.padding !== undefined) {
          basePadding = owning.components.table.padding
        }
      }
    }
    const borderRadius = this.#evaluate(
      animation?.tableKeyframes('borderRadius'),
      clampedTime,
      baseBorderRadius,
    )
    const padding = this.#evaluate(animation?.tableKeyframes('padding'), clampedTime, basePadding)
    return { borderRadius: Math.max(0, borderRadius), padding: Math.max(0, padding) }
  }

  #findOwningTable(node: SceneNode): SceneNode | null {
    for (let parent: SceneNode | null = node.parent; parent; parent = parent.parent) {
      if (parent.components.table) return parent
    }
    return null
  }

  #applyClipInstances(node: SceneNode, time: number, state: EvaluatedNodeScratch): void {
    const instances = node.clipInstances
    if (instances.length === 0) {
      return
    }

    const isCamera = node.components.camera !== undefined

    for (const instance of instances) {
      if (!instance.enabled) {
        continue
      }

      let clip: ClipDefinition
      try {
        clip = this.#clipLookup(instance.clipId)
      } catch {
        continue
      }

      if (clip.duration <= 0) {
        continue
      }

      // Clips that haven't started yet must not contribute — otherwise their
      // first-keyframe value overrides earlier clips on the same channel.
      if (time < instance.startTime) {
        continue
      }

      const u = Math.min(
        Math.max(((time - instance.startTime) * instance.speed) / clip.duration, 0),
        1,
      )

      for (const channelDef of clip.channels) {
        const channel = channelDef.property

        // Camera nodes cannot animate rotation via clips (Spec 07 R17)
        if (isCamera && channel === 'rotation') {
          continue
        }

        const channelAnim = clip.channelAnimation(channel)
        if (!channelAnim || channelAnim.length === 0) {
          continue
        }

        const kfValue = this.#evaluateClipChannel(channelAnim.keyframes(), u)

        let output: number
        if (channelDef.paramKey) {
          const paramValue =
            instance.paramOverrides[channelDef.paramKey] ??
            clip.getParam(channelDef.paramKey)?.default ??
            1
          const base = this.#getChannelValue(state.transform, state.opacity, channel)
          if (channelDef.linkMode === 'offset') {
            output = base + paramValue * kfValue
          } else {
            output = base * (paramValue * kfValue)
          }
        } else {
          output = kfValue
        }

        this.#setChannelValue(state, channel, output)
      }
    }
  }

  #getChannelValue(
    transform: MutableTransform,
    opacity: number,
    channel: AnimationProperty,
  ): number {
    const key = CHANNEL_TO_TRANSFORM_KEY[channel]
    if (key === 'opacity') {
      return opacity
    }
    return (transform as unknown as Record<string, number>)[key] ?? 0
  }

  #setChannelValue(state: EvaluatedNodeScratch, channel: AnimationProperty, value: number): void {
    const key = CHANNEL_TO_TRANSFORM_KEY[channel]
    if (key === 'opacity') {
      state.opacity = value
    } else {
      ;(state.transform as unknown as Record<string, number>)[key] = value
    }
  }

  /**
   * Apply clip-driven material parameter overrides to the scratch target.
   * Called after standard material tracks are evaluated so clips layer on top.
   * Uses the same gain/offset composition model as standard channels.
   */
  #applyClipMaterialOverrides(
    node: SceneNode,
    time: number,
    target: EvaluatedMaterialOverridesScratch,
  ): void {
    const instances = node.clipInstances
    if (instances.length === 0) {
      return
    }

    for (const instance of instances) {
      if (!instance.enabled) {
        continue
      }

      let clip: ClipDefinition
      try {
        clip = this.#clipLookup(instance.clipId)
      } catch {
        continue
      }

      if (clip.duration <= 0) {
        continue
      }

      if (time < instance.startTime) {
        continue
      }

      const u = Math.min(
        Math.max(((time - instance.startTime) * instance.speed) / clip.duration, 0),
        1,
      )

      for (const channelDef of clip.channels) {
        if (!channelDef.materialParameter) {
          continue
        }

        const materialParamKey = channelDef.materialParameter
        const channelAnim = clip.materialChannelAnimation(materialParamKey)
        if (!channelAnim || channelAnim.length === 0) {
          continue
        }

        const kind = this.#parameterKindOf(node, materialParamKey)
        if (kind === undefined) {
          continue
        }

        const kfValue = this.#evaluateClipChannel(channelAnim.keyframes(), u)

        let output: number
        if (channelDef.paramKey) {
          const paramValue =
            instance.paramOverrides[channelDef.paramKey] ??
            clip.getParam(channelDef.paramKey)?.default ??
            1
          const base =
            typeof target.values[materialParamKey] === 'number'
              ? (target.values[materialParamKey] as number)
              : 0
          if (channelDef.linkMode === 'offset') {
            output = base + paramValue * kfValue
          } else {
            output = base * (paramValue * kfValue)
          }
        } else {
          output = kfValue
        }

        if (!Object.prototype.hasOwnProperty.call(target.values, materialParamKey)) {
          target.keys.push(materialParamKey)
        }
        target.values[materialParamKey] = output
      }
    }
  }

  #evaluateClipChannel(keyframes: readonly Keyframe[], u: number): number {
    if (keyframes.length === 0) {
      return 0
    }
    const first = keyframes[0]
    if (u <= first.time) {
      return first.value as number
    }
    const last = keyframes[keyframes.length - 1]
    if (u >= last.time) {
      return last.value as number
    }
    for (let i = 0; i < keyframes.length - 1; i += 1) {
      const from = keyframes[i]
      const to = keyframes[i + 1]
      if (to.time > from.time && u >= from.time && u < to.time) {
        return evaluateSegment(from, to, u)
      }
    }
    return last.value as number
  }

  #evaluate(keyframes: readonly Keyframe[] | undefined, time: number, fallback: number): number {
    if (!keyframes || keyframes.length === 0) {
      return fallback
    }
    const first = keyframes[0]
    if (time <= first.time) {
      return first.value as number
    }
    const last = keyframes[keyframes.length - 1]
    if (time >= last.time) {
      return last.value as number
    }
    for (let i = 0; i < keyframes.length - 1; i += 1) {
      const from = keyframes[i]
      const to = keyframes[i + 1]
      if (to.time > from.time && time >= from.time && time < to.time) {
        return evaluateSegment(from, to, time)
      }
    }
    return last.value as number
  }
}
