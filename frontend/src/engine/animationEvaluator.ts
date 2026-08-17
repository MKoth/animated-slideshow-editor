import { requireFiniteNumber } from './guards'
import type { Keyframe } from './keyframe'
import type { MaterialOverrideValue, MaterialOverrides } from './materialInstance'
import type { MaterialParameterKindOf } from './keyframeTarget'
import type { SceneNode } from './sceneNode'
import type { Slide } from './slide'
import { identityTransform } from './transform'
import type { Transform } from './transform'
import { evaluateSegment } from './interpolators'
import { evaluateMaterialTrackValue } from './materialTrackEvaluation'

export interface EvaluatedNodeState {
  readonly transform: Transform
  readonly opacity: number
}

type MutableTransform = {
  x: number
  y: number
  rotation: number
  scaleX: number
  scaleY: number
}

export interface EvaluatedNodeScratch {
  transform: MutableTransform
  opacity: number
}

export function evaluatedNodeScratch(): EvaluatedNodeScratch {
  return { transform: { ...identityTransform() }, opacity: 1 }
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
  return (
    previous.transform.x === state.transform.x &&
    previous.transform.y === state.transform.y &&
    previous.transform.rotation === state.transform.rotation &&
    previous.transform.scaleX === state.transform.scaleX &&
    previous.transform.scaleY === state.transform.scaleY &&
    previous.opacity === state.opacity
  )
}

export function copyEvaluatedState(target: EvaluatedNodeScratch, state: EvaluatedNodeState): void {
  target.transform.x = state.transform.x
  target.transform.y = state.transform.y
  target.transform.rotation = state.transform.rotation
  target.transform.scaleX = state.transform.scaleX
  target.transform.scaleY = state.transform.scaleY
  target.opacity = state.opacity
}

export class AnimationEvaluator {
  readonly #nodeLookup: (nodeId: string) => SceneNode
  readonly #slideLookup: (nodeId: string) => Slide
  readonly #parameterKindOf: MaterialParameterKindOf

  constructor(
    nodeLookup: (nodeId: string) => SceneNode,
    slideLookup: (nodeId: string) => Slide,
    parameterKindOf: MaterialParameterKindOf,
  ) {
    this.#nodeLookup = nodeLookup
    this.#slideLookup = slideLookup
    this.#parameterKindOf = parameterKindOf
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
    state.opacity = this.#evaluate(animation?.keyframes('opacity'), clampedTime, node.opacity)
    return state
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
    return values
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
