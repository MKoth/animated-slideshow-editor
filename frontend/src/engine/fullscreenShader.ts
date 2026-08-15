import type { FullscreenShaderJSON } from './json'
import { isRecord, requireOverrides, requireString } from './guards'

export interface FullscreenShaderReference {
  readonly shaderDefinitionId: string
  readonly overrides: Readonly<Record<string, string | number | boolean | readonly number[]>>
}

export function fullscreenShaderToJSON(reference: FullscreenShaderReference): FullscreenShaderJSON {
  return {
    shaderDefinitionId: reference.shaderDefinitionId,
    overrides: { ...reference.overrides },
  }
}

export function fullscreenShaderFromJSON(value: unknown, what: string): FullscreenShaderReference {
  if (!isRecord(value)) {
    throw new Error(`${what} must be an object`)
  }
  const shaderDefinitionId = requireString(value.shaderDefinitionId, `${what} shaderDefinitionId`)
  const overrides = requireOverrides(value.overrides, `${what} overrides`)
  return { shaderDefinitionId, overrides }
}
