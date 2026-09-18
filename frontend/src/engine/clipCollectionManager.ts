import type { EventBus } from './events'
import { ClipCollection, newClipCollectionId, normalizeCollectionCategory } from './clipCollection'

export class ClipCollectionManager {
  readonly #bus: EventBus
  readonly #collections = new Map<string, ClipCollection>()

  constructor(bus: EventBus) {
    this.#bus = bus
  }

  get collections(): readonly ClipCollection[] {
    return [...this.#collections.values()]
  }

  getCollection(collectionId: string): ClipCollection {
    const c = this.#collections.get(collectionId)
    if (!c) throw new Error(`ClipCollection not found: ${collectionId}`)
    return c
  }

  hasCollection(collectionId: string): boolean {
    return this.#collections.has(collectionId)
  }

  static normalizeCollectionName(name: string): string {
    return name.trim().toLowerCase()
  }

  static rigKey(sourceNodeId?: string): string {
    return sourceNodeId ?? '__global__'
  }

  findByRigAndName(sourceNodeId: string | undefined, name: string): ClipCollection | undefined {
    const wanted = ClipCollectionManager.normalizeCollectionName(name)
    const rig = ClipCollectionManager.rigKey(sourceNodeId)
    for (const c of this.#collections.values()) {
      if (
        ClipCollectionManager.rigKey(c.sourceNodeId) === rig &&
        ClipCollectionManager.normalizeCollectionName(c.name) === wanted
      ) {
        return c
      }
    }
    return undefined
  }

  createCollection(
    name: string,
    bindings: Record<string, string>,
    sourceNodeId?: string,
    category?: string,
  ): ClipCollection {
    const trimmed = name.trim()
    if (trimmed === '') throw new Error('ClipCollection name must not be empty')
    const existing = this.findByRigAndName(sourceNodeId, trimmed)
    if (existing) {
      throw new Error(
        `A collection named "${existing.name}" already exists on this rig. Rename the new collection or replace the existing one.`,
      )
    }
    const id = newClipCollectionId()
    const collection = new ClipCollection(
      id,
      trimmed,
      bindings,
      sourceNodeId,
      normalizeCollectionCategory(category),
    )
    this.#collections.set(id, collection)
    this.#bus.emit({
      type: 'ClipCollectionCreated',
      collectionId: id,
    } as unknown as import('./events').EngineEvent)
    return collection
  }

  importCollection(collection: ClipCollection): void {
    this.#collections.set(collection.id, collection)
    // no event for import (used during restore)
  }

  deleteCollection(collectionId: string): ClipCollection {
    const c = this.getCollection(collectionId)
    this.#collections.delete(collectionId)
    this.#bus.emit({
      type: 'ClipCollectionRemoved',
      collectionId,
    } as unknown as import('./events').EngineEvent)
    return c
  }

  renameCollection(collectionId: string, name: string): void {
    const c = this.getCollection(collectionId)
    const trimmed = name.trim()
    if (trimmed === '') throw new Error('ClipCollection name must not be empty')
    const existing = this.findByRigAndName(c.sourceNodeId, trimmed)
    if (existing && existing.id !== collectionId) {
      throw new Error(
        `A collection named "${existing.name}" already exists on this rig. Choose a different name.`,
      )
    }
    c.name = trimmed
    this.#bus.emit({
      type: 'ClipCollectionRenamed',
      collectionId,
    } as unknown as import('./events').EngineEvent)
  }

  /**
   * Migration helper: collapse legacy duplicates sharing the same rig + name.
   * Keeps the last collection (latest edits) and returns removed ids.
   * Identity remains the collection id; hierarchy/bindings alone never dedupe.
   */
  deduplicateByRigAndName(): string[] {
    const seen = new Map<string, ClipCollection>()
    const removed: string[] = []
    for (const c of [...this.#collections.values()]) {
      const key = `${ClipCollectionManager.rigKey(c.sourceNodeId)}::${ClipCollectionManager.normalizeCollectionName(c.name)}`
      const prev = seen.get(key)
      if (!prev) {
        seen.set(key, c)
        continue
      }
      // Keep the later entry (current iteration), drop the earlier one.
      try {
        this.#collections.delete(prev.id)
        removed.push(prev.id)
      } catch {
        void 0
      }
      seen.set(key, c)
    }
    for (const id of removed) {
      this.#bus.emit({
        type: 'ClipCollectionRemoved',
        collectionId: id,
      } as unknown as import('./events').EngineEvent)
    }
    return removed
  }

  setBindings(collectionId: string, bindings: Record<string, string>): Map<string, string> {
    const c = this.getCollection(collectionId)
    const old = new Map(c.bindings)
    // Replace internal map via copy trick
    // Directly mutate via private hack: we have setters per binding but easier to recreate
    const copy = new ClipCollection(c.id, c.name, bindings, c.sourceNodeId, c.category)
    // replace in map
    this.#collections.set(collectionId, copy)
    this.#bus.emit({
      type: 'ClipCollectionBindingsChanged',
      collectionId,
    } as unknown as import('./events').EngineEvent)
    return old
  }

  setCategory(collectionId: string, category: string): string {
    const c = this.getCollection(collectionId)
    const old = c.category
    c.category = category
    this.#bus.emit({
      type: 'ClipCollectionRenamed',
      collectionId,
    } as unknown as import('./events').EngineEvent)
    return old
  }

  distinctCategories(): string[] {
    const seen = new Set<string>()
    for (const c of this.#collections.values()) {
      if (c.category !== '') seen.add(c.category)
    }
    return [...seen].sort((a, b) => a.localeCompare(b))
  }

  clear(): void {
    this.#collections.clear()
  }
}
