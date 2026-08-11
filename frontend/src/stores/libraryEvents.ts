import type { AssetDefinition } from '../api'

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

export type LibraryEvent = AssetImported | AssetDeleted | AssetUpdated

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
