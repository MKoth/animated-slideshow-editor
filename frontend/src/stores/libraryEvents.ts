import type { AssetDefinition, MaterialDefinition } from '../api'

export interface AssetImported {
  readonly type: 'AssetImported'
  readonly asset: AssetDefinition
}

export interface AssetDeleted {
  readonly type: 'AssetDeleted'
  readonly id: string
}

export interface AssetUpdated {
  readonly type: 'AssetUpdated'
  readonly asset: AssetDefinition
}

export interface MaterialCreated {
  readonly type: 'MaterialCreated'
  readonly material: MaterialDefinition
}

export interface MaterialRemoved {
  readonly type: 'MaterialRemoved'
  readonly id: string
}

export interface MaterialRenamed {
  readonly type: 'MaterialRenamed'
  readonly material: MaterialDefinition
}

export interface MaterialUpdated {
  readonly type: 'MaterialUpdated'
  readonly material: MaterialDefinition
}

export type LibraryEvent =
  | AssetImported
  | AssetDeleted
  | AssetUpdated
  | MaterialCreated
  | MaterialRemoved
  | MaterialRenamed
  | MaterialUpdated

export type LibraryEventListener = (event: LibraryEvent) => void

export type Unsubscribe = () => void

export class LibraryEventBus {
  readonly #listeners = new Set<LibraryEventListener>()

  subscribe(listener: LibraryEventListener): Unsubscribe {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  emit(event: LibraryEvent): void {
    this.#listeners.forEach((listener) => listener(event))
  }
}

export const libraryEventBus = new LibraryEventBus()
