import type { EnginePublic, SceneNode } from '../engine'
import type { AnimationProperty } from '../engine'
import { ANIMATABLE_PROPERTIES, BONE_ANIMATABLE_PROPERTIES } from '../engine'
import type { Scene } from '../engine'
import type { CommandResult, DispatchCommand } from '../engine/commands'
import { AddKeyframeCommand } from '../engine/commands'
import type { Command } from '../engine/commands'
import { usePlaybackController } from '../stores/playbackStore'
import {
  autoKeyCommands,
  dispatchKeyframeCommands,
  evaluatedPropertyValue,
  keyframeAtTime,
  materialParameterEditCommands,
} from '../engine/keyframeEdit'
import type { KeyframeEdit, MaterialParameterEdit, TimedKeyframeEdit } from '../engine/keyframeEdit'
import { isParameterTarget, isPropertyTarget } from '../engine/keyframeTarget'

export type { KeyframeEdit, MaterialParameterEdit } from '../engine/keyframeEdit'
export {
  dispatchKeyframeCommands as dispatchCommands,
  evaluatedPropertyValue,
} from '../engine/keyframeEdit'

export type PropertyState = 'static' | 'animated' | 'onKeyframe'

export function animatablePropertiesOf(node: SceneNode): AnimationProperty[] {
  if (node.components.camera) {
    return ANIMATABLE_PROPERTIES.filter((property) => property !== 'rotation')
  }
  if (node.components.bone) {
    return [...BONE_ANIMATABLE_PROPERTIES]
  }
  return [...ANIMATABLE_PROPERTIES]
}

export function isAnimatable(node: SceneNode, property: AnimationProperty): boolean {
  return animatablePropertiesOf(node).includes(property)
}

export function slideOfNode(engine: EnginePublic, nodeId: string): Scene | null {
  for (const slide of engine.project?.slides ?? []) {
    if (slide.scene.getNode(nodeId)) {
      return slide.scene
    }
  }
  return null
}

export function playheadTimeOf(engine: EnginePublic, nodeId: string): number | null {
  const scene = slideOfNode(engine, nodeId)
  if (!scene) {
    return null
  }
  const slide = engine.project?.slides.find((candidate) => candidate.scene.id === scene.id)
  if (!slide) {
    return null
  }
  return usePlaybackController.getState().getTime(slide.id)
}

export function propertyStateOf(
  engine: EnginePublic,
  nodeId: string,
  property: AnimationProperty,
  time: number,
): PropertyState | null {
  let node: SceneNode
  try {
    node = engine.getNode(nodeId)
  } catch {
    return null
  }
  if (!isAnimatable(node, property)) {
    return null
  }
  const keyframes = engine.getKeyframes(nodeId, property)
  if (keyframes.length === 0) {
    return 'static'
  }
  if (keyframes.some((keyframe) => keyframe.time === time)) {
    return 'onKeyframe'
  }
  return 'animated'
}

export function materialParameterStateOf(
  engine: EnginePublic,
  nodeId: string,
  parameter: string,
  time: number,
): PropertyState | null {
  try {
    engine.getNode(nodeId)
  } catch {
    return null
  }
  if (!engine.hasMaterialTrack(nodeId, parameter)) {
    return 'static'
  }
  const keyframes = engine.getMaterialKeyframes(nodeId, parameter)
  if (keyframes.length === 0) {
    return 'static'
  }
  if (keyframes.some((keyframe) => keyframe.time === time)) {
    return 'onKeyframe'
  }
  return 'animated'
}

export function autoKeyEdit(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  edits: readonly KeyframeEdit[],
): CommandResult<unknown> | null {
  const timed: TimedKeyframeEdit[] = []
  for (const edit of edits) {
    if (!isPropertyTarget(edit.target) && !isParameterTarget(edit.target)) {
      continue
    }
    const time = playheadTimeOf(engine, edit.target.nodeId)
    if (time === null) {
      continue
    }
    timed.push({ ...edit, time })
  }
  return dispatchKeyframeCommands(dispatch, autoKeyCommands(engine, timed))
}

export function addKeyframeAtPlayhead(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  slideId: string,
  nodeId: string,
  property: AnimationProperty,
): CommandResult<unknown> | null {
  const time = usePlaybackController.getState().getTime(slideId)
  if (keyframeAtTime(engine.getKeyframes(nodeId, property), time)) {
    return null
  }
  const value = evaluatedPropertyValue(engine, nodeId, property, time)
  return dispatch(
    new AddKeyframeCommand({ target: { kind: 'node', nodeId, property }, time, value }),
  )
}

export function addPoseKeyframesAtPlayhead(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  slideId: string,
  nodeId: string,
): CommandResult<unknown> | null {
  const node = engine.getNode(nodeId)
  const time = usePlaybackController.getState().getTime(slideId)
  const commands: Command<unknown>[] = []
  for (const property of animatablePropertiesOf(node)) {
    if (keyframeAtTime(engine.getKeyframes(nodeId, property), time)) {
      continue
    }
    commands.push(
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId, property },
        time,
        value: evaluatedPropertyValue(engine, nodeId, property, time),
      }),
    )
  }
  return dispatchKeyframeCommands(dispatch, commands)
}

export function materialEditAtPlayhead(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  edits: readonly MaterialParameterEdit[],
): CommandResult<unknown> | null {
  const first = edits[0]
  if (!first) {
    return null
  }
  const time = playheadTimeOf(engine, first.nodeId)
  if (time === null) {
    return null
  }
  return dispatchKeyframeCommands(dispatch, materialParameterEditCommands(engine, time, edits))
}
