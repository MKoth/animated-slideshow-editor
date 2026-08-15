import type { MaterialParameterDefault } from './materialResolution'
import { isOverrideValue } from './guards'

export interface EmbeddedShaderDefinition {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly tags: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
  readonly source: string
  readonly defaultUniforms: readonly Readonly<Record<string, unknown>>[]
  readonly isBuiltin: boolean
}

/** Normalize a shader definition's default uniforms into engine parameter defaults. */
export function embeddedShaderParameters(
  uniforms: readonly Readonly<Record<string, unknown>>[],
): readonly MaterialParameterDefault[] {
  const parameters: MaterialParameterDefault[] = []
  for (const uniform of uniforms) {
    if (typeof uniform.key !== 'string' || uniform.key === '' || typeof uniform.kind !== 'string') {
      continue
    }
    if (!isOverrideValue(uniform.default)) {
      continue
    }
    parameters.push({ key: uniform.key, kind: uniform.kind, default: uniform.default })
  }
  return parameters
}
