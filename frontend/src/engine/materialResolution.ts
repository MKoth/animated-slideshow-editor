import type { MaterialOverrides } from './materialInstance'

export const TINT_PARAMETER_KEY = 'tint'
export const OPACITY_MULTIPLIER_PARAMETER_KEY = 'opacityMultiplier'
export const DEFAULT_TINT = '#ffffff'
export const DEFAULT_OPACITY_MULTIPLIER = 1

export type MaterialParameterDefaultValue = string | number | boolean | readonly number[]

export interface MaterialParameterDefault {
  readonly key: string
  readonly kind: string
  readonly default: MaterialParameterDefaultValue
}

export interface EffectiveMaterialScratch {
  tint: string
  opacityMultiplier: number
}

export function effectiveMaterialScratch(): EffectiveMaterialScratch {
  return { tint: DEFAULT_TINT, opacityMultiplier: DEFAULT_OPACITY_MULTIPLIER }
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
