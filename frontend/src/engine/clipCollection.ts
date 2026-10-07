import { newId } from './ids'
import { isRecord, requireString } from './guards'
import type { ClipCollectionJSON } from './json'

export interface ClipCollectionBindings {
  readonly [semanticName: string]: string
}

export interface ClipCollectionAlignmentOffset {
  readonly x: number
  readonly y: number
}

export type ClipCollectionAlignmentOffsets = Readonly<Record<string, ClipCollectionAlignmentOffset>>

export class ClipCollection {
  readonly id: string
  #name: string
  #bindings: Map<string, string>
  #sourceNodeId?: string
  #category: string
  #alignmentOffsets: Record<string, ClipCollectionAlignmentOffset>

  constructor(
    id: string,
    name: string,
    bindings: ReadonlyMap<string, string> | Record<string, string>,
    sourceNodeId?: string,
    category?: string,
    alignmentOffsets: ClipCollectionAlignmentOffsets = {},
  ) {
    this.id = id
    this.#name = name
    if (bindings instanceof Map) {
      this.#bindings = new Map(bindings)
    } else {
      this.#bindings = new Map(Object.entries(bindings))
    }
    if (sourceNodeId !== undefined) {
      this.#sourceNodeId = sourceNodeId
    }
    this.#category = normalizeCollectionCategory(category)
    this.#alignmentOffsets = normalizeAlignmentOffsets(alignmentOffsets)
  }

  get name(): string {
    return this.#name
  }

  set name(value: string) {
    this.#name = value
  }

  get sourceNodeId(): string | undefined {
    return this.#sourceNodeId
  }

  set sourceNodeId(value: string | undefined) {
    this.#sourceNodeId = value
  }

  get category(): string {
    return this.#category
  }

  get alignmentOffsets(): ClipCollectionAlignmentOffsets {
    return this.#alignmentOffsets
  }

  setAlignmentOffsets(offsets: ClipCollectionAlignmentOffsets): void {
    this.#alignmentOffsets = normalizeAlignmentOffsets(offsets)
  }

  getAlignmentOffset(semanticName: string): ClipCollectionAlignmentOffset | undefined {
    return this.#alignmentOffsets[semanticName]
  }

  set category(value: string) {
    this.#category = normalizeCollectionCategory(value)
  }

  get bindings(): ReadonlyMap<string, string> {
    return this.#bindings
  }

  getBindingsObject(): Record<string, string> {
    return Object.fromEntries(this.#bindings)
  }

  hasBinding(semanticName: string): boolean {
    return this.#bindings.has(semanticName)
  }

  getBinding(semanticName: string): string | undefined {
    return this.#bindings.get(semanticName)
  }

  setBinding(semanticName: string, clipId: string): void {
    requireString(semanticName, 'Semantic name')
    if (semanticName.trim() === '') throw new Error('Semantic name must not be empty')
    requireString(clipId, 'Clip id')
    this.#bindings.set(semanticName.trim(), clipId)
  }

  deleteBinding(semanticName: string): boolean {
    return this.#bindings.delete(semanticName)
  }

  copy(): ClipCollection {
    return new ClipCollection(
      this.id,
      this.#name,
      new Map(this.#bindings),
      this.#sourceNodeId,
      this.#category,
      this.#alignmentOffsets,
    )
  }

  toJSON(): ClipCollectionJSON {
    return {
      id: this.id,
      name: this.#name,
      bindings: Object.fromEntries(this.#bindings),
      ...(this.#sourceNodeId !== undefined ? { sourceNodeId: this.#sourceNodeId } : {}),
      ...(this.#category !== '' ? { category: this.#category } : {}),
      ...(Object.keys(this.#alignmentOffsets).length > 0
        ? { alignmentOffsets: { ...this.#alignmentOffsets } }
        : {}),
    }
  }

  static fromJSON(json: unknown): ClipCollection {
    if (!isRecord(json)) throw new Error('ClipCollection must be an object')
    const id = requireString(json.id, 'ClipCollection id')
    const name = requireString(json.name, 'ClipCollection name')
    if (!isRecord(json.bindings)) throw new Error('ClipCollection bindings must be an object')
    const bindings = new Map<string, string>()
    for (const [k, v] of Object.entries(json.bindings as Record<string, unknown>)) {
      if (typeof k !== 'string' || k.trim() === '') {
        throw new Error('ClipCollection binding key must be a non-empty string')
      }
      if (typeof v !== 'string' || v.trim() === '') {
        throw new Error(`ClipCollection binding "${k}" must be a non-empty string clipId`)
      }
      const trimmedKey = k.trim()
      if (bindings.has(trimmedKey)) {
        throw new Error(`Duplicate ClipCollection binding key: "${trimmedKey}"`)
      }
      bindings.set(trimmedKey, v)
    }
    let sourceNodeId: string | undefined
    if (json.sourceNodeId !== undefined) {
      if (typeof json.sourceNodeId !== 'string' || json.sourceNodeId.trim() === '') {
        throw new Error('ClipCollection sourceNodeId must be a non-empty string if provided')
      }
      sourceNodeId = json.sourceNodeId
    }
    let category = ''
    if (json.category !== undefined) {
      if (typeof json.category !== 'string') {
        throw new Error('ClipCollection category must be a string if provided')
      }
      category = normalizeCollectionCategory(json.category)
    }
    const alignmentOffsets =
      json.alignmentOffsets === undefined ? {} : normalizeAlignmentOffsets(json.alignmentOffsets)
    return new ClipCollection(id, name, bindings, sourceNodeId, category, alignmentOffsets)
  }
}

export function normalizeAlignmentOffsets(
  value: unknown,
): Record<string, ClipCollectionAlignmentOffset> {
  if (!isRecord(value)) throw new Error('ClipCollection alignmentOffsets must be an object')
  const result: Record<string, ClipCollectionAlignmentOffset> = {}
  for (const [semanticName, raw] of Object.entries(value)) {
    if (semanticName.trim() === '')
      throw new Error('Alignment offset semantic name must not be empty')
    if (!isRecord(raw)) throw new Error(`Alignment offset for "${semanticName}" must be an object`)
    const x = raw.x
    const y = raw.y
    if (
      typeof x !== 'number' ||
      !Number.isFinite(x) ||
      typeof y !== 'number' ||
      !Number.isFinite(y)
    ) {
      throw new Error(`Alignment offset for "${semanticName}" must have finite x and y values`)
    }
    if (x !== 0 || y !== 0) result[semanticName.trim()] = { x, y }
  }
  return result
}

export function normalizeCollectionCategory(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function newClipCollectionId(): string {
  return newId('clipCollection')
}

export function validateClipCollectionBindings(bindings: unknown): Record<string, string> {
  if (!isRecord(bindings)) throw new Error('ClipCollection bindings must be an object')
  const result: Record<string, string> = {}
  for (const [k, v] of Object.entries(bindings)) {
    if (typeof k !== 'string' || k.trim() === '')
      throw new Error('Binding key must be non-empty string')
    if (typeof v !== 'string' || v === '')
      throw new Error(`Binding value for "${k}" must be non-empty string`)
    result[k.trim()] = v
  }
  return result
}
