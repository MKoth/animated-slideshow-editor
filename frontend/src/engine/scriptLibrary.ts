import { isRecord, requireFiniteNumber, requireString } from './guards'
import type { ScriptFunctionJSON } from './json'

export interface ScriptLibraryEntry {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly source: string
  readonly version: number
}

export function normalizeScriptFunctionName(name: string): string {
  return name.trim().toLowerCase()
}

export function scriptLibraryEntryToJSON(entry: ScriptLibraryEntry): ScriptFunctionJSON {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    source: entry.source,
    version: entry.version,
  }
}

export function scriptLibraryEntryFromJSON(json: ScriptFunctionJSON): ScriptLibraryEntry {
  if (!isRecord(json)) {
    throw new Error('Script library entry must be an object')
  }
  return {
    id: requireString(json.id, 'Script library entry id'),
    name: requireString(json.name, 'Script library entry name'),
    description:
      json.description === undefined ? '' : requireStringAllowEmptyLocal(json.description),
    source: requireStringAllowEmptyLocal(json.source, 'Script library entry source'),
    version: requireFiniteNumber(json.version, 'Script library entry version'),
  }
}

function requireStringAllowEmptyLocal(value: unknown, what?: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${what ?? 'value'} must be a string`)
  }
  return value
}

export function validateScriptLibraryEntryJSON(
  errors: string[],
  value: unknown,
  label: string,
): void {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`)
    return
  }
  if (typeof value.id !== 'string' || value.id === '') {
    errors.push(`${label}.id must be a non-empty string`)
  }
  if (typeof value.name !== 'string' || value.name.trim() === '') {
    errors.push(`${label}.name must be a non-empty string`)
  }
  if (value.description !== undefined && typeof value.description !== 'string') {
    errors.push(`${label}.description must be a string`)
  }
  if (typeof value.source !== 'string') {
    errors.push(`${label}.source must be a string`)
  }
  if (
    typeof value.version !== 'number' ||
    !Number.isFinite(value.version) ||
    !Number.isInteger(value.version) ||
    value.version < 1
  ) {
    errors.push(`${label}.version must be an integer >= 1`)
  }
}

export function validateScriptFunctionsJSON(errors: string[], value: unknown): void {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    errors.push('Invalid lesson JSON: library.scriptFunctions must be an array')
    return
  }
  const seenIds = new Set<string>()
  const seenNames = new Set<string>()
  for (let i = 0; i < value.length; i++) {
    const entry = value[i] as unknown
    validateScriptLibraryEntryJSON(errors, entry, `library.scriptFunctions[${i}]`)
    if (isRecord(entry) && typeof entry.id === 'string' && entry.id !== '') {
      if (seenIds.has(entry.id)) {
        errors.push(`A script function with id "${entry.id}" already exists`)
      } else {
        seenIds.add(entry.id)
      }
    }
    if (isRecord(entry) && typeof entry.name === 'string' && entry.name.trim() !== '') {
      const normalized = entry.name.trim().toLowerCase()
      if (seenNames.has(normalized)) {
        errors.push(`A script function named "${entry.name}" already exists`)
      } else {
        seenNames.add(normalized)
      }
    }
  }
}

export function buildScriptLibraryEntriesFromJSON(library: unknown): ScriptLibraryEntry[] {
  if (!isRecord(library) || !Array.isArray(library.scriptFunctions)) {
    return []
  }
  const entries: ScriptLibraryEntry[] = []
  for (const raw of library.scriptFunctions) {
    try {
      entries.push(scriptLibraryEntryFromJSON(raw as ScriptFunctionJSON))
    } catch {
      // Skip invalid entries (already validated)
    }
  }
  return entries
}

export function findDuplicateScriptFunctionName(
  entries: readonly ScriptLibraryEntry[],
  name: string,
  excludeId?: string,
): ScriptLibraryEntry | null {
  const normalized = normalizeScriptFunctionName(name)
  for (const entry of entries) {
    if (excludeId !== undefined && entry.id === excludeId) continue
    if (normalizeScriptFunctionName(entry.name) === normalized) {
      return entry
    }
  }
  return null
}
