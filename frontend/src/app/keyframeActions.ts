import type { EngineReadOnly, SceneNode } from '../engine'
import type { AnimationProperty } from '../engine'
import { ANIMATABLE_PROPERTIES } from '../engine'
import type { Keyframe } from '../engine'
import type { Scene } from '../engine'
import type { CommandResult, DispatchCommand } from '../engine/commands'
import { AddKeyframeCommand, SetKeyframeValueCommand, TransactionCommand } from '../engine/commands'
import type { Command } from '../engine/commands'
import { usePlaybackController } from '../stores/playbackStore'

export type PropertyState = 'static' | 'animated' | 'onKeyframe'

export function animatablePropertiesOf(node: SceneNode): AnimationProperty[] {
  if (node.components.camera) {
    return ANIMATABLE_PROPERTIES.filter((property) => property !== 'rotation')
  }
  return [...ANIMATABLE_PROPERTIES]
}

export function isAnimatable(node: SceneNode, property: AnimationProperty): boolean {
  return animatablePropertiesOf(node).includes(property)
}

export function slideOfNode(engine: EngineReadOnly, nodeId: string): Scene | null {
  for (const slide of engine.project?.slides ?? []) {
    if (slide.scene.getNode(nodeId)) {
      return slide.scene
    }
  }
  return null
}

export function playheadTimeOf(engine: EngineReadOnly, nodeId: string): number | null {
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

export function keyframeAtTime(keyframes: readonly Keyframe[], time: number): Keyframe | undefined {
  return keyframes.find((keyframe) => keyframe.time === time)
}

export function evaluatedPropertyValue(
  engine: EngineReadOnly,
  nodeId: string,
  property: AnimationProperty,
  time: number,
): number {
  const state = engine.evaluateNode(nodeId, time)
  switch (property) {
    case 'positionX':
      return state.transform.x
    case 'positionY':
      return state.transform.y
    case 'rotation':
      return state.transform.rotation
    case 'scaleX':
      return state.transform.scaleX
    case 'scaleY':
      return state.transform.scaleY
    case 'opacity':
      return state.opacity
  }
}

export function propertyStateOf(
  engine: EngineReadOnly,
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

export interface KeyframeEdit {
  readonly nodeId: string
  readonly property: AnimationProperty
  readonly value: number
}

export function autoKeyEdit(
  engine: EngineReadOnly,
  dispatch: DispatchCommand,
  edits: readonly KeyframeEdit[],
): CommandResult<unknown> | null {
  const commands: Command<unknown>[] = []
  for (const edit of edits) {
    const time = playheadTimeOf(engine, edit.nodeId)
    if (time === null) {
      continue
    }
    const keyframes = engine.getKeyframes(edit.nodeId, edit.property)
    const existing = keyframeAtTime(keyframes, time)
    if (existing) {
      if (existing.value === edit.value) {
        continue
      }
      commands.push(
        new SetKeyframeValueCommand({
          nodeId: edit.nodeId,
          property: edit.property,
          keyframeId: existing.id,
          newValue: edit.value,
        }),
      )
      continue
    }
    const effective = evaluatedPropertyValue(engine, edit.nodeId, edit.property, time)
    if (effective === edit.value) {
      continue
    }
    commands.push(
      new AddKeyframeCommand({
        nodeId: edit.nodeId,
        property: edit.property,
        time,
        value: edit.value,
      }),
    )
  }
  return dispatchCommands(dispatch, commands)
}

export function addKeyframeAtPlayhead(
  engine: EngineReadOnly,
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
  return dispatch(new AddKeyframeCommand({ nodeId, property, time, value }))
}

export function addPoseKeyframesAtPlayhead(
  engine: EngineReadOnly,
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
        nodeId,
        property,
        time,
        value: evaluatedPropertyValue(engine, nodeId, property, time),
      }),
    )
  }
  return dispatchCommands(dispatch, commands)
}

export function dispatchCommands(
  dispatch: DispatchCommand,
  commands: readonly Command<unknown>[],
): CommandResult<unknown> | null {
  if (commands.length === 0) {
    return null
  }
  if (commands.length === 1) {
    return dispatch(commands[0])
  }
  return dispatch(new TransactionCommand(commands))
}
