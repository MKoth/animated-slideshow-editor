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
import { isParametricInterpolation } from './keyframe'
import { circleSegmentsForArc } from './circleComponent'
import type { MeshVertex } from './mesh'
import type { Shape } from './shape'
import { resolveClipShapeByNameAndPath } from './shape'
import type { ShapeCategory } from './shapeCategory'
import { resolveCrossBlendedVertices, resolveMorphedVerticesFromKeyframe } from './shape'
import type { MorphKeyframeValue, MorphClipKeyframeValue } from './shape'
import type { SymmetryKeyframeValue } from './symmetry'
import { resolveSymmetrizedVertices } from './symmetry'
import { CONTROL_INTERVAL_EPSILON, evaluateControlTrack, evaluateHostWithBlends } from './control'
import { groupCollectionBlocks } from './control'
import type { Control, ControlGroup, ControlBinding } from './control'
import type { ShadowEffect, ShadowProperty } from './shadowEffect'
import type { NodeAnimation } from './nodeAnimation'
import {
  SHADOW_PROPERTIES,
  SHADOW_LIGHT_PROPERTIES,
  SHADOW_SHARED_PROPERTIES,
  lerpHexColor,
  deriveShadowProjection,
  isAutoShadowEffect,
} from './shadowEffect'

function isParametricKeyframes(keyframes: readonly Keyframe[]): boolean {
  for (const kf of keyframes) if (isParametricInterpolation(kf.interpolation)) return true
  return false
}

function hasEnabledKeyframes(keyframes: readonly Keyframe[]): boolean {
  for (const kf of keyframes) if (!(kf as unknown as { disabled?: boolean }).disabled) return true
  return false
}

function enabledKeyframes(keyframes: readonly Keyframe[]): readonly Keyframe[] {
  // Session-only disabled keyframes are skipped for evaluation (grey preview)
  // Keep sorted order; caller handles empty fallback.
  let hasDisabled = false
  for (const kf of keyframes)
    if ((kf as unknown as { disabled?: boolean }).disabled) {
      hasDisabled = true
      break
    }
  if (!hasDisabled) return keyframes
  return keyframes.filter((kf) => !(kf as unknown as { disabled?: boolean }).disabled)
}

function effectiveUForClip(
  clip: ClipDefinition,
  keyframes: readonly Keyframe[],
  u: number,
): number {
  if (
    (clip as unknown as { isReversed?: boolean }).isReversed &&
    isParametricKeyframes(keyframes)
  ) {
    return 1 - u
  }
  return u
}

const CLIP_EPS = 1e-9
const MIN_ACTIVE_SPEED = 1e-9

function isClipInstanceActive(
  instance: { startTime: number; speed: number },
  clip: { duration: number },
  time: number,
): boolean {
  if (clip.duration <= 0) return false
  if (time < instance.startTime - CLIP_EPS) return false
  if (instance.speed <= MIN_ACTIVE_SPEED) return true
  const end = instance.startTime + clip.duration / instance.speed
  return time <= end + CLIP_EPS
}

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

/**
 * Structural view of a ClipCollection for control evaluation: resolve the
 * member clip driving one semantic name, or undefined when unbound.
 * Kept structural (instead of importing ClipCollection) so tests can stub it.
 */
export interface ControlCollectionResolution {
  getBinding(semanticName: string): string | undefined
}

/** Lookup for live-linked control collection blocks; null = missing (gap). */
export type ControlCollectionLookup = (collectionId: string) => ControlCollectionResolution | null

export class AnimationEvaluator {
  readonly #nodeLookup: (nodeId: string) => SceneNode
  readonly #slideLookup: (nodeId: string) => Slide
  readonly #parameterKindOf: MaterialParameterKindOf
  readonly #clipLookup: (clipId: string) => ClipDefinition
  readonly #collectionLookup: ControlCollectionLookup

  constructor(
    nodeLookup: (nodeId: string) => SceneNode,
    slideLookup: (nodeId: string) => Slide,
    parameterKindOf: MaterialParameterKindOf,
    clipLookup: (clipId: string) => ClipDefinition,
    collectionLookup?: ControlCollectionLookup,
  ) {
    this.#nodeLookup = nodeLookup
    this.#slideLookup = slideLookup
    this.#parameterKindOf = parameterKindOf
    this.#clipLookup = clipLookup
    this.#collectionLookup = collectionLookup ?? (() => null)
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
    this.#applyControls(node, clampedTime, state)

    return state
  }

  evaluateVisible(nodeId: string, _time: number): boolean {
    void _time
    const node = this.#nodeLookup(nodeId)
    // Visible is no longer animatable per user request — always use static node.visible.
    // Previous visible keyframes are ignored to prevent hidden objects from disappearing
    // when the UI no longer shows the visible subtrack.
    return node.visible
  }

  evaluateZIndex(nodeId: string, time: number): number {
    const node = this.#nodeLookup(nodeId)
    const slide = this.#slideLookup(nodeId)
    const boundedTime = requireFiniteNumber(time, 'Evaluation time')
    const clampedTime = Math.min(Math.max(boundedTime, 0), slide.duration)
    const animation = slide.animation.node(nodeId)
    const raw = animation?.zIndexKeyframes()
    const keyframes = raw ? enabledKeyframes(raw) : undefined
    let baseValue: number | null = null
    if (keyframes && keyframes.length > 0) {
      const first = keyframes[0]
      if (clampedTime <= first.time) {
        baseValue = Math.trunc(first.value as number)
      } else {
        const last = keyframes[keyframes.length - 1]
        if (clampedTime >= last.time) {
          baseValue = Math.trunc(last.value as number)
        } else {
          for (let i = 0; i < keyframes.length - 1; i += 1) {
            const from = keyframes[i]
            const to = keyframes[i + 1]
            if (clampedTime >= from.time && clampedTime < to.time) {
              if (from.interpolation !== 'hold') {
                throw new Error('Z-Index track only supports hold interpolation')
              }
              baseValue = Math.trunc(from.value as number)
              break
            }
          }
          baseValue ??= Math.trunc(last.value as number)
        }
      }
    }
    // Layer enabled clip instances in order that have started (last-wins)
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
        if (!isClipInstanceActive(instance, clip, clampedTime)) continue
        const anim = clip.zIndexAnimation()
        if (!anim || anim.length === 0) continue
        const u = Math.min(
          Math.max(((clampedTime - instance.startTime) * instance.speed) / clip.duration, 0),
          1,
        )
        const effU = effectiveUForClip(clip, anim.keyframes(), u)
        baseValue = this.#evaluateClipZIndex(anim.keyframes(), effU)
      }
    }
    // Controls step zIndex like a time point: nearest hosts first so ancestors
    // win (same order as #applyControls); per-group last-wins within a
    // control; discrete blend threshold across groups (no interpolation).
    if (node.semanticName !== undefined) {
      const hosts: SceneNode[] = []
      for (let host = node.parent; host; host = host.parent) {
        if (host.controlSet) hosts.push(host)
      }
      for (const host of hosts) {
        const hostAnim = this.#slideLookup(node.id).animation.node(host.id)
        for (const control of host.controlSet?.controls ?? []) {
          const dormant = this.#isControlDormant(hostAnim, control)
          const { u: rawU, blends: blendFactors } = this.#evaluateHostWithBlends(
            control,
            hostAnim,
            clampedTime,
          )
          const groupClips = this.#getGroupClips(node.semanticName, control, rawU)
          let stepped: number | undefined = undefined
          for (let gi = 0; gi < groupClips.length; gi++) {
            const blend = gi === 0 ? 0 : (blendFactors[gi - 1] ?? 0)
            const entry = groupClips[gi]
            if (!entry) continue
            const anim = entry.clip.zIndexAnimation()
            if (!anim || anim.length === 0) continue
            const enabled = enabledKeyframes(anim.keyframes())
            if (enabled.length === 0) continue
            const effU = effectiveUForClip(entry.clip, enabled, entry.uPrime)
            const cur = this.#evaluateClipZIndex(enabled, effU)
            if (stepped === undefined) {
              stepped = gi === 0 ? cur : blend < 0.5 ? (baseValue ?? node.zIndex) : cur
            } else if (blend >= 0.5) {
              stepped = cur
            }
          }
          if (stepped === undefined) continue
          if (
            dormant &&
            this.#nodeTimeDrivesChannel(
              node,
              clampedTime,
              (animation) => hasEnabledKeyframes(animation.zIndexKeyframes()),
              (clip) => {
                const zIndexAnim = clip.zIndexAnimation()
                return !!zIndexAnim && hasEnabledKeyframes(zIndexAnim.keyframes())
              },
            )
          ) {
            continue
          }
          baseValue = stepped
        }
      }
    }
    return baseValue ?? node.zIndex
  }

  #evaluateClipZIndex(keyframes: readonly Keyframe[], u: number): number {
    if (keyframes.length === 0) return 0
    const first = keyframes[0]
    if (u <= first.time) return Math.trunc(first.value as number)
    const last = keyframes[keyframes.length - 1]
    if (u >= last.time) return Math.trunc(last.value as number)
    for (let i = 0; i < keyframes.length - 1; i += 1) {
      const from = keyframes[i]
      const to = keyframes[i + 1]
      if (u >= from.time && u < to.time) {
        if (from.interpolation !== 'hold') {
          throw new Error('Z-Index clip track only supports hold interpolation')
        }
        return Math.trunc(from.value as number)
      }
    }
    return Math.trunc(last.value as number)
  }

  evaluateShadow(
    nodeId: string,
    time: number,
    bounds?: { w: number; h: number },
  ): ShadowEffect | null {
    const node = this.#nodeLookup(nodeId)
    const slide = this.#slideLookup(nodeId)
    if (!isGroupNode(node) || !node.shadowEffect) return null
    const boundedTime = requireFiniteNumber(time, 'Evaluation time')
    const clampedTime = Math.min(Math.max(boundedTime, 0), slide.duration)
    const animation = slide.animation.node(nodeId)
    const base = node.shadowEffect
    const result: ShadowEffect = { ...base }
    const isAuto = isAutoShadowEffect(base)
    const effectiveBounds = bounds ?? { w: 0, h: 0 }
    // Evaluate shadow tracks after visible (so we can compute shadowAlpha), before clip layering
    // When auto, evaluate LIGHT + SHARED; when manual, evaluate RAW + SHARED (via SHADOW_PROPERTIES original 10).
    // Since SHADOW_PROPERTIES now includes LIGHT (13), we filter to maintain behavior.
    if (isAuto) {
      for (const prop of SHADOW_LIGHT_PROPERTIES) {
        const keyframes = animation?.shadowKeyframes(prop as unknown as ShadowProperty)
        if (!keyframes || keyframes.length === 0) continue
        const fallback = (base as unknown as Record<string, unknown>)[prop] as number
        const def = prop === 'lightAzimuth' ? 135 : prop === 'lightElevation' ? 45 : 28
        const fb = Number.isFinite(fallback) ? fallback : def
        const evaluated = this.#evaluateShadowNumeric(keyframes, clampedTime, fb)
        ;(result as unknown as Record<string, unknown>)[prop] = evaluated
      }
      for (const prop of SHADOW_SHARED_PROPERTIES) {
        const keyframes = animation?.shadowKeyframes(prop as ShadowProperty)
        if (!keyframes || keyframes.length === 0) continue
        if (prop === 'color') {
          result.color = this.#evaluateShadowColor(keyframes, clampedTime, base.color)
        } else if (prop === 'opacity') {
          const fallback = base.opacity
          const evaluated = this.#evaluateShadowNumeric(keyframes, clampedTime, fallback)
          ;(result as unknown as Record<string, unknown>)[prop] = evaluated
        } else {
          // blur
          const fallback = base.blur
          const evaluated = this.#evaluateShadowNumeric(keyframes, clampedTime, fallback)
          ;(result as unknown as Record<string, unknown>)[prop] = evaluated
        }
      }
      // Derive 7 DOF from anchor+light before opacity & clips
      const anchor = (result.anchor ?? 'bottom') as import('./shadowEffect').ShadowAnchor
      const azimuth = result.lightAzimuth ?? 135
      const elevation = result.lightElevation ?? 45
      const distance = result.lightDistance ?? 28
      const derived = deriveShadowProjection(
        effectiveBounds,
        anchor,
        azimuth,
        elevation,
        distance,
        {
          x: result.anchorOffsetX,
          y: result.anchorOffsetY,
        },
        result.mirrorX,
      )
      result.offsetX = derived.offsetX
      result.offsetY = derived.offsetY
      result.scaleX = derived.scaleX
      result.scaleY = derived.scaleY
      result.skewX = derived.skewX
      result.skewY = derived.skewY
      result.rotation = derived.rotation
    } else {
      for (const prop of SHADOW_PROPERTIES) {
        // Skip light when manual (they are part of SHADOW_PROPERTIES after extension)
        if ((SHADOW_LIGHT_PROPERTIES as readonly string[]).includes(prop)) continue
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
    this.#applyControlShadowLayers(node, clampedTime, result)
    // Spec 305: when auto, light clip params have been layered into result.light*; re-derive so light clips drive projection (last-wins)
    if (isAuto) {
      const anchor = (result.anchor ?? 'bottom') as import('./shadowEffect').ShadowAnchor
      const az = result.lightAzimuth ?? 135
      const el = result.lightElevation ?? 45
      const dist = result.lightDistance ?? 28
      const derived2 = deriveShadowProjection(
        effectiveBounds,
        anchor,
        az,
        el,
        dist,
        {
          x: result.anchorOffsetX,
          y: result.anchorOffsetY,
        },
        result.mirrorX,
      )
      result.offsetX = derived2.offsetX
      result.offsetY = derived2.offsetY
      result.scaleX = derived2.scaleX
      result.scaleY = derived2.scaleY
      result.skewX = derived2.skewX
      result.skewY = derived2.skewY
      result.rotation = derived2.rotation
    }
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
    const enabled = enabledKeyframes(keyframes)
    if (enabled.length === 0) return fallback
    const first = enabled[0]
    if (time <= first.time) return first.value as number
    const last = enabled[enabled.length - 1]
    if (time >= last.time) return last.value as number
    for (let i = 0; i < enabled.length - 1; i += 1) {
      const from = enabled[i]
      const to = enabled[i + 1]
      if (to.time > from.time && time >= from.time && time < to.time) {
        return evaluateSegment(from, to, time)
      }
    }
    return last.value as number
  }

  #evaluateShadowColor(keyframes: readonly Keyframe[], time: number, fallback: string): string {
    if (!keyframes || keyframes.length === 0) return fallback
    const enabled = enabledKeyframes(keyframes)
    if (enabled.length === 0) return fallback
    const first = enabled[0]
    if (time <= first.time) return (first.value as string).toLowerCase()
    const last = enabled[enabled.length - 1]
    if (time >= last.time) return (last.value as string).toLowerCase()
    for (let i = 0; i < enabled.length - 1; i += 1) {
      const from = enabled[i]
      const to = enabled[i + 1]
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
      if (!isClipInstanceActive(instance, clip, time)) continue
      const u = Math.min(
        Math.max(((time - instance.startTime) * instance.speed) / clip.duration, 0),
        1,
      )
      for (const prop of SHADOW_PROPERTIES) {
        if (prop === 'color') continue
        const anim = clip.shadowChannelAnimation(prop as ShadowProperty)
        if (!anim || anim.length === 0) continue
        const effU = effectiveUForClip(clip, anim.keyframes(), u)
        const kfValue = this.#evaluateClipShadowNumeric(anim.keyframes(), effU)
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
      if (!isClipInstanceActive(instance, clip, time)) continue
      const u = Math.min(
        Math.max(((time - instance.startTime) * instance.speed) / clip.duration, 0),
        1,
      )
      const anim = clip.shadowChannelAnimation('color' as ShadowProperty)
      if (!anim || anim.length === 0) continue
      const effU = effectiveUForClip(clip, anim.keyframes(), u)
      const kfValue = this.#evaluateClipShadowColorValue(anim.keyframes(), effU)
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
    const categories = (
      node.components.mesh as { shapeCategories?: readonly ShapeCategory[] } | undefined
    )?.shapeCategories
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
        if (!isClipInstanceActive(instance, clip, clampedTime)) continue
        const u = Math.min(
          Math.max(((clampedTime - instance.startTime) * instance.speed) / clip.duration, 0),
          1,
        )
        const anim = clip.morphAnimation()
        if (!anim || anim.length === 0) continue
        const effU = effectiveUForClip(clip, anim.keyframes(), u)
        let clipValue = this.#evaluateMorphClipKeyframes(anim.keyframes(), effU, shapes, categories)
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
    // Blend-aware control layering with per-property absent pass-through and per-vertex morph semantics.
    // For scalar morph value we blend coefficient numeric and hold shape ids with threshold.
    if (node.semanticName !== undefined) {
      const hosts: SceneNode[] = []
      for (let host = node.parent; host; host = host.parent) if (host.controlSet) hosts.push(host)
      for (const host of hosts) {
        const hostAnim = this.#slideLookup(node.id).animation.node(host.id)
        for (const control of host.controlSet?.controls ?? []) {
          const dormant = this.#isControlDormant(hostAnim, control)
          const { u: rawU, blends: blendFactors } = this.#evaluateHostWithBlends(
            control,
            hostAnim,
            clampedTime,
          )
          const groupClips = this.#getGroupClips(node.semanticName, control, rawU)
          if (groupClips.length === 0) continue
          const controlBaseMorph = baseValue
          let blended: MorphKeyframeValue | null = null
          let hasBlended = false
          for (let gi = 0; gi < groupClips.length; gi++) {
            const blend = gi === 0 ? 0 : (blendFactors[gi - 1] ?? 0)
            if (gi > 0 && blend === 0) continue
            const entry = groupClips[gi]
            let cur: MorphKeyframeValue | null = null
            if (entry) {
              const anim = entry.clip.morphAnimation()
              const enabled = enabledKeyframes(anim.keyframes())
              if (enabled.length > 0) {
                const effU = effectiveUForClip(entry.clip, enabled, entry.uPrime)
                cur = this.#evaluateMorphClipKeyframes(enabled, effU, shapes, categories)
              }
            }
            if (!hasBlended && cur === null) {
              // gap
            } else if (!hasBlended) {
              if (gi === 0) {
                blended = cur
                hasBlended = cur !== null
              } else if (cur !== null) {
                if (controlBaseMorph) {
                  const coeff =
                    controlBaseMorph.coefficient +
                    (cur.coefficient - controlBaseMorph.coefficient) * blend
                  const fromId = blend < 0.5 ? controlBaseMorph.fromShapeId : cur.fromShapeId
                  const toId = blend < 0.5 ? controlBaseMorph.toShapeId : cur.toShapeId
                  blended = { fromShapeId: fromId, toShapeId: toId, coefficient: coeff }
                } else blended = cur
                hasBlended = true
              }
            } else if (cur === null) {
              // keep blended verbatim
            } else {
              // numeric lerp coefficient, discrete hold for ids
              const coeff = blended!.coefficient + (cur.coefficient - blended!.coefficient) * blend
              // For shape ids, threshold pick
              const fromId = blend < 0.5 ? blended!.fromShapeId : cur.fromShapeId
              const toId = blend < 0.5 ? blended!.toShapeId : cur.toShapeId
              blended = { fromShapeId: fromId, toShapeId: toId, coefficient: coeff }
            }
          }
          if (!hasBlended || !blended) continue
          if (
            dormant &&
            this.#nodeTimeDrivesChannel(
              node,
              clampedTime,
              (animation) => hasEnabledKeyframes(animation.morphKeyframes()),
              (clip) => {
                const morphAnim = clip.morphAnimation()
                return !!morphAnim && hasEnabledKeyframes(morphAnim.keyframes())
              },
            )
          ) {
            continue
          }
          baseValue = blended
        }
      }
    }
    return baseValue
  }

  /**
   * Evaluate morphed rest vertices for a mesh node at given time, with cross-blend
   * between differing shape pairs and name-based clip layering (last-wins), plus blend-aware
   * per-vertex absolute lerpVertex folding.
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
    const categories = (
      node.components.mesh as { shapeCategories?: readonly ShapeCategory[] } | undefined
    )?.shapeCategories
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
        if (!isClipInstanceActive(instance, clip, clampedTime)) continue
        const u = Math.min(
          Math.max(((clampedTime - instance.startTime) * instance.speed) / clip.duration, 0),
          1,
        )
        const anim = clip.morphAnimation()
        if (!anim || anim.length === 0) continue
        const effU2 = effectiveUForClip(clip, anim.keyframes(), u)
        const clipMorphed = this.#evaluateMorphClipVertices(
          anim.keyframes(),
          effU2,
          baseVertices,
          shapes,
          categories,
        )
        if (clipMorphed) morphed = clipMorphed
      }
    }
    // Blend-aware per-vertex absolute folding via lerpVertex on rest vertices before mesh deformation.
    if (node.semanticName !== undefined) {
      const hosts: SceneNode[] = []
      for (let host = node.parent; host; host = host.parent) if (host.controlSet) hosts.push(host)
      for (const host of hosts) {
        const hostAnim = this.#slideLookup(node.id).animation.node(host.id)
        for (const control of host.controlSet?.controls ?? []) {
          const dormant = this.#isControlDormant(hostAnim, control)
          const { u: rawU, blends: blendFactors } = this.#evaluateHostWithBlends(
            control,
            hostAnim,
            clampedTime,
          )
          const groupClips = this.#getGroupClips(node.semanticName, control, rawU)
          if (groupClips.length === 0) continue
          // Compute per-group vertices (null if no morph in group)
          const groupVerts: (readonly MeshVertex[] | null)[] = []
          for (const entry of groupClips) {
            if (!entry) {
              groupVerts.push(null)
              continue
            }
            const anim = entry.clip.morphAnimation()
            const enabled = enabledKeyframes(anim.keyframes())
            if (enabled.length === 0) {
              groupVerts.push(null)
              continue
            }
            const effU = effectiveUForClip(entry.clip, enabled, entry.uPrime)
            const verts = this.#evaluateMorphClipVertices(
              enabled,
              effU,
              baseVertices,
              shapes,
              categories,
            )
            // verts may be baseVertices fallback; treat as contribution (not null) per spec's soft-warn fallback
            // If entry had no morph track, we already pushed null; otherwise verts is at least base.
            groupVerts.push(verts)
          }
          // Fold with per-vertex lerpVertex, strict isolate + lerp from base
          let acc: readonly MeshVertex[] | null = null
          for (let gi = 0; gi < groupVerts.length; gi++) {
            const blend = gi === 0 ? 0 : (blendFactors[gi - 1] ?? 0)
            if (gi > 0 && blend === 0) continue
            const cur = groupVerts[gi]
            if (acc === null && cur === null) {
              // gap
            } else if (acc === null) {
              if (gi === 0) acc = cur
              else if (cur !== null) {
                const out: MeshVertex[] = []
                for (let i = 0; i < baseVertices.length; i++) {
                  const a = baseVertices[i]!
                  const b = cur[i] ?? baseVertices[i]!
                  out.push({ x: a.x + (b.x - a.x) * blend, y: a.y + (b.y - a.y) * blend })
                }
                acc = out
              }
            } else if (cur === null) {
              // keep acc verbatim
            } else {
              // blend already computed above
              if (blend <= 0) {
                // keep acc
              } else if (blend >= 1) {
                acc = cur
              } else {
                const out: MeshVertex[] = []
                for (let i = 0; i < baseVertices.length; i++) {
                  const a = acc[i] ?? baseVertices[i]
                  const b = cur[i] ?? baseVertices[i]
                  const v = a.x + (b.x - a.x) * blend
                  const w = a.y + (b.y - a.y) * blend
                  out.push({ x: v, y: w })
                }
                acc = out
              }
            }
          }
          if (acc === null) continue
          if (
            dormant &&
            this.#nodeTimeDrivesChannel(
              node,
              clampedTime,
              (animation) => hasEnabledKeyframes(animation.morphKeyframes()),
              (clip) => {
                const morphAnim = clip.morphAnimation()
                return !!morphAnim && hasEnabledKeyframes(morphAnim.keyframes())
              },
            )
          ) {
            continue
          }
          morphed = acc
        }
      }
    }
    return morphed
  }

  evaluateSymmetryValue(nodeId: string, time: number): SymmetryKeyframeValue | null {
    const slide = this.#slideLookup(nodeId)
    const boundedTime = requireFiniteNumber(time, 'Evaluation time')
    const clampedTime = Math.min(Math.max(boundedTime, 0), slide.duration)
    const animation = slide.animation.node(nodeId)
    const keyframes = animation?.symmetryKeyframes()
    let value =
      keyframes && keyframes.length > 0
        ? this.#evaluateSymmetryKeyframes(keyframes, clampedTime)
        : null
    const node = this.#nodeLookup(nodeId)
    // Layer enabled timeline clip instances in order (last-wins), like every
    // other channel — without this, symmetry stored in a placed clip never
    // evaluates (applying a symmetry clip would silently do nothing).
    for (const instance of node.clipInstances) {
      if (!instance.enabled) continue
      let clip: ClipDefinition
      try {
        clip = this.#clipLookup(instance.clipId)
      } catch {
        continue
      }
      if (!isClipInstanceActive(instance, clip, clampedTime)) continue
      const clipKeyframes = enabledKeyframes(clip.getSymmetryKeyframes())
      if (clipKeyframes.length === 0) continue
      const u = Math.min(
        Math.max(((clampedTime - instance.startTime) * instance.speed) / clip.duration, 0),
        1,
      )
      value = this.#evaluateSymmetryKeyframes(
        clipKeyframes,
        effectiveUForClip(clip, clipKeyframes, u),
      )
    }
    if (node.semanticName !== undefined) {
      const hosts: SceneNode[] = []
      for (let host = node.parent; host; host = host.parent) if (host.controlSet) hosts.push(host)
      for (const host of hosts) {
        const hostAnim = this.#slideLookup(node.id).animation.node(host.id)
        for (const control of host.controlSet?.controls ?? []) {
          const dormant = this.#isControlDormant(hostAnim, control)
          const { u: rawU, blends: blendFactors } = this.#evaluateHostWithBlends(
            control,
            hostAnim,
            clampedTime,
          )
          const groupClips = this.#getGroupClips(node.semanticName, control, rawU)
          if (groupClips.length === 0) continue
          const controlBaseSym = value
          let blended: SymmetryKeyframeValue | null = null
          let hasBlended = false
          for (let gi = 0; gi < groupClips.length; gi++) {
            const blend = gi === 0 ? 0 : (blendFactors[gi - 1] ?? 0)
            if (gi > 0 && blend === 0) continue
            const entry = groupClips[gi]
            let cur: SymmetryKeyframeValue | null = null
            if (entry) {
              const enabled = enabledKeyframes(entry.clip.getSymmetryKeyframes())
              if (enabled.length > 0)
                cur = this.#evaluateSymmetryKeyframes(
                  enabled,
                  effectiveUForClip(entry.clip, enabled, entry.uPrime),
                )
            }
            if (!hasBlended && cur === null) {
              // gap
            } else if (!hasBlended) {
              if (gi === 0) {
                blended = cur
                hasBlended = cur !== null
              } else if (cur !== null) {
                if (controlBaseSym) {
                  const axis = blend < 0.5 ? controlBaseSym.axis : cur.axis
                  const factor =
                    controlBaseSym.factor + (cur.factor - controlBaseSym.factor) * blend
                  blended = { axis, factor }
                } else blended = cur
                hasBlended = true
              }
            } else if (cur === null) {
              // keep blended verbatim
            } else {
              if (blend <= 0) {
                // keep blended
              } else if (blend >= 1) {
                blended = cur
              } else {
                // numeric lerp factor, discrete hold for axis
                const axis = blend < 0.5 ? blended!.axis : cur.axis
                const factor = blended!.factor + (cur.factor - blended!.factor) * blend
                blended = { axis, factor }
              }
            }
          }
          if (!hasBlended || !blended) continue
          if (
            dormant &&
            this.#nodeTimeDrivesChannel(
              node,
              clampedTime,
              (animation) => hasEnabledKeyframes(animation.symmetryKeyframes()),
              (clip) => hasEnabledKeyframes(clip.getSymmetryKeyframes()),
            )
          ) {
            continue
          }
          value = blended
        }
      }
    }
    return value
  }

  evaluateSymmetryVertices(
    nodeId: string,
    time: number,
    baseVertices: readonly MeshVertex[],
  ): readonly MeshVertex[] | null {
    const value = this.evaluateSymmetryValue(nodeId, time)
    if (!value) return null
    if (value.factor === 0) return baseVertices
    return resolveSymmetrizedVertices(baseVertices, value.axis, value.factor)
  }

  #evaluateSymmetryKeyframes(
    keyframes: readonly Keyframe[],
    time: number,
  ): SymmetryKeyframeValue | null {
    const enabled = enabledKeyframes(keyframes)
    if (enabled.length === 0) return null
    const first = enabled[0]
    const last = enabled[enabled.length - 1]
    const firstVal = this.#symmetryValueOf(first)
    const lastVal = this.#symmetryValueOf(last)
    if (time <= first.time) return firstVal
    if (time >= last.time) return lastVal
    for (let i = 0; i < enabled.length - 1; i += 1) {
      const from = enabled[i]
      const to = enabled[i + 1]
      if (time >= from.time && time < to.time) {
        if (from.interpolation === 'hold') return this.#symmetryValueOf(from)
        const fromVal = this.#symmetryValueOf(from)
        const toVal = this.#symmetryValueOf(to)
        const ratio = (time - from.time) / (to.time - from.time)
        const u = this.#easedProgress(from, to, time, ratio)
        // axis holds from start; factor lerps with eased progress
        const factor = fromVal.factor + (toVal.factor - fromVal.factor) * u
        return { axis: fromVal.axis, factor }
      }
    }
    return lastVal
  }

  #symmetryValueOf(keyframe: Keyframe): SymmetryKeyframeValue {
    const v = keyframe.value as unknown as SymmetryKeyframeValue
    if (v && typeof v === 'object' && 'axis' in v && 'factor' in v) {
      return { axis: v.axis, factor: v.factor }
    }
    // fallback
    return { axis: 'x', factor: 0 }
  }

  #evaluateMorphKeyframes(keyframes: readonly Keyframe[], time: number): MorphKeyframeValue | null {
    const enabled = enabledKeyframes(keyframes)
    if (enabled.length === 0) return null
    const first = enabled[0]
    const last = enabled[enabled.length - 1]
    const firstVal = this.#morphValueOf(first)
    const lastVal = this.#morphValueOf(last)
    if (time <= first.time) return firstVal
    if (time >= last.time) return lastVal
    for (let i = 0; i < enabled.length - 1; i += 1) {
      const from = enabled[i]
      const to = enabled[i + 1]
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
    const enabled = enabledKeyframes(keyframes)
    if (enabled.length === 0) return null
    if (!shapes || shapes.length === 0) return baseVertices
    const first = enabled[0]
    const last = enabled[enabled.length - 1]
    if (time <= first.time) {
      return resolveMorphedVerticesFromKeyframe(baseVertices, shapes, this.#morphValueOf(first))
    }
    if (time >= last.time) {
      return resolveMorphedVerticesFromKeyframe(baseVertices, shapes, this.#morphValueOf(last))
    }
    for (let i = 0; i < enabled.length - 1; i += 1) {
      const from = enabled[i]
      const to = enabled[i + 1]
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
        const parsePath = (raw: unknown): readonly string[] | null | undefined => {
          if (raw === undefined) return undefined
          if (raw === null) return null
          if (Array.isArray(raw) && raw.every((s) => typeof s === 'string')) return [...raw]
          return undefined
        }
        return {
          fromShapeName: (r.fromShapeName as string | null) ?? null,
          toShapeName: (r.toShapeName as string | null) ?? null,
          coefficient: r.coefficient as number,
          ...('fromCategoryPath' in r
            ? (() => {
                const p = parsePath(r.fromCategoryPath)
                return p !== undefined ? { fromCategoryPath: p } : {}
              })()
            : {}),
          ...('toCategoryPath' in r
            ? (() => {
                const p = parsePath(r.toCategoryPath)
                return p !== undefined ? { toCategoryPath: p } : {}
              })()
            : {}),
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
    categories?: readonly ShapeCategory[] | undefined,
  ): MorphKeyframeValue {
    if (!shapes || shapes.length === 0) {
      return { fromShapeId: null, toShapeId: null, coefficient: clipVal.coefficient }
    }
    const fromShape = clipVal.fromShapeName
      ? resolveClipShapeByNameAndPath(
          shapes,
          categories,
          clipVal.fromShapeName,
          clipVal.fromCategoryPath,
        )
      : undefined
    const toShape = clipVal.toShapeName
      ? resolveClipShapeByNameAndPath(
          shapes,
          categories,
          clipVal.toShapeName,
          clipVal.toCategoryPath,
        )
      : undefined
    if (clipVal.fromShapeName && !fromShape) {
      console.warn(
        `[morph] Clip shape "${clipVal.fromShapeName}" not found on target node — falling back to base`,
      )
    }
    if (clipVal.toShapeName && !toShape) {
      console.warn(
        `[morph] Clip shape "${clipVal.toShapeName}" not found on target node — falling back to base`,
      )
    }
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
    categories?: readonly ShapeCategory[] | undefined,
  ): MorphKeyframeValue | null {
    if (keyframes.length === 0) return null
    // clip keyframes time in 0..1 normalized
    const first = keyframes[0]
    const last = keyframes[keyframes.length - 1]
    const firstVal = this.#morphClipValueOf(first)
    // clip Value is MorphClipKeyframeValue already; but we need to resolve to node ids for layering?
    // For evaluateMorphValue we resolve names to ids to produce MorphKeyframeValue
    const resolve = (v: MorphClipKeyframeValue) =>
      this.#resolveClipValueToNode(v, shapes, categories)
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
        // keep from binding for scalar evaluate (including category paths)
        const blended: MorphClipKeyframeValue = {
          fromShapeName: fromVal.fromShapeName,
          toShapeName: fromVal.toShapeName,
          coefficient: coeff,
          ...('fromCategoryPath' in fromVal ? { fromCategoryPath: fromVal.fromCategoryPath } : {}),
          ...('toCategoryPath' in fromVal ? { toCategoryPath: fromVal.toCategoryPath } : {}),
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
    categories?: readonly ShapeCategory[] | undefined,
  ): readonly MeshVertex[] | null {
    if (keyframes.length === 0) return null
    if (!shapes || shapes.length === 0) return baseVertices
    const first = keyframes[0]
    const last = keyframes[keyframes.length - 1]
    if (u <= first.time) {
      const v = this.#resolveClipValueToNode(this.#morphClipValueOf(first), shapes, categories)
      return resolveMorphedVerticesFromKeyframe(baseVertices, shapes, v)
    }
    if (u >= last.time) {
      const v = this.#resolveClipValueToNode(this.#morphClipValueOf(last), shapes, categories)
      return resolveMorphedVerticesFromKeyframe(baseVertices, shapes, v)
    }
    for (let i = 0; i < keyframes.length - 1; i += 1) {
      const from = keyframes[i]
      const to = keyframes[i + 1]
      if (u >= from.time && u < to.time) {
        if (from.interpolation === 'hold') {
          const v = this.#resolveClipValueToNode(this.#morphClipValueOf(from), shapes, categories)
          return resolveMorphedVerticesFromKeyframe(baseVertices, shapes, v)
        }
        const fromVal = this.#resolveClipValueToNode(
          this.#morphClipValueOf(from),
          shapes,
          categories,
        )
        const toVal = this.#resolveClipValueToNode(this.#morphClipValueOf(to), shapes, categories)
        const ratio = (u - from.time) / (to.time - from.time)
        const eased = this.#easedProgress(from, to, u, ratio)
        return resolveCrossBlendedVertices(baseVertices, shapes, fromVal, toVal, eased)
      }
    }
    const v = this.#resolveClipValueToNode(this.#morphClipValueOf(last), shapes, categories)
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
        const rawKfs = animation.materialKeyframes(parameter)
        const enabled = enabledKeyframes(rawKfs)
        if (enabled.length === 0) continue
        if (!Object.prototype.hasOwnProperty.call(values, parameter)) {
          keys.push(parameter)
        }
        values[parameter] = evaluateMaterialTrackValue(kind, parameter, enabled, clampedTime)
      }
    }

    // Apply clip-driven material parameter overrides (after standard channels,
    // per Spec 07 R29 material parameter channels)
    this.#applyClipMaterialOverrides(node, clampedTime, target)
    this.#applyControlMaterialOverrides(node, clampedTime, target)

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
    let segments = Math.max(3, Math.min(256, Math.round(segmentsRaw)))
    const values = { radius, startAngle, endAngle, segments } as Record<string, number>
    if (node.semanticName !== undefined) {
      const hosts: SceneNode[] = []
      for (let host = node.parent; host; host = host.parent) if (host.controlSet) hosts.push(host)
      for (const host of hosts) {
        const hostAnim = this.#slideLookup(node.id).animation.node(host.id)
        for (const control of host.controlSet?.controls ?? []) {
          const dormant = this.#isControlDormant(hostAnim, control)
          const { u: rawU, blends: blendFactors } = this.#evaluateHostWithBlends(
            control,
            hostAnim,
            clampedTime,
          )
          const groupClips = this.#getGroupClips(node.semanticName, control, rawU)
          if (groupClips.length === 0) continue
          const propSet = new Set<string>()
          for (const entry of groupClips)
            if (entry) for (const p of entry.clip.circleTrackKeys) propSet.add(p)
          if (propSet.size === 0) continue
          const baseMap = new Map<string, number>()
          for (const p of propSet) baseMap.set(p, values[p] ?? 0)
          for (const property of propSet) {
            let blended: number | undefined = undefined
            for (let gi = 0; gi < groupClips.length; gi++) {
              const blend = gi === 0 ? 0 : (blendFactors[gi - 1] ?? 0)
              if (gi > 0 && blend === 0) continue
              const entry = groupClips[gi]
              let cur: number | undefined = undefined
              if (entry && entry.clip.circleTrackKeys.includes(property as never)) {
                const kf = enabledKeyframes(entry.clip.getCircleKeyframes(property as never))
                if (kf.length > 0)
                  cur = this.#evaluateClipChannel(
                    kf,
                    effectiveUForClip(entry.clip, kf, entry.uPrime),
                  )
              }
              if (blended === undefined && cur === undefined) {
                // gap
              } else if (blended === undefined) {
                if (gi === 0) blended = cur
                else {
                  const base = baseMap.get(property) ?? 0
                  blended = base + ((cur as number) - base) * blend
                }
              } else if (cur === undefined) {
                // keep blended
              } else {
                blended = blended + (cur - blended) * blend
              }
            }
            if (blended === undefined) continue
            if (
              dormant &&
              this.#nodeTimeDrivesChannel(
                node,
                clampedTime,
                (animation) => hasEnabledKeyframes(animation.circleKeyframes(property as never)),
                (clip) => hasEnabledKeyframes(clip.getCircleKeyframes(property as never)),
              )
            ) {
              continue
            }
            values[property] = blended
          }
        }
      }
    }
    segments = Math.max(3, Math.min(256, Math.round(values.segments)))
    return {
      radius: values.radius,
      startAngle: values.startAngle,
      endAngle: values.endAngle,
      segments,
    }
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
    const values = { borderRadius, padding } as Record<string, number>
    if (node.semanticName !== undefined) {
      const hosts: SceneNode[] = []
      for (let host = node.parent; host; host = host.parent) if (host.controlSet) hosts.push(host)
      for (const host of hosts) {
        const hostAnim = this.#slideLookup(node.id).animation.node(host.id)
        for (const control of host.controlSet?.controls ?? []) {
          const dormant = this.#isControlDormant(hostAnim, control)
          const { u: rawU, blends: blendFactors } = this.#evaluateHostWithBlends(
            control,
            hostAnim,
            clampedTime,
          )
          const groupClips = this.#getGroupClips(node.semanticName, control, rawU)
          if (groupClips.length === 0) continue
          const propSet = new Set<string>()
          for (const entry of groupClips)
            if (entry) for (const p of entry.clip.tableTrackKeys) propSet.add(p)
          if (propSet.size === 0) continue
          const baseMap = new Map<string, number>()
          for (const p of propSet) baseMap.set(p, values[p] ?? 0)
          for (const property of propSet) {
            let blended: number | undefined = undefined
            for (let gi = 0; gi < groupClips.length; gi++) {
              const blend = gi === 0 ? 0 : (blendFactors[gi - 1] ?? 0)
              if (gi > 0 && blend === 0) continue
              const entry = groupClips[gi]
              let cur: number | undefined = undefined
              if (entry && entry.clip.tableTrackKeys.includes(property as never)) {
                const kf = enabledKeyframes(entry.clip.getTableKeyframes(property as never))
                if (kf.length > 0)
                  cur = this.#evaluateClipChannel(
                    kf,
                    effectiveUForClip(entry.clip, kf, entry.uPrime),
                  )
              }
              if (blended === undefined && cur === undefined) {
                void 0
              } else if (blended === undefined) {
                if (gi === 0) blended = cur
                else {
                  const base = baseMap.get(property) ?? 0
                  blended = base + ((cur as number) - base) * blend
                }
              } else if (cur === undefined) {
                void 0
              } else {
                blended = blended! + (cur - blended!) * blend
              }
            }
            if (blended === undefined) continue
            if (
              dormant &&
              this.#nodeTimeDrivesChannel(
                node,
                clampedTime,
                (animation) => hasEnabledKeyframes(animation.tableKeyframes(property as never)),
                (clip) => hasEnabledKeyframes(clip.getTableKeyframes(property as never)),
              )
            ) {
              continue
            }
            values[property] = blended
          }
        }
      }
    }
    return {
      borderRadius: Math.max(0, values.borderRadius),
      padding: Math.max(0, values.padding),
    }
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

      if (!isClipInstanceActive(instance, clip, time)) {
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

        const effU = effectiveUForClip(clip, channelAnim.keyframes(), u)
        const kfValue = this.#evaluateClipChannel(channelAnim.keyframes(), effU)

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

  /** Controls are evaluated after time clips. Nearest hosts run first so ancestors win. Blended groups fold with per-property absent pass-through. */
  #applyControls(node: SceneNode, time: number, state: EvaluatedNodeScratch): void {
    void this.#forEachControlClip // keep for backward compat
    if (node.semanticName === undefined) return
    const hosts: SceneNode[] = []
    for (let host = node.parent; host; host = host.parent) {
      if (host.controlSet) hosts.push(host)
    }
    for (const host of hosts) {
      const hostAnim = this.#slideLookup(node.id).animation.node(host.id)
      for (const control of host.controlSet?.controls ?? []) {
        const dormant = this.#isControlDormant(hostAnim, control)
        const { u: rawU, blends: blendFactors } = this.#evaluateHostWithBlends(
          control,
          hostAnim,
          time,
        )
        const groupClips = this.#getGroupClips(node.semanticName, control, rawU)
        if (groupClips.length === 0) continue
        // Collect distinct channels present in any group's clip (including linkMode channels)
        const channelsSet = new Set<AnimationProperty>()
        for (const entry of groupClips) {
          if (!entry) continue
          for (const ch of entry.clip.channels) {
            if (ch.materialParameter) continue
            const anim = entry.clip.channelAnimation(ch.property)
            if (!anim || anim.length === 0) continue
            channelsSet.add(ch.property)
          }
        }
        if (channelsSet.size === 0) continue
        const baseValues = new Map<AnimationProperty, number>()
        for (const ch of channelsSet)
          baseValues.set(ch, this.#getChannelValue(state.transform, state.opacity, ch))
        for (const channel of channelsSet) {
          let blended: number | undefined = undefined
          for (let gi = 0; gi < groupClips.length; gi++) {
            const blend = gi === 0 ? 0 : (blendFactors[gi - 1] ?? 0)
            if (gi > 0 && blend === 0) continue
            const entry = groupClips[gi]
            let cur: number | undefined = undefined
            if (entry) {
              const channelDef = entry.clip.channels.find(
                (c) => c.property === channel && !c.materialParameter,
              )
              if (channelDef) {
                const anim = entry.clip.channelAnimation(channel)
                if (anim && anim.length > 0) {
                  const enabled = enabledKeyframes(anim.keyframes())
                  if (enabled.length > 0) {
                    const effU = effectiveUForClip(entry.clip, enabled, entry.uPrime)
                    const kfVal = this.#evaluateClipChannel(enabled, effU)
                    if (channelDef.paramKey) {
                      const paramVal = entry.clip.getParam(channelDef.paramKey)?.default ?? 1
                      const base = baseValues.get(channel) ?? 0
                      cur =
                        channelDef.linkMode === 'offset'
                          ? base + paramVal * kfVal
                          : base * (paramVal * kfVal)
                    } else {
                      cur = kfVal
                    }
                  }
                }
              }
            }
            if (blended === undefined && cur === undefined) {
              // both absent → gap
            } else if (blended === undefined) {
              if (gi === 0) blended = cur
              else {
                const base = baseValues.get(channel) ?? 0
                blended = base + ((cur as number) - base) * blend
              }
            } else if (cur === undefined) {
              // keep blended verbatim
            } else {
              blended = blended + (cur - blended) * blend
            }
          }
          if (blended === undefined) continue
          if (
            dormant &&
            this.#nodeTimeDrivesChannel(
              node,
              time,
              (animation) => hasEnabledKeyframes(animation.keyframes(channel)),
              (clip) => {
                const channelAnim = clip.channelAnimation(channel)
                return !!channelAnim && hasEnabledKeyframes(channelAnim.keyframes())
              },
            )
          ) {
            continue
          }
          this.#setChannelValue(state, channel, blended)
        }
      }
    }
  }

  #forEachControlClip(
    node: SceneNode,
    time: number,
    callback: (clip: ClipDefinition, u: number) => void,
  ): void {
    if (node.semanticName === undefined) {
      return
    }
    const hosts: SceneNode[] = []
    for (let host = node.parent; host; host = host.parent) {
      if (host.controlSet) hosts.push(host)
    }
    for (const host of hosts) {
      const animation = this.#slideLookup(node.id).animation.node(host.id)
      for (const control of host.controlSet?.controls ?? []) {
        const rawBinding = (control.bindings as Record<string, unknown>)[node.semanticName]
        if (!rawBinding) continue
        const track = animation?.controlKeyframes(control.key) ?? []
        const value = Math.min(
          Math.max(evaluateControlTrack(track, time, control.default), control.min),
          control.max,
        )
        const range = control.max - control.min
        const rawU = range === 0 ? 0 : Math.min(Math.max((value - control.min) / range, 0), 1)
        const candidates: unknown[] = Array.isArray(rawBinding)
          ? (rawBinding as unknown[])
          : [rawBinding]
        let chosen: unknown | null = null
        for (const b of candidates) {
          const normalized =
            typeof b === 'string'
              ? { clipId: b, start: 0, end: 1 }
              : (b as { clipId: string; start: number; end: number })
          const s = (normalized as { start: number }).start ?? 0
          const e = (normalized as { end: number }).end ?? 1
          if (this.#isRawUInInterval(rawU, s, e)) chosen = b
        }
        if (!chosen) continue
        const normalized =
          typeof chosen === 'string'
            ? { clipId: chosen, start: 0, end: 1 }
            : (chosen as { clipId: string; start: number; end: number })
        const clipId = normalized.clipId
        if (!clipId) continue
        let clip: ClipDefinition
        try {
          clip = this.#clipLookup(clipId)
        } catch {
          continue
        }
        if (clip.duration < 0) continue
        if (clip.hasVisibleTrack()) {
          console.warn(
            `[control] Skipping binding "${node.semanticName}" on "${control.key}" — clip "${clipId}" contains visible (hold-only)`,
          )
          continue
        }
        const start = (normalized as { start: number }).start
        const end = (normalized as { end: number }).end
        const span = end - start
        if (span < 1e-9) continue
        const uPrime = Math.min(Math.max((rawU - start) / span, 0), 1)
        callback(clip, uPrime)
      }
    }
  }

  #isRawUInInterval(rawU: number, start: number, end: number): boolean {
    const EPS = CONTROL_INTERVAL_EPSILON
    if (rawU + EPS < start) return false
    const endIsOne = Math.abs(end - 1) < EPS
    if (endIsOne) {
      if (rawU > 1 + EPS) return false
      return true
    }
    if (rawU + EPS >= end) return false
    return true
  }

  #evaluateRawU(control: Control, hostAnim: NodeAnimation | undefined, time: number): number {
    const track = hostAnim?.controlKeyframes(control.key) ?? []
    const value = Math.min(
      Math.max(evaluateControlTrack(track, time, control.default), control.min),
      control.max,
    )
    const range = control.max - control.min
    return range === 0 ? 0 : Math.min(Math.max((value - control.min) / range, 0), 1)
  }

  /**
   * Shared-U + local blend: one host segment gives {u, blends}.
   * U and blends share the host segment interpolation (hold/linear/bezier).
   * Missing blend = [] (=0s).
   */
  #evaluateHostWithBlends(
    control: Control,
    hostAnim: NodeAnimation | undefined,
    time: number,
  ): { u: number; blends: number[] } {
    const u = this.#evaluateRawU(control, hostAnim, time)
    const track = hostAnim?.controlKeyframes(control.key) ?? []
    const blendCount = Math.max(0, control.groups.length - 1)
    const raw = evaluateHostWithBlends(track, time, control.default, blendCount)
    return { u, blends: raw.blends }
  }

  /** A control with no enabled keyframes on this slide is dormant (ADR 0018). */
  #isControlDormant(hostAnim: NodeAnimation | undefined, control: Control): boolean {
    return !(hostAnim?.hasEnabledControlKeyframes(control.key) ?? false)
  }

  /**
   * True when the target node's own time animation drives a channel: enabled raw
   * keyframes on the node, or an enabled ClipInstance active at `time` whose clip
   * carries enabled keyframes for the channel. A dormant Control yields per
   * channel to this (ADR 0018).
   */
  #nodeTimeDrivesChannel(
    node: SceneNode,
    time: number,
    rawDrives: (animation: NodeAnimation) => boolean,
    clipDrives: (clip: ClipDefinition) => boolean,
  ): boolean {
    const animation = this.#slideLookup(node.id).animation.node(node.id)
    if (animation && rawDrives(animation)) return true
    for (const instance of node.clipInstances) {
      if (!instance.enabled) continue
      let clip: ClipDefinition
      try {
        clip = this.#clipLookup(instance.clipId)
      } catch {
        continue
      }
      if (!isClipInstanceActive(instance, clip, time)) continue
      if (clipDrives(clip)) return true
    }
    return false
  }

  #getGroupClips(
    nodeSemantic: string,
    control: Control,
    rawU: number,
  ): ({ clip: ClipDefinition; uPrime: number } | null)[] {
    const groups: readonly ControlGroup[] =
      (control.groups as readonly ControlGroup[]) ??
      ([
        {
          id: 'g1',
          name: 'Group 1',
          bindings: control.bindings as unknown as Record<string, ControlBinding>,
        },
      ] as readonly ControlGroup[])
    const result: ({ clip: ClipDefinition; uPrime: number } | null)[] = []
    for (const group of groups) {
      // One ordered candidate list per group: clip intervals in stored order,
      // then live-linked collection blocks in stored order. Last-wins scan
      // below means collections win ties over clips within the same group —
      // matching the lane rendering (collections stack below clips).
      const candidates: {
        clipId: string
        start: number
        end: number
      }[] = []
      const rawBinding = (group.bindings as Record<string, unknown>)[nodeSemantic]
      if (rawBinding) {
        const raws: unknown[] = Array.isArray(rawBinding) ? rawBinding : [rawBinding]
        for (const b of raws) {
          const normalized =
            typeof b === 'string'
              ? { clipId: b, start: 0, end: 1 }
              : (b as { clipId: string; start: number; end: number })
          candidates.push({
            clipId: (normalized as { clipId: string }).clipId,
            start: (normalized as { start: number }).start ?? 0,
            end: (normalized as { end: number }).end ?? 1,
          })
        }
      }
      for (const block of groupCollectionBlocks(group)) {
        let memberClipId: string | undefined
        try {
          memberClipId =
            this.#collectionLookup(block.collectionId)?.getBinding(nodeSemantic) ?? undefined
        } catch {
          memberClipId = undefined
        }
        if (typeof memberClipId !== 'string' || memberClipId.trim() === '') continue
        candidates.push({
          clipId: memberClipId,
          start: block.start,
          end: block.end,
        })
      }
      if (candidates.length === 0) {
        result.push(null)
        continue
      }
      let chosen: (typeof candidates)[number] | null = null
      for (const c of candidates) {
        if (this.#isRawUInInterval(rawU, c.start, c.end)) chosen = c
      }
      if (!chosen) {
        result.push(null)
        continue
      }
      const clipId = chosen.clipId
      const start = chosen.start
      const end = chosen.end
      const span = end - start
      if (span < 1e-9) {
        result.push(null)
        continue
      }
      const uPrime = Math.min(Math.max((rawU - start) / span, 0), 1)
      let clip: ClipDefinition
      try {
        clip = this.#clipLookup(clipId)
      } catch {
        result.push(null)
        continue
      }
      // No whole-clip rejection for discrete lanes: visible stays inert by
      // global design (evaluateVisible is static), and zIndex steps through
      // evaluateZIndex — the coefficient is a time point, so every other
      // channel in the clip still drives.
      result.push({ clip, uPrime })
    }
    return result
  }

  #applyControlMaterialOverrides(
    node: SceneNode,
    time: number,
    target: EvaluatedMaterialOverridesScratch,
  ): void {
    if (node.semanticName === undefined) return
    const hosts: SceneNode[] = []
    for (let host = node.parent; host; host = host.parent) if (host.controlSet) hosts.push(host)
    for (const host of hosts) {
      const hostAnim = this.#slideLookup(node.id).animation.node(host.id)
      for (const control of host.controlSet?.controls ?? []) {
        const dormant = this.#isControlDormant(hostAnim, control)
        const { u: rawU, blends: blendFactors } = this.#evaluateHostWithBlends(
          control,
          hostAnim,
          time,
        )
        const groupClips = this.#getGroupClips(node.semanticName, control, rawU)
        if (groupClips.length === 0) continue
        const paramSet = new Set<string>()
        for (const entry of groupClips) {
          if (!entry) continue
          for (const ch of entry.clip.channels) {
            if (!ch.materialParameter) continue
            const kf = entry.clip.getMaterialChannelKeyframes(ch.materialParameter)
            if (!kf || kf.length === 0) continue
            if (this.#parameterKindOf(node, ch.materialParameter) === undefined) continue
            paramSet.add(ch.materialParameter)
          }
        }
        if (paramSet.size === 0) continue
        // Capture base values before this control for gain/offset
        const baseMap = new Map<string, MaterialOverrideValue>()
        for (const param of paramSet) {
          const v = target.values[param]
          if (v !== undefined) baseMap.set(param, v as MaterialOverrideValue)
        }
        for (const param of paramSet) {
          const kind = this.#parameterKindOf(node, param)
          if (kind === undefined) continue
          let blended: MaterialOverrideValue | undefined = undefined
          for (let gi = 0; gi < groupClips.length; gi++) {
            const blendEarly = gi === 0 ? 0 : (blendFactors[gi - 1] ?? 0)
            if (gi > 0 && blendEarly === 0) continue
            const entry = groupClips[gi]
            let cur: MaterialOverrideValue | undefined = undefined
            if (entry) {
              const chDef = entry.clip.channels.find((c) => c.materialParameter === param)
              if (chDef) {
                const kf = enabledKeyframes(entry.clip.getMaterialChannelKeyframes(param))
                if (kf.length > 0) {
                  const effU = effectiveUForClip(entry.clip, kf, entry.uPrime)
                  const kfVal = this.#evaluateClipChannel(
                    kf,
                    effU,
                  ) as unknown as MaterialOverrideValue
                  const paramVal = chDef.paramKey
                    ? (entry.clip.getParam(chDef.paramKey)?.default ?? 1)
                    : undefined
                  if (paramVal === undefined) cur = kfVal
                  else {
                    const baseEntry = baseMap.get(param)
                    const baseNum = typeof baseEntry === 'number' ? baseEntry : 0
                    if (typeof kfVal === 'number') {
                      cur =
                        chDef.linkMode === 'offset'
                          ? (baseNum as number) + paramVal * (kfVal as number)
                          : (baseNum as number) * paramVal * (kfVal as number)
                    } else {
                      // For non-numeric material values, ignore gain/offset and use kfVal directly
                      cur = kfVal
                    }
                  }
                }
              }
            }
            if (blended === undefined && cur === undefined) {
              // gap
            } else if (blended === undefined) {
              if (gi === 0) blended = cur
              else {
                const base = baseMap.get(param)
                if (base !== undefined)
                  blended = this.#lerpMaterialValue(
                    kind,
                    base as MaterialOverrideValue,
                    cur as MaterialOverrideValue,
                    blendEarly,
                  )
                else blended = cur
              }
            } else if (cur === undefined) {
              // keep blended
            } else {
              blended = this.#lerpMaterialValue(kind, blended, cur, blendEarly)
            }
          }
          if (blended === undefined) continue
          if (
            dormant &&
            this.#nodeTimeDrivesChannel(
              node,
              time,
              (animation) => hasEnabledKeyframes(animation.materialKeyframes(param)),
              (clip) => hasEnabledKeyframes(clip.getMaterialChannelKeyframes(param)),
            )
          ) {
            continue
          }
          if (!Object.prototype.hasOwnProperty.call(target.values, param)) target.keys.push(param)
          target.values[param] = blended
        }
      }
    }
  }

  #lerpMaterialValue(
    kind: string,
    from: MaterialOverrideValue,
    to: MaterialOverrideValue,
    t: number,
  ): MaterialOverrideValue {
    if (kind === 'number' || kind === 'float') {
      return (from as number) + ((to as number) - (from as number)) * t
    }
    if (kind === 'color' && typeof from === 'string' && typeof to === 'string') {
      return lerpHexColor(from, to, t)
    }
    if (
      (kind === 'vec2' || kind === 'vec3' || kind === 'vec4') &&
      Array.isArray(from) &&
      Array.isArray(to)
    ) {
      const a = from as readonly number[]
      const b = to as readonly number[]
      const out = new Array<number>(a.length)
      for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * t
      return out
    }
    // Discrete kinds hold
    return t < 0.5 ? from : to
  }

  #applyControlShadowLayers(node: SceneNode, time: number, state: ShadowEffect): void {
    if (node.semanticName === undefined) return
    const hosts: SceneNode[] = []
    for (let host = node.parent; host; host = host.parent) if (host.controlSet) hosts.push(host)
    for (const host of hosts) {
      const hostAnim = this.#slideLookup(node.id).animation.node(host.id)
      for (const control of host.controlSet?.controls ?? []) {
        const dormant = this.#isControlDormant(hostAnim, control)
        const { u: rawU, blends: blendFactors } = this.#evaluateHostWithBlends(
          control,
          hostAnim,
          time,
        )
        const groupClips = this.#getGroupClips(node.semanticName, control, rawU)
        if (groupClips.length === 0) continue
        const propSet = new Set<ShadowProperty>()
        for (const entry of groupClips) {
          if (!entry) continue
          for (const p of entry.clip.shadowChannelKeys) propSet.add(p)
        }
        if (propSet.size === 0) continue
        const baseMap = new Map<ShadowProperty, unknown>()
        for (const p of propSet) baseMap.set(p, (state as unknown as Record<string, unknown>)[p])
        for (const property of propSet) {
          let blended: unknown = undefined
          let hasBlended = false
          for (let gi = 0; gi < groupClips.length; gi++) {
            const blendEarly = gi === 0 ? 0 : (blendFactors[gi - 1] ?? 0)
            if (gi > 0 && blendEarly === 0) continue
            const entry = groupClips[gi]
            let cur: unknown = undefined
            let hasCur = false
            if (entry) {
              if (entry.clip.shadowChannelKeys.includes(property)) {
                const kf = enabledKeyframes(entry.clip.getShadowChannelKeyframes(property))
                if (kf.length > 0) {
                  const effU = effectiveUForClip(entry.clip, kf, entry.uPrime)
                  cur =
                    property === 'color'
                      ? this.#evaluateClipShadowColorValue(kf, effU)
                      : this.#evaluateClipShadowNumeric(kf, effU)
                  hasCur = true
                }
              }
            }
            if (!hasBlended && !hasCur) {
              // gap
            } else if (!hasBlended) {
              if (gi === 0) {
                blended = cur
                hasBlended = hasCur
              } else {
                const base = baseMap.get(property)
                if (property === 'color') {
                  blended = lerpHexColor(base as string, cur as string, blendEarly)
                } else {
                  blended = (base as number) + ((cur as number) - (base as number)) * blendEarly
                }
                hasBlended = hasCur
              }
            } else if (!hasCur) {
              // keep blended
            } else {
              if (property === 'color') {
                blended = lerpHexColor(blended as string, cur as string, blendEarly)
              } else {
                blended = (blended as number) + ((cur as number) - (blended as number)) * blendEarly
              }
            }
          }
          if (!hasBlended) continue
          if (
            dormant &&
            this.#nodeTimeDrivesChannel(
              node,
              time,
              (animation) => hasEnabledKeyframes(animation.shadowKeyframes(property)),
              (clip) => hasEnabledKeyframes(clip.getShadowChannelKeyframes(property)),
            )
          ) {
            continue
          }
          const shadowState = state as unknown as Record<string, unknown>
          shadowState[property] = blended as never
        }
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

      if (!isClipInstanceActive(instance, clip, time)) {
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

        const effU = effectiveUForClip(clip, channelAnim.keyframes(), u)
        const kfValue = this.#evaluateClipChannel(channelAnim.keyframes(), effU)

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
    const enabled = enabledKeyframes(keyframes)
    if (enabled.length === 0) return fallback
    const first = enabled[0]
    if (time <= first.time) {
      return first.value as number
    }
    const last = enabled[enabled.length - 1]
    if (time >= last.time) {
      return last.value as number
    }
    for (let i = 0; i < enabled.length - 1; i += 1) {
      const from = enabled[i]
      const to = enabled[i + 1]
      if (to.time > from.time && time >= from.time && time < to.time) {
        return evaluateSegment(from, to, time)
      }
    }
    return last.value as number
  }
}
