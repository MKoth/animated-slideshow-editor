import type {
  AssetDefinition,
  ClipLibraryEntry,
  MaterialDefinition,
  ShaderDefinition,
} from '../api'
import type { ShaderCompileError } from '../shaders/compiler'

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

export interface ShaderCompiled {
  readonly type: 'ShaderCompiled'
  readonly id: string
}

export interface ShaderCompilationFailed {
  readonly type: 'ShaderCompilationFailed'
  readonly id: string
  readonly errors: ShaderCompileError[]
}

export interface ClipSaved {
  readonly type: 'ClipSaved'
  readonly clip: ClipLibraryEntry
}

export interface ClipUpdated {
  readonly type: 'ClipUpdated'
  readonly clip: ClipLibraryEntry
}

export interface ClipDeleted {
  readonly type: 'ClipDeleted'
  readonly id: string
}

export interface DataSourceCreated {
  readonly type: 'DataSourceCreated'
  readonly id: string
  readonly name: string
}

export interface DataSourceRenamed {
  readonly type: 'DataSourceRenamed'
  readonly id: string
  readonly name: string
}

export interface DataSourceRemoved {
  readonly type: 'DataSourceRemoved'
  readonly id: string
}

export interface DataSourceUpdated {
  readonly type: 'DataSourceUpdated'
  readonly id: string
  readonly name: string
}

export type LibraryEvent =
  | AssetImported
  | AssetDeleted
  | AssetUpdated
  | ClipSaved
  | ClipUpdated
  | ClipDeleted
  | DataSourceCreated
  | DataSourceRenamed
  | DataSourceRemoved
  | DataSourceUpdated
  | MaterialCreated
  | MaterialRemoved
  | MaterialRenamed
  | MaterialUpdated
  | ShaderCreated
  | ShaderRemoved
  | ShaderRenamed
  | ShaderUpdated
  | ShaderCompiled
  | ShaderCompilationFailed

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
