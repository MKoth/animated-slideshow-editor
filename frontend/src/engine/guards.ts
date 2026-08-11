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

export function requireFiniteNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${what} must be a finite number`)
  }
  return value
}

export function requireBoolean(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${what} must be a boolean`)
  }
  return value
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
