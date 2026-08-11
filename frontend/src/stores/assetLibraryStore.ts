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
        error: error instanceof Error ? error.message : 'Unknown error',
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
      if (error instanceof ApiError) {
        useNotificationStore.getState().notify(IMPORT_FAILED_MESSAGE)
      } else {
        useNotificationStore.getState().notify(IMPORT_BACKEND_DOWN_MESSAGE)
        set({ unavailable: true, error: error instanceof Error ? error.message : 'Unknown error' })
      }
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
    await assetsApi.deleteAsset(assetId)
    set((state) => ({
      definitions: state.definitions.filter((definition) => definition.id !== assetId),
      selectedId: state.selectedId === assetId ? null : state.selectedId,
    }))
    libraryEventBus.emit({ type: 'AssetDeleted', id: assetId })
  },
}))
