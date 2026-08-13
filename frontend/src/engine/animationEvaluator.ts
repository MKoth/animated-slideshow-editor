import { requireFiniteNumber } from './guards'
import type { Keyframe } from './keyframe'
import type { SceneNode } from './sceneNode'
import type { Slide } from './slide'
import { identityTransform } from './transform'
import type { Transform } from './transform'

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

  constructor(nodeLookup: (nodeId: string) => SceneNode, slideLookup: (nodeId: string) => Slide) {
    this.#nodeLookup = nodeLookup
    this.#slideLookup = slideLookup
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

  #evaluate(keyframes: readonly Keyframe[] | undefined, time: number, fallback: number): number {
    if (!keyframes || keyframes.length === 0) {
      return fallback
    }
    const first = keyframes[0]
    if (time <= first.time) {
      return first.value
    }
    const last = keyframes[keyframes.length - 1]
    if (time >= last.time) {
      return last.value
    }
    for (let i = 0; i < keyframes.length - 1; i += 1) {
      const from = keyframes[i]
      const to = keyframes[i + 1]
      if (to.time > from.time && time >= from.time && time <= to.time) {
        const ratio = (time - from.time) / (to.time - from.time)
        return from.value + (to.value - from.value) * ratio
      }
    }
    return last.value
  }
}
