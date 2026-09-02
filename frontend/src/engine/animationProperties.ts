import type { SceneNode } from './sceneNode'
import { requireFiniteNumber, requireOpacity } from './guards'

export const ANIMATABLE_PROPERTIES = [
  'positionX',
  'positionY',
  'rotation',
  'scaleX',
  'scaleY',
  'opacity',
] as const

/** Bone nodes animate the five transform properties only — no opacity. */
export const BONE_ANIMATABLE_PROPERTIES = [
  'positionX',
  'positionY',
  'rotation',
  'scaleX',
  'scaleY',
] as const

export const CIRCLE_ANIMATABLE_PROPERTIES = [
  'radius',
  'startAngle',
  'endAngle',
  'segments',
] as const

export const TABLE_ANIMATABLE_PROPERTIES = ['borderRadius', 'padding'] as const

export type AnimationProperty = (typeof ANIMATABLE_PROPERTIES)[number]

export type CircleAnimationProperty = (typeof CIRCLE_ANIMATABLE_PROPERTIES)[number]

export type TableAnimationProperty = (typeof TABLE_ANIMATABLE_PROPERTIES)[number]

/** The subset of AnimationProperty that bones support. */
export type BoneAnimationProperty = (typeof BONE_ANIMATABLE_PROPERTIES)[number]

const ANIMATABLE_PROPERTY_VALUES: readonly string[] = ANIMATABLE_PROPERTIES
const CIRCLE_ANIMATABLE_PROPERTY_VALUES: readonly string[] = CIRCLE_ANIMATABLE_PROPERTIES
const TABLE_ANIMATABLE_PROPERTY_VALUES: readonly string[] = TABLE_ANIMATABLE_PROPERTIES

export function requireAnimationProperty(value: unknown): AnimationProperty {
  if (
    typeof value !== 'string' ||
    !(ANIMATABLE_PROPERTY_VALUES as readonly string[]).includes(value)
  ) {
    throw new Error(`Unknown animation property: ${String(value)}`)
  }
  return value as AnimationProperty
}

export function requireCircleAnimationProperty(value: unknown): CircleAnimationProperty {
  if (
    typeof value !== 'string' ||
    !(CIRCLE_ANIMATABLE_PROPERTY_VALUES as readonly string[]).includes(value)
  ) {
    throw new Error(`Unknown circle animation property: ${String(value)}`)
  }
  return value as CircleAnimationProperty
}

export function requireAnimatableForNode(node: SceneNode, property: unknown): AnimationProperty {
  const bounded = requireAnimationProperty(property)
  if (node.components.camera && bounded === 'rotation') {
    throw new Error('Camera rotation is not animatable')
  }
  if (node.components.bone && bounded === 'opacity') {
    throw new Error('Bone opacity is not animatable')
  }
  return bounded
}

export function requireKeyframeTime(
  time: unknown,
  duration: number,
  what = 'Keyframe time',
): number {
  const bounded = requireFiniteNumber(time, what)
  if (duration < 0 || !Number.isFinite(duration)) {
    throw new Error('Slide duration must be a non-negative finite number')
  }
  if (bounded < 0 || bounded > duration) {
    throw new Error(`${what} must be within [0, ${duration}]`)
  }
  return bounded
}

export function requireKeyframeValue(
  property: AnimationProperty,
  value: unknown,
  what = 'Keyframe value',
): number {
  if (property === 'opacity') {
    return requireOpacity(value, `${what} (opacity)`)
  }
  return requireFiniteNumber(value, what)
}

export function requireCircleKeyframeValue(
  _property: CircleAnimationProperty,
  value: unknown,
  what = 'Keyframe value',
): number {
  const num = requireFiniteNumber(value, what)
  // Angles are 0..360, but allow any finite for interpolation; clamp validation will enforce on set.
  // We keep permissive here to allow intermediate evaluated values outside range.
  return num
}

export function requireAnimatableForCircle(
  node: SceneNode,
  property: unknown,
): CircleAnimationProperty {
  const bounded = requireCircleAnimationProperty(property)
  if (!node.components.circle) {
    throw new Error(`Node "${node.name}" does not have a circle component`)
  }
  return bounded
}

export function requireTableAnimationProperty(value: unknown): TableAnimationProperty {
  if (
    typeof value !== 'string' ||
    !(TABLE_ANIMATABLE_PROPERTY_VALUES as readonly string[]).includes(value)
  ) {
    throw new Error(`Unknown table animation property: ${String(value)}`)
  }
  return value as TableAnimationProperty
}

export function requireTableKeyframeValue(
  _property: TableAnimationProperty,
  value: unknown,
  what = 'Keyframe value',
): number {
  const num = requireFiniteNumber(value, what)
  if (num < 0) {
    throw new Error(`${what} must be a non-negative number`)
  }
  return num
}

export function requireAnimatableForTable(
  node: SceneNode,
  property: unknown,
): TableAnimationProperty {
  const bounded = requireTableAnimationProperty(property)
  if (!node.components.table && !node.components.tableCell && !node.components.tableRow) {
    throw new Error(`Node "${node.name}" does not have a table, row, or cell component`)
  }
  return bounded
}
