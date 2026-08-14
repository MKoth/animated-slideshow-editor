import type { EnginePublic } from './engine'
import type { AnimationProperty, Keyframe } from './animation'
import type { Command, CommandResult } from './commands/command'
import type { DispatchCommand } from './commands/dispatcher'
import { AddKeyframeCommand } from './commands/addKeyframeCommand'
import { SetKeyframeValueCommand } from './commands/setKeyframeValueCommand'
import { TransactionCommand } from './commands/transactionCommand'

export interface KeyframeEdit {
  readonly nodeId: string
  readonly property: AnimationProperty
  readonly value: number
}

export interface TimedKeyframeEdit extends KeyframeEdit {
  readonly time: number
}

export function keyframeAtTime(keyframes: readonly Keyframe[], time: number): Keyframe | undefined {
  return keyframes.find((keyframe) => keyframe.time === time)
}

export function evaluatedPropertyValue(
  engine: EnginePublic,
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

export function autoKeyCommands(
  engine: EnginePublic,
  edits: readonly TimedKeyframeEdit[],
): Command<unknown>[] {
  const commands: Command<unknown>[] = []
  for (const edit of edits) {
    const existing = keyframeAtTime(engine.getKeyframes(edit.nodeId, edit.property), edit.time)
    if (existing) {
      if (existing.value !== edit.value) {
        commands.push(
          new SetKeyframeValueCommand({
            nodeId: edit.nodeId,
            property: edit.property,
            keyframeId: existing.id,
            newValue: edit.value,
          }),
        )
      }
      continue
    }
    if (evaluatedPropertyValue(engine, edit.nodeId, edit.property, edit.time) === edit.value) {
      continue
    }
    commands.push(
      new AddKeyframeCommand({
        nodeId: edit.nodeId,
        property: edit.property,
        time: edit.time,
        value: edit.value,
      }),
    )
  }
  return commands
}

export function dispatchKeyframeCommands(
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
