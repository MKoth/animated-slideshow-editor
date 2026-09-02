import type { SceneNode } from './sceneNode'
import { requireString } from './guards'
import { NodeAnimation } from './nodeAnimation'
import type { MaterialParameterKindOf } from './nodeAnimation'
import type { NodeAnimationJSON, SlideAnimationJSON } from './json'
import { ANIMATABLE_PROPERTIES, CIRCLE_ANIMATABLE_PROPERTIES } from './animationProperties'
import type { AnimationProperty, CircleAnimationProperty } from './animationProperties'

export type ClampedKeyframe =
  | {
      readonly nodeId: string
      readonly property: AnimationProperty
      readonly keyframeId: string
      readonly oldTime: number
    }
  | {
      readonly nodeId: string
      readonly parameterKey: string
      readonly keyframeId: string
      readonly oldTime: number
    }
  | {
      readonly nodeId: string
      readonly circleProperty: CircleAnimationProperty
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

  copyFor(nodeIdMap: ReadonlyMap<string, string>): SlideAnimation {
    const copy = new SlideAnimation()
    for (const [nodeId, animation] of this.#nodes) {
      const copiedNodeId = nodeIdMap.get(nodeId)
      if (!copiedNodeId) {
        throw new Error(`No copied node for animation node: ${nodeId}`)
      }
      copy.#nodes.set(copiedNodeId, animation.copy())
    }
    return copy
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
      for (const parameter of animation.materialTrackParameterKeys()) {
        for (const keyframe of animation.materialKeyframes(parameter)) {
          if (keyframe.time > duration) {
            clamped.push({
              nodeId,
              parameterKey: parameter,
              keyframeId: keyframe.id,
              oldTime: keyframe.time,
            })
            keyframe.time = duration
          }
        }
      }
      for (const property of CIRCLE_ANIMATABLE_PROPERTIES) {
        for (const keyframe of animation.circleKeyframes(property)) {
          if (keyframe.time > duration) {
            clamped.push({
              nodeId,
              circleProperty: property,
              keyframeId: keyframe.id,
              oldTime: keyframe.time,
            })
            keyframe.time = duration
          }
        }
      }
      for (const label of animation.dataLabelTrackLabels()) {
        for (const keyframe of animation.dataLabelKeyframes(label)) {
          if (keyframe.time > duration) {
            clamped.push({
              // dataLabel clamping not exposed externally currently; treat as generic
              nodeId,
              parameterKey: `data:${label}`,
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
      const materialTracks = animation.materialTracksJSON()
      const dataLabelTracks = animation.dataLabelTracksJSON()
      const circleTracks = animation.circleTracksJSON()
      if (
        tracks.length > 0 ||
        materialTracks.length > 0 ||
        dataLabelTracks.length > 0 ||
        circleTracks.length > 0
      ) {
        nodes.push({
          nodeId,
          tracks,
          ...(materialTracks.length > 0 ? { materialTracks } : {}),
          ...(dataLabelTracks.length > 0 ? { dataLabelTracks } : {}),
          ...(circleTracks.length > 0 ? { circleTracks } : {}),
        })
      }
    }
    return { nodes }
  }

  static fromJSON(
    json: unknown,
    duration: number,
    nodeOf: (nodeId: string) => SceneNode | undefined,
    parameterKindOf: MaterialParameterKindOf = () => undefined,
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
      animation.#nodes.set(
        nodeId,
        NodeAnimation.fromJSON(nodeRecord, duration, node, parameterKindOf),
      )
    }
    return animation
  }
}
