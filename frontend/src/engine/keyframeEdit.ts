import type { EnginePublic } from './engine'
import type { AnimationProperty, Keyframe } from './animation'
import type { Command, CommandResult } from './commands/command'
import type { DispatchCommand } from './commands/dispatcher'
import { AddKeyframeCommand } from './commands/addKeyframeCommand'
import { SetKeyframeValueCommand } from './commands/setKeyframeValueCommand'
import { OverrideMaterialParameterCommand } from './commands/overrideMaterialParameterCommand'
import { TransactionCommand } from './commands/transactionCommand'
import type { KeyframeTarget } from './keyframeTarget'
import {
  isMorphTarget,
  isParameterTarget,
  isPropertyTarget,
  isShadowTarget,
} from './keyframeTarget'
import { uniformValuesEqual } from './materialResolution'
import type { KeyframeValue } from './keyframe'

export interface KeyframeEdit {
  readonly target: KeyframeTarget
  readonly value: KeyframeValue
}

export interface TimedKeyframeEdit extends KeyframeEdit {
  readonly time: number
}

/** A material-parameter edit with a playhead time (Spec 07 R28 auto-key). */
export interface MaterialParameterEdit {
  readonly nodeId: string
  readonly parameter: string
  readonly value: KeyframeValue
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

export function evaluatedShadowValue(
  engine: EnginePublic,
  nodeId: string,
  property: import('./shadowEffect').ShadowProperty,
  time: number,
): string | number {
  const effect = engine.evaluateShadow(nodeId, time)
  if (!effect) {
    // fallback to static if no effect
    const node = engine.getNode(nodeId)
    const base = (node.shadowEffect as unknown as Record<string, unknown>)?.[property]
    return base as string | number
  }
  return (effect as unknown as Record<string, unknown>)[property] as string | number
}

/**
 * The Spec 04 auto-key pattern generalized to targets: editing a value at a
 * time creates or updates that target's keyframe at the time. Property edits
 * skip when the evaluated value already equals the edit value; material
 * parameter edits always write a keyframe (the evaluated overlay is a later
 * spec).
 */
export function autoKeyCommands(
  engine: EnginePublic,
  edits: readonly TimedKeyframeEdit[],
): Command<unknown>[] {
  const commands: Command<unknown>[] = []
  for (const edit of edits) {
    const keyframes = targetKeyframes(engine, edit.target)
    const existing = keyframeAtTime(keyframes, edit.time)
    if (existing) {
      const equal = isMorphTarget(edit.target)
        ? JSON.stringify(existing.value) === JSON.stringify(edit.value)
        : isShadowTarget(edit.target)
          ? existing.value === edit.value
          : uniformValuesEqual(
              existing.value as unknown as import('./materialInstance').MaterialOverrideValue,
              edit.value as unknown as import('./materialInstance').MaterialOverrideValue,
            )
      if (!equal) {
        commands.push(
          new SetKeyframeValueCommand({
            target: edit.target,
            keyframeId: existing.id,
            newValue: edit.value,
          }),
        )
      }
      continue
    }
    if (
      isPropertyTarget(edit.target) &&
      evaluatedPropertyValue(engine, edit.target.nodeId, edit.target.property, edit.time) ===
        edit.value
    ) {
      continue
    }
    if (isShadowTarget(edit.target)) {
      const cur = evaluatedShadowValue(engine, edit.target.nodeId, edit.target.property, edit.time)
      if (cur === edit.value) continue
      // For color, string case sensitive lower?
      if (
        typeof cur === 'string' &&
        typeof edit.value === 'string' &&
        cur.toLowerCase() === (edit.value as string).toLowerCase()
      )
        continue
    }
    if (isMorphTarget(edit.target)) {
      // For morph, compare full object value (pair+coeff) via evaluateMorphValue when available
      const evalFn = (
        engine as unknown as { evaluateMorphValue?: (id: string, t: number) => unknown }
      ).evaluateMorphValue
      const cur = evalFn
        ? evalFn.call(engine, edit.target.nodeId, edit.time)
        : engine.evaluateMorph(edit.target.nodeId, edit.time)
      const isEqual =
        typeof cur === 'object' &&
        cur !== null &&
        typeof edit.value === 'object' &&
        edit.value !== null
          ? JSON.stringify(cur) === JSON.stringify(edit.value)
          : cur === edit.value
      if (isEqual) continue
    }
    commands.push(
      new AddKeyframeCommand({
        target: edit.target,
        time: edit.time,
        value: edit.value,
      }),
    )
  }
  return commands
}

/**
 * The material-parameter edit path (Spec 07 R28): editing a parameter that
 * already has a track auto-keys it at the playhead; editing an untracked
 * parameter issues the static-override command. Coherent with the Spec 04
 * auto-key pattern generalized to non-numeric values.
 */
export function materialParameterEditCommands(
  engine: EnginePublic,
  time: number,
  edits: readonly MaterialParameterEdit[],
): Command<unknown>[] {
  const commands: Command<unknown>[] = []
  for (const edit of edits) {
    const target: KeyframeTarget = { kind: 'node', nodeId: edit.nodeId, parameter: edit.parameter }
    if (engine.hasMaterialTrack(edit.nodeId, edit.parameter)) {
      commands.push(...autoKeyCommands(engine, [{ target, time, value: edit.value }]))
    } else {
      commands.push(
        new OverrideMaterialParameterCommand({
          nodeId: edit.nodeId,
          parameter: edit.parameter,
          value: edit.value as unknown as import('./materialInstance').MaterialOverrideValue,
        }),
      )
    }
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

function targetKeyframes(engine: EnginePublic, target: KeyframeTarget): readonly Keyframe[] {
  if (isParameterTarget(target)) {
    return engine.getMaterialKeyframes(target.nodeId, target.parameter)
  }
  if (isPropertyTarget(target)) {
    return engine.getKeyframes(target.nodeId, target.property)
  }
  if (isMorphTarget(target)) {
    return engine.getMorphKeyframes(target.nodeId)
  }
  if (isShadowTarget(target)) {
    return (
      (
        engine as unknown as {
          getShadowKeyframes?: (id: string, prop: string) => readonly Keyframe[]
        }
      ).getShadowKeyframes?.(target.nodeId, target.property) ?? []
    )
  }
  if (target.kind === 'visible') {
    return engine.getVisibleKeyframes(target.nodeId)
  }
  if (target.kind === 'circle') {
    return engine.getCircleKeyframes(target.nodeId, target.property)
  }
  if (target.kind === 'dataLabel') {
    return engine.getDataLabelKeyframes(target.nodeId, target.label)
  }
  if (target.kind === 'table') {
    return engine.getTableKeyframes(target.nodeId, target.property)
  }
  return []
}
