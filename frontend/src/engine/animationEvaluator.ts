import { requireFiniteNumber } from './guards'
import type { Keyframe } from './keyframe'
import type { MaterialOverrideValue, MaterialOverrides } from './materialInstance'
import type { MaterialParameterKindOf } from './keyframeTarget'
import type { SceneNode } from './sceneNode'
import type { Slide } from './slide'
import { identityTransform, pivotsEqual } from './transform'
import type { Transform, Pivot } from './transform'
import { evaluateSegment } from './interpolators'
import { evaluateMaterialTrackValue } from './materialTrackEvaluation'
import type { AnimationProperty } from './animationProperties'
import type { ClipDefinition } from './clipDefinition'
import { circleSegmentsForArc } from './circleComponent'

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
