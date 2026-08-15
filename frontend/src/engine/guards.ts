export function requireString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${what} must be a non-empty string`)
  }
  return value
}

export function requireStringAllowEmpty(value: unknown, what: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${what} must be a string`)
  }
  return value
}

export function requireNonEmpty(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${what} must not be empty`)
  }
  return value
}

export function requireFiniteNumber(
  value: unknown,
  what: string,
  predicate: (value: number) => boolean = () => true,
  description = 'finite number',
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !predicate(value)) {
    throw new Error(`${what} must be a ${description}`)
  }
  return value
}

export function requireBoolean(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${what} must be a boolean`)
  }
  return value
}

export function requireOpacity(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${what} must be a number between 0 and 1`)
  }
  return value
}

export function requireMaterialParameterKey(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${what} must be a non-empty string`)
  }
  return value
}

export function isOverrideValue(value: unknown): value is string | number | boolean | number[] {
  if (typeof value === 'number') {
    return Number.isFinite(value)
  }
  if (typeof value === 'boolean') {
    return true
  }
  if (Array.isArray(value)) {
    return value.every((component) => typeof component === 'number' && Number.isFinite(component))
  }
  return typeof value === 'string' && value !== ''
}

export function requireMaterialOverrideValue(
  value: unknown,
  what: string,
): string | number | boolean | number[] {
  if (isOverrideValue(value)) {
    return value
  }
  throw new Error(
    `${what} must be a non-empty string, a finite number, a boolean, or a number array`,
  )
}

export function requireOverrides(
  value: unknown,
  what: string,
): Record<string, string | number | boolean | number[]> {
  if (value === undefined) {
    return {}
  }
  if (!isRecord(value)) {
    throw new Error(`${what} must be an object`)
  }
  const overrides: Record<string, string | number | boolean | number[]> = {}
  for (const [key, entry] of Object.entries(value)) {
    overrides[key] = requireMaterialOverrideValue(entry, `${what} value for "${key}"`)
  }
  return overrides
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
