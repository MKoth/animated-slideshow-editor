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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
