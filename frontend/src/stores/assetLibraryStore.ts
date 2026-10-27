import { create } from 'zustand'
import {
  assetsApi,
  type AssetDefinition,
  type AssetFolder,
  type AssetSortKey,
  type AssetSortOrder,
  type AssetUploadResult,
} from '../api'
import { ApiError } from '../api/apiClient'
import { libraryEventBus } from './libraryEvents'
import { useNotificationStore } from './notificationStore'
import { notifyRequestFailure } from './requestNotifications'

export const SEARCH_DEBOUNCE_MS = 300

/** Uploads from outside the library always land in this root folder. */
export const LESSON_ASSETS_FOLDER = 'lesson assets'

export const IMPORT_FAILED_MESSAGE = 'Asset import failed.'
export const IMPORT_BACKEND_DOWN_MESSAGE = 'Asset import failed — backend unavailable.'
export const DELETE_FAILED_MESSAGE = 'Asset delete failed.'
export const DELETE_BACKEND_DOWN_MESSAGE = 'Asset delete failed — backend unavailable.'
export const FOLDER_FAILED_MESSAGE = 'Folder operation failed.'
export const FOLDER_BACKEND_DOWN_MESSAGE = 'Folder operation failed — backend unavailable.'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

/** Fresh library uploads a script Check can resolve by name before anything embeds them. */
export function collectGlobalAudioAssets(): readonly {
  id: string
  name: string
  duration: number
}[] {
  const definitions = useAssetLibraryStore.getState().allDefinitions
  const out: { id: string; name: string; duration: number }[] = []
  for (const definition of definitions) {
    const isAudio =
      definition.category === 'audio' ||
      definition.mimeType?.startsWith('audio/') === true ||
      /\.(wav|mp3|mpeg|ogg|webm)$/i.test(definition.original_filename ?? '')
    if (!isAudio) continue
    const raw = (definition.metadata as Record<string, unknown> | undefined)?.duration
    out.push({
      id: definition.id,
      name: definition.name,
      duration: typeof raw === 'number' ? raw : Number.NaN,
    })
  }
  return out
}

interface AssetLibraryState {
  definitions: AssetDefinition[]
  /**
   * The complete library across all folders and search scopes: what script
   * resolution syncs into the engine, so `create asset "Name"` sees the
   * whole, current picture instead of just the browsed folder.
   */
  allDefinitions: AssetDefinition[]
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
  /** Refresh the full-library mirror without touching the panel display. */
  loadAllDefinitions: () => Promise<void>
  loadFolders: () => Promise<void>
  setCurrentFolder: (folderId: string | null) => void
  setSearch: (search: string) => void
  setSorting: (sort: AssetSortKey, order: AssetSortOrder) => void
  selectAsset: (assetId: string | null) => void
  importFiles: (files: File[]) => Promise<AssetUploadResult>
  deleteAsset: (assetId: string) => Promise<void>
  createFolder: (name: string, parentId?: string | null) => Promise<AssetFolder | null>
  ensureLessonAssetsFolder: () => Promise<string | null>
  renameFolder: (folderId: string, name: string) => Promise<void>
  deleteFolder: (folderId: string) => Promise<void>
  moveAsset: (assetId: string, folderId: string | null) => Promise<void>
  moveFolder: (folderId: string, parentId: string | null) => Promise<void>
}

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
let requestSeq = 0

export const useAssetLibraryStore = create<AssetLibraryState>()((set, get) => ({
  definitions: [],
  allDefinitions: [],
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

  loadAllDefinitions: async () => {
    try {
      // Global scope: no folder or search filter, so the mirror holds every
      // library asset no matter what the panel is browsing.
      const allDefinitions = await assetsApi.listAssets({ sort: 'name', order: 'asc' })
      set({ allDefinitions })
    } catch {
      // Silent: display flows already report backend outages; the sync mirror
      // simply stays at its last known picture until the next refresh.
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
      // Uploads from outside always land in the "lesson assets" group so
      // the bind dropdown can find them without hunting the whole library.
      // Falls back to the browsed folder when the group cannot be ensured.
      let folderId: string | null
      try {
        folderId = await get().ensureLessonAssetsFolder()
      } catch {
        folderId = get().currentFolderId ?? null
      }
      result = await assetsApi.uploadAssets(files, { folderId })
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
      await get().loadAllDefinitions()
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
      allDefinitions: state.allDefinitions.filter((definition) => definition.id !== assetId),
      selectedId: state.selectedId === assetId ? null : state.selectedId,
    }))
    libraryEventBus.emit({ type: 'AssetDeleted', id: assetId })
  },

  createFolder: async (name, parentId) => {
    const { currentFolderId } = get()
    try {
      const folder = await assetsApi.createFolder(
        name,
        parentId === undefined ? currentFolderId : parentId,
      )
      await get().loadFolders()
      return folder
    } catch (error) {
      notifyRequestFailure(FOLDER_FAILED_MESSAGE, FOLDER_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
      return null
    }
  },

  ensureLessonAssetsFolder: async () => {
    const match = (folders: AssetFolder[]) =>
      folders.find((f) => f.name.toLowerCase() === LESSON_ASSETS_FOLDER.toLowerCase()) ?? null
    const listed = await assetsApi.listFolders()
    set({ folders: listed })
    const existing = match(listed)
    if (existing) return existing.id
    try {
      const created = await assetsApi.createFolder(LESSON_ASSETS_FOLDER, null)
      set((state) => ({ folders: [...state.folders, created] }))
      return created.id
    } catch (error) {
      // A parallel import may have created it first — re-list and reuse.
      if (error instanceof ApiError && error.status === 409) {
        const retry = await assetsApi.listFolders()
        set({ folders: retry })
        const found = match(retry)
        if (found) return found.id
      }
      throw error
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
