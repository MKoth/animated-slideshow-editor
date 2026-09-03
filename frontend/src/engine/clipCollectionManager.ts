import type { EventBus } from './events'
import { ClipCollection, newClipCollectionId } from './clipCollection'

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

  createCollection(name: string, bindings: Record<string, string>, sourceNodeId?: string): ClipCollection {
    const id = newClipCollectionId()
    const collection = new ClipCollection(id, name, bindings, sourceNodeId)
    this.#collections.set(id, collection)
    this.#bus.emit({ type: 'ClipCollectionCreated', collectionId: id } as unknown as import('./events').EngineEvent)
    return collection
  }

  importCollection(collection: ClipCollection): void {
    this.#collections.set(collection.id, collection)
    // no event for import (used during restore)
  }

  deleteCollection(collectionId: string): ClipCollection {
    const c = this.getCollection(collectionId)
    this.#collections.delete(collectionId)
    this.#bus.emit({ type: 'ClipCollectionRemoved', collectionId } as unknown as import('./events').EngineEvent)
    return c
  }

  renameCollection(collectionId: string, name: string): void {
    const c = this.getCollection(collectionId)
    c.name = name
    this.#bus.emit({ type: 'ClipCollectionRenamed', collectionId } as unknown as import('./events').EngineEvent)
  }

  setBindings(collectionId: string, bindings: Record<string, string>): Map<string, string> {
    const c = this.getCollection(collectionId)
    const old = new Map(c.bindings)
    // Replace internal map via copy trick
    // Directly mutate via private hack: we have setters per binding but easier to recreate
    const copy = new ClipCollection(c.id, c.name, bindings, c.sourceNodeId)
    // replace in map
    this.#collections.set(collectionId, copy)
    this.#bus.emit({ type: 'ClipCollectionBindingsChanged', collectionId } as unknown as import('./events').EngineEvent)
    return old
  }

  clear(): void {
    this.#collections.clear()
  }
}
