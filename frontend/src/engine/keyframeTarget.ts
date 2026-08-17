import type { SceneNode } from './sceneNode'
import type { AnimationProperty } from './animationProperties'
import {
  requireAnimationProperty,
  requireAnimatableForNode,
  requireKeyframeValue,
} from './animationProperties'
import {
  isRecord,
  requireMaterialOverrideValue,
  requireMaterialParameterKey,
  requireString,
} from './guards'
import type { KeyframeValue } from './keyframe'
import { requireMaterialKeyframeValue } from './materialKeyframes'

/** A uniform-six property target of a node (Spec 07 R9). */
export interface NodePropertyTarget {
  readonly kind: 'node'
  readonly nodeId: string
  readonly property: AnimationProperty
}

/** A material-parameter target of a node's assigned material (Spec 07 R28). */
export interface NodeParameterTarget {
  readonly kind: 'node'
  readonly nodeId: string
  readonly parameter: string
}

/** A clip channel target (Spec 07 R16/R20). */
export interface ClipChannelTarget {
  readonly kind: 'clip'
  readonly clipId: string
  readonly channel: AnimationProperty
}

/**
 * A keyframe editing target. The discriminated shape supports node targets
 * and clip channel targets (Spec 07 R20).
 */
export type KeyframeTarget = NodePropertyTarget | NodeParameterTarget | ClipChannelTarget

export function isPropertyTarget(target: KeyframeTarget): target is NodePropertyTarget {
  return 'property' in target && target.kind === 'node'
}

export function isParameterTarget(target: KeyframeTarget): target is NodeParameterTarget {
  return 'parameter' in target && target.kind === 'node'
}

export function isClipChannelTarget(target: KeyframeTarget): target is ClipChannelTarget {
  return target.kind === 'clip'
}

export function requireKeyframeTarget(value: unknown): KeyframeTarget {
  if (isRecord(value) && value.kind === 'node') {
    const nodeId = requireString(value.nodeId, 'Keyframe target node id')
    if ('property' in value) {
      return { kind: 'node', nodeId, property: requireAnimationProperty(value.property) }
    }
    if ('parameter' in value) {
      return {
        kind: 'node',
        nodeId,
        parameter: requireMaterialParameterKey(value.parameter, 'Keyframe target parameter'),
      }
    }
  }
  if (isRecord(value) && value.kind === 'clip') {
    const clipId = requireString(value.clipId, 'Keyframe target clip id')
    const channel = requireAnimationProperty(value.channel)
    return { kind: 'clip', clipId, channel }
  }
  throw new Error(`Unknown keyframe target: ${JSON.stringify(value)}`)
}

export function requireClipChannelTarget(value: unknown): ClipChannelTarget {
  if (!isRecord(value) || value.kind !== 'clip') {
    throw new Error(`Expected clip channel target, got ${JSON.stringify(value)}`)
  }
  return {
    kind: 'clip',
    clipId: requireString(value.clipId, 'Clip channel target clip id'),
    channel: requireAnimationProperty(value.channel),
  }
}

/** Resolve a material-parameter key to its kind for a node, if defined. */
export type MaterialParameterKindOf = (node: SceneNode, parameterKey: string) => string | undefined

/**
 * The resolved track a target names: a uniform-six property track or a
 * material-parameter track (with the parameter's kind when the node's
 * material still defines it; orphan tracks keep their data per Spec 07 R27).
 */
export type KeyframeTrackRef =
  | { readonly kind: 'property'; readonly property: AnimationProperty }
  | { readonly kind: 'parameter'; readonly parameter: string; readonly kindOf: string | undefined }

export function resolveKeyframeTrack(
  node: SceneNode,
  target: KeyframeTarget,
  kindOf: MaterialParameterKindOf,
  hasTrack: (parameter: string) => boolean,
): KeyframeTrackRef {
  if (isClipChannelTarget(target)) {
    throw new Error('Clip channel targets cannot be resolved through node animation tracks')
  }
  if (isPropertyTarget(target)) {
    return { kind: 'property', property: requireAnimatableForNode(node, target.property) }
  }
  const parameter = requireMaterialParameterKey(target.parameter, 'Keyframe target parameter')
  const kindOfParameter = kindOf(node, parameter)
  if (kindOfParameter === undefined && !hasTrack(parameter)) {
    throw new Error(`Unknown material parameter "${parameter}" on node "${node.name}"`)
  }
  return { kind: 'parameter', parameter, kindOf: kindOfParameter }
}

/** Validate a keyframe value for a resolved track (property or material kind). */
export function requireTrackKeyframeValue(
  track: KeyframeTrackRef,
  value: unknown,
  what = 'Keyframe value',
): KeyframeValue {
  if (track.kind === 'property') {
    return requireKeyframeValue(track.property, value, what)
  }
  if (track.kindOf === undefined) {
    return requireMaterialOverrideValue(value, what)
  }
  return requireMaterialKeyframeValue(track.kindOf, value, what)
}

export function requireNodeTarget(
  target: KeyframeTarget,
): NodePropertyTarget | NodeParameterTarget {
  if (target.kind !== 'node') {
    throw new Error('This operation only supports node targets')
  }
  return target
}

/** Validate a scale factor: a non-negative finite number. */
export function requireScaleFactor(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Scale factor must be a non-negative finite number')
  }
  return value
}
