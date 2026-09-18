import { create } from 'zustand'
import {
  assetsApi,
  type AssetDefinition,
  type AssetFolder,
  type AssetSortKey,
  type AssetSortOrder,
  type AssetUploadResult,
} from '../api'
import { libraryEventBus } from './libraryEvents'
import { useNotificationStore } from './notificationStore'
import { notifyRequestFailure } from './requestNotifications'

export const SEARCH_DEBOUNCE_MS = 300

export const IMPORT_FAILED_MESSAGE = 'Asset import failed.'
export const IMPORT_BACKEND_DOWN_MESSAGE = 'Asset import failed — backend unavailable.'
export const DELETE_FAILED_MESSAGE = 'Asset delete failed.'
export const DELETE_BACKEND_DOWN_MESSAGE = 'Asset delete failed — backend unavailable.'
export const FOLDER_FAILED_MESSAGE = 'Folder operation failed.'
export const FOLDER_BACKEND_DOWN_MESSAGE = 'Folder operation failed — backend unavailable.'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

interface AssetLibraryState {
  definitions: AssetDefinition[]
  folders: AssetFolder[]
  currentFolderId: string | null
  loaded: boolean
  loading: boolean
  error: string | null
  unavailable: boolean
  search: string
  sort: AssetSortKey
  order: AssetSortOrder
  selectedId: string | null
  loadLibrary: () => Promise<void>
  loadFolders: () => Promise<void>
  setCurrentFolder: (folderId: string | null) => void
  setSearch: (search: string) => void
  setSorting: (sort: AssetSortKey, order: AssetSortOrder) => void
  selectAsset: (assetId: string | null) => void
  importFiles: (files: File[]) => Promise<AssetUploadResult>
  deleteAsset: (assetId: string) => Promise<void>
  createFolder: (name: string) => Promise<AssetFolder | null>
  renameFolder: (folderId: string, name: string) => Promise<void>
  deleteFolder: (folderId: string) => Promise<void>
  moveAsset: (assetId: string, folderId: string | null) => Promise<void>
  moveFolder: (folderId: string, parentId: string | null) => Promise<void>
}

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
let requestSeq = 0

export const useAssetLibraryStore = create<AssetLibraryState>()((set, get) => ({
  definitions: [],
  folders: [],
  currentFolderId: null,
  loaded: false,
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
      const { search, sort, order, currentFolderId } = get()
      // Scoped browsing: inside a folder always filter to it. At root, browse
      // root-level assets but search globally when text is present.
      const folderId =
        currentFolderId !== null ? currentFolderId : search.trim() ? undefined : 'root'
      const definitions = await assetsApi.listAssets({ search, sort, order, folderId })
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

  loadFolders: async () => {
    try {
      const folders = await assetsApi.listFolders()
      set({ folders, unavailable: false })
    } catch (error) {
      notifyRequestFailure(FOLDER_FAILED_MESSAGE, FOLDER_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
    }
  },

  setCurrentFolder: (folderId) => {
    if (get().currentFolderId === folderId) return
    set({ currentFolderId: folderId, selectedId: null })
    void get().loadLibrary()
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
      const { currentFolderId } = get()
      result = await assetsApi.uploadAssets(files, { folderId: currentFolderId })
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

  createFolder: async (name) => {
    const { currentFolderId } = get()
    try {
      const folder = await assetsApi.createFolder(name, currentFolderId)
      await get().loadFolders()
      return folder
    } catch (error) {
      notifyRequestFailure(FOLDER_FAILED_MESSAGE, FOLDER_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
      return null
    }
  },

  renameFolder: async (folderId, name) => {
    try {
      await assetsApi.renameFolder(folderId, name)
      await get().loadFolders()
    } catch (error) {
      notifyRequestFailure(FOLDER_FAILED_MESSAGE, FOLDER_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
    }
  },

  deleteFolder: async (folderId) => {
    const { folders, currentFolderId } = get()
    const deleted = folders.find((folder) => folder.id === folderId)
    try {
      await assetsApi.deleteFolder(folderId)
      // Contents move to the deleted folder's parent (or root) server-side;
      // navigate there if we were inside the deleted folder.
      if (currentFolderId === folderId) {
        set({ currentFolderId: deleted?.parent_id ?? null, selectedId: null })
      }
      await get().loadFolders()
      await get().loadLibrary()
    } catch (error) {
      notifyRequestFailure(FOLDER_FAILED_MESSAGE, FOLDER_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
    }
  },

  moveAsset: async (assetId, folderId) => {
    try {
      const updated = await assetsApi.moveAsset(assetId, folderId)
      set((state) => ({
        definitions: state.definitions.map((definition) =>
          definition.id === assetId ? updated : definition,
        ),
      }))
      await get().loadLibrary()
    } catch (error) {
      notifyRequestFailure(FOLDER_FAILED_MESSAGE, FOLDER_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
    }
  },

  moveFolder: async (folderId, parentId) => {
    try {
      await assetsApi.moveFolder(folderId, parentId)
      await get().loadFolders()
    } catch (error) {
      notifyRequestFailure(FOLDER_FAILED_MESSAGE, FOLDER_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
    }
  },
}))
