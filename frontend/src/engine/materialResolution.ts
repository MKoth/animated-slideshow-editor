import type { MaterialOverrides, MaterialParameterDefaultValue } from './materialInstance'

export type { MaterialParameterDefaultValue } from './materialInstance'

export const TINT_PARAMETER_KEY = 'tint'
export const OPACITY_MULTIPLIER_PARAMETER_KEY = 'opacityMultiplier'
export const DEFAULT_TINT = '#ffffff'
export const DEFAULT_OPACITY_MULTIPLIER = 1

export interface MaterialParameterDefault {
  readonly key: string
  readonly kind: string
  readonly default: MaterialParameterDefaultValue
}

export interface EffectiveMaterialScratch {
  tint: string
  opacityMultiplier: number
}

export interface EffectiveShaderScratch {
  source: string | null
  keys: string[]
  kinds: string[]
  values: (MaterialParameterDefaultValue | undefined)[]
  samplers: ShaderSamplerBinding[]
}

/** One sampler2D uniform resolved to the asset definition it samples. */
export interface ShaderSamplerBinding {
  readonly key: string
  readonly assetDefinitionId: string | null
}

export function effectiveMaterialScratch(): EffectiveMaterialScratch {
  return { tint: DEFAULT_TINT, opacityMultiplier: DEFAULT_OPACITY_MULTIPLIER }
}

export function effectiveShaderScratch(): EffectiveShaderScratch {
  return { source: null, keys: [], kinds: [], values: [], samplers: [] }
}

export function resolveMaterial(
  parameters: readonly MaterialParameterDefault[],
  overrides: MaterialOverrides,
  target: EffectiveMaterialScratch = effectiveMaterialScratch(),
): EffectiveMaterialScratch {
  target.tint = colorValue(parameters, overrides, TINT_PARAMETER_KEY)
  target.opacityMultiplier = clampOpacityMultiplier(
    numberValue(parameters, overrides, OPACITY_MULTIPLIER_PARAMETER_KEY),
  )
  return target
}

/**
 * Resolve one material parameter (built-in or shader uniform): an instance
 * override wins, otherwise the definition default applies; a parameter that
 * neither overrides nor the definition carries resolves to undefined.
 */
export function resolveParameterValue(
  parameters: readonly MaterialParameterDefault[],
  overrides: Readonly<Record<string, unknown>>,
  key: string,
): MaterialParameterDefaultValue | undefined {
  if (key in overrides) {
    return overrides[key] as MaterialParameterDefaultValue
  }
  for (const parameter of parameters) {
    if (parameter.key === key) {
      return parameter.default
    }
  }
  return undefined
}

/**
 * Resolve the shader-uniform parameters of a material definition into a
 * reusable scratch: every parameter except the built-ins (tint, opacity
 * multiplier) and samplers, with values resolved override over default.
 */
export function resolveShaderUniforms(
  parameters: readonly MaterialParameterDefault[],
  overrides: MaterialOverrides,
  target: EffectiveShaderScratch = effectiveShaderScratch(),
): EffectiveShaderScratch {
  clearShaderUniforms(target)
  for (const parameter of parameters) {
    if (
      parameter.key === TINT_PARAMETER_KEY ||
      parameter.key === OPACITY_MULTIPLIER_PARAMETER_KEY
    ) {
      continue
    }
    if (parameter.kind === 'sampler2D') {
      const value = resolveParameterValue(parameters, overrides, parameter.key)
      target.samplers.push({
        key: parameter.key,
        assetDefinitionId: typeof value === 'string' && value !== '' ? value : null,
      })
      continue
    }
    target.keys.push(parameter.key)
    target.kinds.push(parameter.kind)
    target.values.push(resolveParameterValue(parameters, overrides, parameter.key))
  }
  return target
}

/** Whether two resolved uniform states carry the same keys, kinds, values and samplers. */
export function shaderUniformsEqual(
  previous: EffectiveShaderScratch | undefined,
  next: EffectiveShaderScratch,
): boolean {
  if (
    !previous ||
    previous.source !== next.source ||
    previous.keys.length !== next.keys.length ||
    previous.samplers.length !== next.samplers.length
  ) {
    return false
  }
  for (let index = 0; index < next.keys.length; index++) {
    if (previous.keys[index] !== next.keys[index]) {
      return false
    }
    if (previous.kinds[index] !== next.kinds[index]) {
      return false
    }
    if (!uniformValuesEqual(previous.values[index], next.values[index])) {
      return false
    }
  }
  for (let index = 0; index < next.samplers.length; index++) {
    if (
      previous.samplers[index].key !== next.samplers[index].key ||
      previous.samplers[index].assetDefinitionId !== next.samplers[index].assetDefinitionId
    ) {
      return false
    }
  }
  return true
}

/** Copy one resolved uniform state into a reusable target scratch. */
export function copyShaderUniforms(
  target: EffectiveShaderScratch,
  source: EffectiveShaderScratch,
): void {
  clearShaderUniforms(target)
  target.source = source.source
  for (let index = 0; index < source.keys.length; index++) {
    target.keys.push(source.keys[index])
    target.kinds.push(source.kinds[index])
    target.values.push(source.values[index])
  }
  for (const sampler of source.samplers) {
    target.samplers.push({ key: sampler.key, assetDefinitionId: sampler.assetDefinitionId })
  }
}

function clearShaderUniforms(target: EffectiveShaderScratch): void {
  target.keys.length = 0
  target.kinds.length = 0
  target.values.length = 0
  target.samplers.length = 0
}

export function uniformValuesEqual(
  first: MaterialParameterDefaultValue | undefined,
  second: MaterialParameterDefaultValue | undefined,
): boolean {
  if (first === second) {
    return true
  }
  if (Array.isArray(first) && Array.isArray(second)) {
    if (first.length !== second.length) {
      return false
    }
    for (let index = 0; index < first.length; index++) {
      if (first[index] !== second[index]) {
        return false
      }
    }
    return true
  }
  return false
}

function clampOpacityMultiplier(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

function colorValue(
  parameters: readonly MaterialParameterDefault[],
  overrides: MaterialOverrides,
  key: string,
): string {
  if (typeof overrides[key] === 'string') {
    return overrides[key] as string
  }
  for (const parameter of parameters) {
    if (parameter.key === key && typeof parameter.default === 'string') {
      return parameter.default
    }
  }
  return DEFAULT_TINT
}

function numberValue(
  parameters: readonly MaterialParameterDefault[],
  overrides: MaterialOverrides,
  key: string,
): number {
  if (typeof overrides[key] === 'number') {
    return overrides[key] as number
  }
  for (const parameter of parameters) {
    if (parameter.key === key && typeof parameter.default === 'number') {
      return parameter.default
    }
  }
  return DEFAULT_OPACITY_MULTIPLIER
}
