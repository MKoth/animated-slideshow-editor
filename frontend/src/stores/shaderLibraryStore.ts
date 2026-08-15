import { create } from 'zustand'
import { shadersApi, type ShaderDefinition, type ShaderImportInput } from '../api'
import { ApiError } from '../api/apiClient'
import { libraryEventBus } from './libraryEvents'
import { useNotificationStore } from './notificationStore'

export const IMPORT_FAILED_MESSAGE = 'Shader import failed.'
export const IMPORT_BACKEND_DOWN_MESSAGE = 'Shader import failed — backend unavailable.'
export const UPDATE_FAILED_MESSAGE = 'Shader update failed.'
export const UPDATE_BACKEND_DOWN_MESSAGE = 'Shader update failed — backend unavailable.'
export const DELETE_FAILED_MESSAGE = 'Shader delete failed.'
export const DELETE_BACKEND_DOWN_MESSAGE = 'Shader delete failed — backend unavailable.'

export interface ShaderCompileError {
  line: number
  message: string
}

export interface ShaderCompileStatus {
  status: 'Compiled' | 'Failed'
  errors: ShaderCompileError[]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

function notifyRequestFailure(
  failedMessage: string,
  backendDownMessage: string,
  error: unknown,
  markUnavailable: () => void,
): void {
  if (error instanceof ApiError) {
    useNotificationStore.getState().notify(failedMessage)
  } else {
    useNotificationStore.getState().notify(backendDownMessage)
    markUnavailable()
  }
}

function replaceDefinition(
  definitions: ShaderDefinition[],
  updated: ShaderDefinition,
): ShaderDefinition[] {
  return definitions.map((definition) => (definition.id === updated.id ? updated : definition))
}

interface ShaderLibraryState {
  definitions: ShaderDefinition[]
  compileStatus: Record<string, ShaderCompileStatus | undefined>
  loaded: boolean
  loading: boolean
  error: string | null
  unavailable: boolean
  selectedId: string | null
  loadLibrary: () => Promise<void>
  selectShader: (shaderId: string | null) => void
  importShader: (file: File, input?: ShaderImportInput) => Promise<ShaderDefinition | null>
  duplicateShader: (sourceId: string, name: string) => Promise<ShaderDefinition | null>
  renameShader: (shaderId: string, name: string) => Promise<void>
  reuploadSource: (shaderId: string, file: File) => Promise<void>
  deleteShader: (shaderId: string) => Promise<void>
}

let requestSeq = 0

export const useShaderLibraryStore = create<ShaderLibraryState>()((set) => ({
  definitions: [],
  compileStatus: {},
  loaded: false,
  loading: false,
  error: null,
  unavailable: false,
  selectedId: null,

  loadLibrary: async () => {
    const seq = ++requestSeq
    set({ loading: true, error: null })
    try {
      const definitions = await shadersApi.listShaders()
      if (seq !== requestSeq) {
        return
      }
      set({ definitions, loaded: true, loading: false, unavailable: false })
    } catch (error) {
      if (seq !== requestSeq) {
        return
      }
      set({
        definitions: [],
        compileStatus: {},
        selectedId: null,
        loaded: false,
        loading: false,
        unavailable: true,
        error: errorMessage(error),
      })
    }
  },

  selectShader: (shaderId) => set({ selectedId: shaderId }),

  importShader: async (file, input) => {
    try {
      const created = await shadersApi.importShader(file, input)
      set((state) => ({
        definitions: [created, ...state.definitions],
        compileStatus: { ...state.compileStatus, [created.id]: undefined },
      }))
      libraryEventBus.emit({ type: 'ShaderCreated', shader: created })
      return created
    } catch (error) {
      notifyRequestFailure(IMPORT_FAILED_MESSAGE, IMPORT_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
      return null
    }
  },

  duplicateShader: async (sourceId, name) => {
    try {
      const created = await shadersApi.duplicateShader(sourceId, name)
      set((state) => ({
        definitions: [created, ...state.definitions],
        compileStatus: { ...state.compileStatus, [created.id]: undefined },
      }))
      libraryEventBus.emit({ type: 'ShaderCreated', shader: created })
      return created
    } catch (error) {
      notifyRequestFailure(IMPORT_FAILED_MESSAGE, IMPORT_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
      return null
    }
  },

  renameShader: async (shaderId, name) => {
    try {
      const renamed = await shadersApi.renameShader(shaderId, name)
      set((state) => ({ definitions: replaceDefinition(state.definitions, renamed) }))
      libraryEventBus.emit({ type: 'ShaderRenamed', shader: renamed })
    } catch (error) {
      notifyRequestFailure(UPDATE_FAILED_MESSAGE, UPDATE_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
    }
  },

  reuploadSource: async (shaderId, file) => {
    try {
      const updated = await shadersApi.reuploadSource(shaderId, file)
      set((state) => ({
        definitions: replaceDefinition(state.definitions, updated),
        compileStatus: { ...state.compileStatus, [updated.id]: undefined },
      }))
      libraryEventBus.emit({ type: 'ShaderUpdated', shader: updated })
    } catch (error) {
      notifyRequestFailure(UPDATE_FAILED_MESSAGE, UPDATE_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
    }
  },

  deleteShader: async (shaderId) => {
    try {
      await shadersApi.deleteShader(shaderId)
    } catch (error) {
      notifyRequestFailure(DELETE_FAILED_MESSAGE, DELETE_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
      return
    }
    set((state) => {
      const compileStatus = { ...state.compileStatus }
      delete compileStatus[shaderId]
      return {
        definitions: state.definitions.filter((definition) => definition.id !== shaderId),
        compileStatus,
        selectedId: state.selectedId === shaderId ? null : state.selectedId,
      }
    })
    libraryEventBus.emit({ type: 'ShaderRemoved', id: shaderId })
  },
}))
