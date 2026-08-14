import type { SceneNode } from './sceneNode'
import { requireString } from './guards'
import { NodeAnimation } from './nodeAnimation'
import type { NodeAnimationJSON, SlideAnimationJSON } from './json'
import { ANIMATABLE_PROPERTIES } from './animationProperties'
import type { AnimationProperty } from './animationProperties'

export interface ClampedKeyframe {
  readonly nodeId: string
  readonly property: AnimationProperty
  readonly keyframeId: string
  readonly oldTime: number
}

export class SlideAnimation {
  readonly #nodes = new Map<string, NodeAnimation>()

  node(nodeId: string): NodeAnimation | undefined {
    return this.#nodes.get(nodeId)
  }

  ensure(nodeId: string): NodeAnimation {
    let animation = this.#nodes.get(nodeId)
    if (!animation) {
      animation = new NodeAnimation()
      this.#nodes.set(nodeId, animation)
    }
    return animation
  }

  removeNode(nodeId: string): void {
    this.#nodes.delete(nodeId)
  }

  clampKeyframesTo(duration: number): ClampedKeyframe[] {
    const clamped: ClampedKeyframe[] = []
    for (const [nodeId, animation] of this.#nodes) {
      for (const property of ANIMATABLE_PROPERTIES) {
        for (const keyframe of animation.keyframes(property)) {
          if (keyframe.time > duration) {
            clamped.push({
              nodeId,
              property,
              keyframeId: keyframe.id,
              oldTime: keyframe.time,
            })
            keyframe.time = duration
          }
        }
      }
    }
    return clamped
  }

  toJSON(): SlideAnimationJSON {
    const nodes: NodeAnimationJSON[] = []
    for (const [nodeId, animation] of this.#nodes) {
      const tracks = animation.toJSON()
      if (tracks.length > 0) {
        nodes.push({ nodeId, tracks })
      }
    }
    return { nodes }
  }

  static fromJSON(
    json: unknown,
    duration: number,
    nodeOf: (nodeId: string) => SceneNode | undefined,
  ): SlideAnimation {
    const animation = new SlideAnimation()
    if (json === undefined) {
      return animation
    }
    if (!json || typeof json !== 'object') {
      throw new Error('Slide animation must be an object')
    }
    const record = json as Record<string, unknown>
    if (!Array.isArray(record.nodes)) {
      throw new Error('Slide animation must have a nodes array')
    }
    for (const nodeJson of record.nodes) {
      if (typeof nodeJson !== 'object' || nodeJson === null) {
        throw new Error('Slide animation node must be an object')
      }
      const nodeRecord = nodeJson as Record<string, unknown>
      const nodeId = requireString(nodeRecord.nodeId, 'Animation node id')
      const node = nodeOf(nodeId)
      if (!node) {
        throw new Error(`Animation references unknown node: ${nodeId}`)
      }
      animation.#nodes.set(nodeId, NodeAnimation.fromJSON(nodeRecord.tracks, duration, node))
    }
    return animation
  }
}
