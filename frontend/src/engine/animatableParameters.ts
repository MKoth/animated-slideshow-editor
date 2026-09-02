import {
  ANIMATABLE_PROPERTIES,
  CIRCLE_ANIMATABLE_PROPERTIES,
  type AnimationProperty,
  type CircleAnimationProperty,
} from './animationProperties'
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
  /** Whether the parameter comes from the standard six, material, or data label. */
  readonly source: 'standard' | 'material' | 'dataLabel' | 'circle'
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

const CIRCLE_LABELS: Readonly<Record<CircleAnimationProperty, string>> = {
  radius: 'Radius',
  startAngle: 'Start Angle',
  endAngle: 'End Angle',
  segments: 'Segments',
}

const BUILT_IN_MATERIAL_KEYS = new Set<string>([
  TINT_PARAMETER_KEY,
  OPACITY_MULTIPLIER_PARAMETER_KEY,
  RESERVED_TIME_UNIFORM,
])

/**
 * Discover all animatable parameters available on a scene node.
 *
 * Returns the six standard transform/opacity properties, any material
 * parameters (tint, opacityMultiplier, custom shader uniforms) defined on the
 * node's assigned material, and any data labels on the node's chart component.
 * Sampler2D parameters are excluded because they cannot be animated.
 *
 * @param node                    The scene node to inspect.
 * @param materialParameters      The resolved parameters of the node's
 *                                material definition (empty when no material
 *                                is assigned).
 * @param hasPropertyTrack        Returns true when the node already has
 *                                keyframes on the given standard property.
 * @param hasMaterialTrack        Returns true when the node already has
 *                                keyframes on the given material parameter.
 * @param dataLabels              The data labels from the node's chart component (empty when no chart).
 * @param hasDataLabelTrack       Returns true when the node already has
 *                                keyframes on the given data label.
 */
export function getAnimatableParameters(
  node: {
    readonly components: {
      readonly camera?: unknown
      readonly bone?: unknown
      readonly chart?: { readonly dataLabels?: readonly string[] }
      readonly circle?: unknown
    }
  },
  materialParameters: readonly MaterialParameterDefault[],
  hasPropertyTrack: (property: AnimationProperty) => boolean,
  hasMaterialTrack: (parameter: string) => boolean,
  hasDataLabelTrack?: (label: string) => boolean,
  hasCircleTrack?: (property: CircleAnimationProperty) => boolean,
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

  const chart = node.components.chart
  if (chart?.dataLabels && hasDataLabelTrack) {
    for (const label of chart.dataLabels) {
      result.push({
        key: `data:${label}`,
        label,
        kind: 'number',
        source: 'dataLabel',
        linked: hasDataLabelTrack(label),
      })
    }
  }

  if (node.components.circle) {
    for (const property of CIRCLE_ANIMATABLE_PROPERTIES) {
      result.push({
        key: `circle:${property}`,
        label: CIRCLE_LABELS[property],
        kind: 'number',
        source: 'circle',
        linked: hasCircleTrack ? hasCircleTrack(property) : false,
      })
    }
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
