import { create } from 'zustand'
import {
  assetsApi,
  type AssetDefinition,
  type AssetSortKey,
  type AssetSortOrder,
  type AssetUploadResult,
} from '../api'
import { ApiError } from '../api/apiClient'
import { libraryEventBus } from './libraryEvents'
import { useNotificationStore } from './notificationStore'

export const SEARCH_DEBOUNCE_MS = 300

export const IMPORT_FAILED_MESSAGE = 'Asset import failed.'
export const IMPORT_BACKEND_DOWN_MESSAGE = 'Asset import failed — backend unavailable.'
export const DELETE_FAILED_MESSAGE = 'Asset delete failed.'
export const DELETE_BACKEND_DOWN_MESSAGE = 'Asset delete failed — backend unavailable.'

export type AssetUsageCounter = (assetId: string) => number

let usageCounter: AssetUsageCounter = () => 0

export function registerAssetUsageCounter(counter: AssetUsageCounter): () => void {
  usageCounter = counter
  return () => {
    if (usageCounter === counter) {
      usageCounter = () => 0
    }
  }
}

function usageMessage(usage: number): string {
  return `Used by ${usage} ${usage === 1 ? 'object' : 'objects'}`
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

interface AssetLibraryState {
  definitions: AssetDefinition[]
  loading: boolean
  error: string | null
  unavailable: boolean
  search: string
  sort: AssetSortKey
  order: AssetSortOrder
  selectedId: string | null
  loadLibrary: () => Promise<void>
  setSearch: (search: string) => void
  setSorting: (sort: AssetSortKey, order: AssetSortOrder) => void
  selectAsset: (assetId: string | null) => void
  importFiles: (files: File[]) => Promise<AssetUploadResult>
  deleteAsset: (assetId: string) => Promise<void>
}

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
let requestSeq = 0

export const useAssetLibraryStore = create<AssetLibraryState>()((set, get) => ({
  definitions: [],
  loading: false,
  error: null,
  unavailable: false,
  search: '',
  sort: 'import_date',
  order: 'desc',
  selectedId: null,

  loadLibrary: async () => {
    const seq = ++requestSeq
    set({ loading: true, error: null })
    try {
      const { search, sort, order } = get()
      const definitions = await assetsApi.listAssets({ search, sort, order })
      if (seq !== requestSeq) {
        return
      }
      set({ definitions, loading: false, unavailable: false })
    } catch (error) {
      if (seq !== requestSeq) {
        return
      }
      set({
        definitions: [],
        selectedId: null,
        loading: false,
        unavailable: true,
        error: errorMessage(error),
      })
    }
  },

  setSearch: (search) => {
    set({ search })
    if (searchDebounceTimer !== null) {
      clearTimeout(searchDebounceTimer)
    }
    searchDebounceTimer = setTimeout(() => {
      searchDebounceTimer = null
      void get().loadLibrary()
    }, SEARCH_DEBOUNCE_MS)
  },

  setSorting: (sort, order) => {
    set({ sort, order })
    void get().loadLibrary()
  },

  selectAsset: (assetId) => set({ selectedId: assetId }),

  importFiles: async (files) => {
    let result: AssetUploadResult
    try {
      result = await assetsApi.uploadAssets(files)
    } catch (error) {
      notifyRequestFailure(IMPORT_FAILED_MESSAGE, IMPORT_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
      return { created: [], errors: [] }
    }
    for (const uploadError of result.errors) {
      useNotificationStore.getState().notify(`${uploadError.filename}: ${uploadError.error}`)
    }
    for (const created of result.created) {
      libraryEventBus.emit({ type: 'AssetImported', asset: created })
    }
    if (result.created.length > 0) {
      await get().loadLibrary()
    }
    return result
  },

  deleteAsset: async (assetId) => {
    const usage = usageCounter(assetId)
    if (usage > 0) {
      useNotificationStore.getState().notify(usageMessage(usage))
      return
    }
    try {
      await assetsApi.deleteAsset(assetId)
    } catch (error) {
      notifyRequestFailure(DELETE_FAILED_MESSAGE, DELETE_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
      return
    }
    set((state) => ({
      definitions: state.definitions.filter((definition) => definition.id !== assetId),
      selectedId: state.selectedId === assetId ? null : state.selectedId,
    }))
    libraryEventBus.emit({ type: 'AssetDeleted', id: assetId })
  },
}))
