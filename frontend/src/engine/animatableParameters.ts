import { ANIMATABLE_PROPERTIES, type AnimationProperty } from './animationProperties'
import type { MaterialParameterDefault } from './materialResolution'
import { TINT_PARAMETER_KEY, OPACITY_MULTIPLIER_PARAMETER_KEY } from './materialResolution'
import { RESERVED_TIME_UNIFORM } from '../shaders/reflection'

/** Describes one animatable value on a scene node. */
export interface AnimatableParameter {
  /** The property key (e.g. 'positionX', 'tint'). */
  readonly key: string
  /** Human-readable label for UI display. */
  readonly label: string
  /** The value kind (e.g. 'number', 'color', 'vec2'). */
  readonly kind: string
  /** Whether the parameter comes from the standard six or from the node's material. */
  readonly source: 'standard' | 'material'
  /** True when the node already has keyframes on this parameter's track. */
  readonly linked: boolean
}

const STANDARD_LABELS: Readonly<Record<AnimationProperty, string>> = {
  positionX: 'Position X',
  positionY: 'Position Y',
  rotation: 'Rotation',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
  opacity: 'Opacity',
}

const BUILT_IN_MATERIAL_KEYS = new Set<string>([
  TINT_PARAMETER_KEY,
  OPACITY_MULTIPLIER_PARAMETER_KEY,
  RESERVED_TIME_UNIFORM,
])

/**
 * Discover all animatable parameters available on a scene node.
 *
 * Returns the six standard transform/opacity properties plus any material
 * parameters (tint, opacityMultiplier, custom shader uniforms) defined on the
 * node's assigned material. Sampler2D parameters are excluded because they
 * cannot be animated.
 *
 * @param node                    The scene node to inspect.
 * @param materialParameters      The resolved parameters of the node's
 *                                material definition (empty when no material
 *                                is assigned).
 * @param hasPropertyTrack        Returns true when the node already has
 *                                keyframes on the given standard property.
 * @param hasMaterialTrack        Returns true when the node already has
 *                                keyframes on the given material parameter.
 */
export function getAnimatableParameters(
  node: {
    readonly components: { readonly camera?: unknown; readonly bone?: unknown }
  },
  materialParameters: readonly MaterialParameterDefault[],
  hasPropertyTrack: (property: AnimationProperty) => boolean,
  hasMaterialTrack: (parameter: string) => boolean,
): AnimatableParameter[] {
  const result: AnimatableParameter[] = []

  for (const property of ANIMATABLE_PROPERTIES) {
    if (node.components.camera && property === 'rotation') {
      continue
    }
    if (node.components.bone && property === 'opacity') {
      continue
    }
    result.push({
      key: property,
      label: STANDARD_LABELS[property],
      kind: 'number',
      source: 'standard',
      linked: hasPropertyTrack(property),
    })
  }

  for (const param of materialParameters) {
    if (BUILT_IN_MATERIAL_KEYS.has(param.key)) {
      continue
    }
    if (param.kind === 'sampler2D') {
      continue
    }
    result.push({
      key: param.key,
      label: formatMaterialLabel(param.key),
      kind: param.kind,
      source: 'material',
      linked: hasMaterialTrack(param.key),
    })
  }

  return result
}

/** Convert a camelCase or snake_case key into a human-readable label. */
function formatMaterialLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^./, (char) => char.toUpperCase())
    .trim()
}
