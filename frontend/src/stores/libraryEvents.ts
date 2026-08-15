import type { AssetDefinition, MaterialDefinition, ShaderDefinition } from '../api'

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

export interface ShaderCreated {
  readonly type: 'ShaderCreated'
  readonly shader: ShaderDefinition
}

export interface ShaderRemoved {
  readonly type: 'ShaderRemoved'
  readonly id: string
}

export interface ShaderRenamed {
  readonly type: 'ShaderRenamed'
  readonly shader: ShaderDefinition
}

export interface ShaderUpdated {
  readonly type: 'ShaderUpdated'
  readonly shader: ShaderDefinition
}

export type LibraryEvent =
  | AssetImported
  | AssetDeleted
  | AssetUpdated
  | MaterialCreated
  | MaterialRemoved
  | MaterialRenamed
  | MaterialUpdated
  | ShaderCreated
  | ShaderRemoved
  | ShaderRenamed
  | ShaderUpdated

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
