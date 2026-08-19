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
import type { AnimationProperty } from './animationProperties'
import type { ClipDefinition } from './clipDefinition'

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
    state.opacity = this.#evaluate(animation?.keyframes('opacity'), clampedTime, node.opacity)

    this.#applyClipInstances(node, clampedTime, state)

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

    // Apply clip-driven material parameter overrides (after standard channels,
    // per Spec 07 R29 material parameter channels)
    this.#applyClipMaterialOverrides(node, clampedTime, target)

    return values
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
