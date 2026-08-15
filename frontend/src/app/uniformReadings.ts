import { resolveParameterValue } from '../engine'
import type {
  MaterialOverrides,
  MaterialParameterDefault,
  MaterialParameterDefaultValue,
} from '../engine'

export interface UniformReading {
  readonly key: string
  readonly kind: string
  readonly default: MaterialParameterDefaultValue
  readonly effective: MaterialParameterDefaultValue
  readonly overridden: boolean
}

/** Read the editable uniforms of a definition against instance overrides. */
export function readUniformReadings(
  parameters: readonly MaterialParameterDefault[],
  overrides: MaterialOverrides,
  skipKeys: readonly string[] = [],
): UniformReading[] {
  const uniforms: UniformReading[] = []
  for (const parameter of parameters) {
    if (skipKeys.includes(parameter.key)) {
      continue
    }
    uniforms.push({
      key: parameter.key,
      kind: parameter.kind,
      default: parameter.default,
      effective:
        resolveParameterValue(parameters, overrides, parameter.key) ?? fallbackDefaultOf(parameter),
      overridden: Object.prototype.hasOwnProperty.call(overrides, parameter.key),
    })
  }
  return uniforms
}

function fallbackDefaultOf(parameter: MaterialParameterDefault): MaterialParameterDefaultValue {
  switch (parameter.kind) {
    case 'bool':
      return false
    case 'vec2':
      return [0, 0]
    case 'vec3':
      return [0, 0, 0]
    case 'vec4':
      return [0, 0, 0, 0]
    case 'sampler2D':
      return ''
    default:
      return 0
  }
}
