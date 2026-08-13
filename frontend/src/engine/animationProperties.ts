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

export type AnimationProperty = (typeof ANIMATABLE_PROPERTIES)[number]

const ANIMATABLE_PROPERTY_VALUES: readonly string[] = ANIMATABLE_PROPERTIES

export function requireAnimationProperty(value: unknown): AnimationProperty {
  if (
    typeof value !== 'string' ||
    !(ANIMATABLE_PROPERTY_VALUES as readonly string[]).includes(value)
  ) {
    throw new Error(`Unknown animation property: ${String(value)}`)
  }
  return value as AnimationProperty
}

export function requireAnimatableForNode(node: SceneNode, property: unknown): AnimationProperty {
  const bounded = requireAnimationProperty(property)
  if (node.components.camera && bounded === 'rotation') {
    throw new Error('Camera rotation is not animatable')
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
