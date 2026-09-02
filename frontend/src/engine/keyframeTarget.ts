import type { SceneNode } from './sceneNode'
import type {
  AnimationProperty,
  CircleAnimationProperty,
  TableAnimationProperty,
} from './animationProperties'
import {
  requireAnimationProperty,
  requireAnimatableForNode,
  requireCircleAnimationProperty,
  requireAnimatableForCircle,
  requireCircleKeyframeValue,
  requireKeyframeValue,
  requireTableAnimationProperty,
  requireAnimatableForTable,
  requireTableKeyframeValue,
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

/** A data-label target of a node's chart component. */
export interface NodeDataLabelTarget {
  readonly kind: 'dataLabel'
  readonly nodeId: string
  readonly label: string
}

/** A circle-angle target of a node's circle component. */
export interface NodeCircleTarget {
  readonly kind: 'circle'
  readonly nodeId: string
  readonly property: CircleAnimationProperty
}

/** A table-style target for table/row/cell nodes. */
export interface NodeTableTarget {
  readonly kind: 'table'
  readonly nodeId: string
  readonly property: TableAnimationProperty
}

/** A clip channel target (Spec 07 R16/R20). */
export interface ClipChannelTarget {
  readonly kind: 'clip'
  readonly clipId: string
  readonly channel: AnimationProperty
}

/**
 * A keyframe editing target. The discriminated shape supports node targets,
 * data-label targets, circle targets and clip channel targets (Spec 07 R20).
 */
export type KeyframeTarget =
  | NodePropertyTarget
  | NodeParameterTarget
  | NodeDataLabelTarget
  | NodeCircleTarget
  | NodeTableTarget
  | ClipChannelTarget

export function isPropertyTarget(target: KeyframeTarget): target is NodePropertyTarget {
  return 'property' in target && target.kind === 'node'
}

export function isParameterTarget(target: KeyframeTarget): target is NodeParameterTarget {
  return 'parameter' in target && target.kind === 'node'
}

export function isDataLabelTarget(target: KeyframeTarget): target is NodeDataLabelTarget {
  return target.kind === 'dataLabel'
}

export function isClipChannelTarget(target: KeyframeTarget): target is ClipChannelTarget {
  return target.kind === 'clip'
}

export function isCircleTarget(target: KeyframeTarget): target is NodeCircleTarget {
  return target.kind === 'circle'
}

export function isTableTarget(target: KeyframeTarget): target is NodeTableTarget {
  return target.kind === 'table'
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
  if (isRecord(value) && value.kind === 'dataLabel') {
    const nodeId = requireString(value.nodeId, 'Data label target node id')
    const label = requireString(value.label, 'Data label target label')
    return { kind: 'dataLabel', nodeId, label }
  }
  if (isRecord(value) && value.kind === 'circle') {
    const nodeId = requireString(value.nodeId, 'Circle target node id')
    const property = requireCircleAnimationProperty(value.property)
    return { kind: 'circle', nodeId, property }
  }
  if (isRecord(value) && value.kind === 'table') {
    const nodeId = requireString(value.nodeId, 'Table target node id')
    const property = requireTableAnimationProperty(value.property)
    return { kind: 'table', nodeId, property }
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
 * The resolved track a target names: a uniform-six property track, a
 * material-parameter track, a data-label track, or a circle track.
 */
export type KeyframeTrackRef =
  | { readonly kind: 'property'; readonly property: AnimationProperty }
  | { readonly kind: 'parameter'; readonly parameter: string; readonly kindOf: string | undefined }
  | { readonly kind: 'dataLabel'; readonly label: string }
  | { readonly kind: 'circle'; readonly property: CircleAnimationProperty }
  | { readonly kind: 'table'; readonly property: TableAnimationProperty }

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
  if (isDataLabelTarget(target)) {
    return { kind: 'dataLabel', label: target.label }
  }
  if (isCircleTarget(target)) {
    return { kind: 'circle', property: requireAnimatableForCircle(node, target.property) }
  }
  if (isTableTarget(target)) {
    return { kind: 'table', property: requireAnimatableForTable(node, target.property) }
  }
  const parameter = requireMaterialParameterKey(
    (target as NodeParameterTarget).parameter,
    'Keyframe target parameter',
  )
  const kindOfParameter = kindOf(node, parameter)
  if (kindOfParameter === undefined && !hasTrack(parameter)) {
    throw new Error(`Unknown material parameter "${parameter}" on node "${node.name}"`)
  }
  return { kind: 'parameter', parameter, kindOf: kindOfParameter }
}

/** Validate a keyframe value for a resolved track (property, material kind, or data label). */
export function requireTrackKeyframeValue(
  track: KeyframeTrackRef,
  value: unknown,
  what = 'Keyframe value',
): KeyframeValue {
  if (track.kind === 'property') {
    return requireKeyframeValue(track.property, value, what)
  }
  if (track.kind === 'dataLabel') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${what} must be a finite number for data label "${track.label}"`)
    }
    return value
  }
  if (track.kind === 'circle') {
    return requireCircleKeyframeValue(track.property, value, what)
  }
  if (track.kind === 'table') {
    return requireTableKeyframeValue(track.property, value, what)
  }
  if (track.kindOf === undefined) {
    return requireMaterialOverrideValue(value, what)
  }
  return requireMaterialKeyframeValue(track.kindOf, value, what)
}

export function requireNodeTarget(
  target: KeyframeTarget,
):
  | NodePropertyTarget
  | NodeParameterTarget
  | NodeDataLabelTarget
  | NodeCircleTarget
  | NodeTableTarget {
  if (
    target.kind !== 'node' &&
    target.kind !== 'dataLabel' &&
    target.kind !== 'circle' &&
    target.kind !== 'table'
  ) {
    throw new Error('This operation only supports node targets')
  }
  return target as
    | NodePropertyTarget
    | NodeParameterTarget
    | NodeDataLabelTarget
    | NodeCircleTarget
    | NodeTableTarget
}

/** Validate a scale factor: a non-negative finite number. */
export function requireScaleFactor(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Scale factor must be a non-negative finite number')
  }
  return value
}
