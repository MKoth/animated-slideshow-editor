function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null ||
    value === undefined
  ) {
    return String(value)
  }
  return JSON.stringify(value)
}

export function formatParameters(parameters: Readonly<Record<string, unknown>>): string {
  return Object.entries(parameters)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(' ')
}
