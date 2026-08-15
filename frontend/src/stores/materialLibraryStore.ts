import { create } from 'zustand'
import {
  materialsApi,
  type MaterialCreateInput,
  type MaterialDefinition,
  type MaterialUpdateInput,
} from '../api'
import { ApiError } from '../api/apiClient'
import { libraryEventBus } from './libraryEvents'
import { useNotificationStore } from './notificationStore'

export const CREATE_FAILED_MESSAGE = 'Material create failed.'
export const CREATE_BACKEND_DOWN_MESSAGE = 'Material create failed — backend unavailable.'
export const UPDATE_FAILED_MESSAGE = 'Material update failed.'
export const UPDATE_BACKEND_DOWN_MESSAGE = 'Material update failed — backend unavailable.'
export const DELETE_FAILED_MESSAGE = 'Material delete failed.'
export const DELETE_BACKEND_DOWN_MESSAGE = 'Material delete failed — backend unavailable.'

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
  definitions: MaterialDefinition[],
  updated: MaterialDefinition,
): MaterialDefinition[] {
  return definitions.map((definition) => (definition.id === updated.id ? updated : definition))
}

interface MaterialLibraryState {
  definitions: MaterialDefinition[]
  loaded: boolean
  loading: boolean
  error: string | null
  unavailable: boolean
  selectedId: string | null
  loadLibrary: () => Promise<void>
  selectMaterial: (materialId: string | null) => void
  createMaterial: (input: MaterialCreateInput) => Promise<MaterialDefinition | null>
  duplicateMaterial: (sourceId: string, name: string) => Promise<MaterialDefinition | null>
  renameMaterial: (materialId: string, name: string) => Promise<void>
  updateMaterial: (materialId: string, input: MaterialUpdateInput) => Promise<void>
  deleteMaterial: (materialId: string) => Promise<void>
}

let requestSeq = 0

export const useMaterialLibraryStore = create<MaterialLibraryState>()((set) => ({
  definitions: [],
  loaded: false,
  loading: false,
  error: null,
  unavailable: false,
  selectedId: null,

  loadLibrary: async () => {
    const seq = ++requestSeq
    set({ loading: true, error: null })
    try {
      const definitions = await materialsApi.listMaterials()
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
        selectedId: null,
        loaded: false,
        loading: false,
        unavailable: true,
        error: errorMessage(error),
      })
    }
  },

  selectMaterial: (materialId) => set({ selectedId: materialId }),

  createMaterial: async (input) => {
    try {
      const created = await materialsApi.createMaterial(input)
      set((state) => ({ definitions: [created, ...state.definitions] }))
      libraryEventBus.emit({ type: 'MaterialCreated', material: created })
      return created
    } catch (error) {
      notifyRequestFailure(CREATE_FAILED_MESSAGE, CREATE_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
      return null
    }
  },

  duplicateMaterial: async (sourceId, name) => {
    try {
      const created = await materialsApi.createMaterial({ name, sourceId })
      set((state) => ({ definitions: [created, ...state.definitions] }))
      libraryEventBus.emit({ type: 'MaterialCreated', material: created })
      return created
    } catch (error) {
      notifyRequestFailure(CREATE_FAILED_MESSAGE, CREATE_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
      return null
    }
  },

  renameMaterial: async (materialId, name) => {
    try {
      const renamed = await materialsApi.renameMaterial(materialId, name)
      set((state) => ({ definitions: replaceDefinition(state.definitions, renamed) }))
      libraryEventBus.emit({ type: 'MaterialRenamed', material: renamed })
    } catch (error) {
      notifyRequestFailure(UPDATE_FAILED_MESSAGE, UPDATE_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
    }
  },

  updateMaterial: async (materialId, input) => {
    try {
      const updated = await materialsApi.updateMaterial(materialId, input)
      set((state) => ({ definitions: replaceDefinition(state.definitions, updated) }))
      libraryEventBus.emit({ type: 'MaterialUpdated', material: updated })
    } catch (error) {
      notifyRequestFailure(UPDATE_FAILED_MESSAGE, UPDATE_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
    }
  },

  deleteMaterial: async (materialId) => {
    try {
      await materialsApi.deleteMaterial(materialId)
    } catch (error) {
      notifyRequestFailure(DELETE_FAILED_MESSAGE, DELETE_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
      return
    }
    set((state) => ({
      definitions: state.definitions.filter((definition) => definition.id !== materialId),
      selectedId: state.selectedId === materialId ? null : state.selectedId,
    }))
    libraryEventBus.emit({ type: 'MaterialRemoved', id: materialId })
  },
}))
