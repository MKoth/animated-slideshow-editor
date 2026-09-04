import { create } from 'zustand'
import { clipCollectionsApi, clipsApi, type ClipCollectionLibraryEntry } from '../api'
import type { ClipCollection } from '../engine/clipCollection'
import type { EnginePublic } from '../engine'
import type { Command, CommandResult } from '../engine/commands'
import { CreateClipCollectionCommand } from '../engine/commands/createClipCollectionCommand'
import { ImportClipCommand } from '../engine/commands/importClipCommand'
import { notifyRequestFailure } from './requestNotifications'
import { useNotificationStore } from './notificationStore'

export const COLLECTION_LOAD_FAILED_MESSAGE = 'Failed to load clip collection library.'
export const COLLECTION_LOAD_BACKEND_DOWN_MESSAGE =
  'Failed to load clip collection library — backend unavailable.'
export const COLLECTION_SAVE_FAILED_MESSAGE = 'Failed to save collection to library.'
export const COLLECTION_SAVE_BACKEND_DOWN_MESSAGE =
  'Failed to save collection to library — backend unavailable.'
export const COLLECTION_DELETE_FAILED_MESSAGE = 'Failed to delete collection from library.'
export const COLLECTION_DELETE_BACKEND_DOWN_MESSAGE =
  'Failed to delete collection from library — backend unavailable.'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

function collectionToCreateInput(
  collection: ClipCollection,
  engine?: EnginePublic,
): {
  id: string
  name: string
  bindings: Record<string, string>
  source_node_id: string | null
  clips: Record<string, unknown>[] | null
} {
  const json = collection.toJSON()
  let clips: Record<string, unknown>[] | null = null
  if (engine) {
    const bindings = json.bindings as Record<string, string>
    const clipJsons: Record<string, unknown>[] = []
    const seen = new Set<string>()
    const missing: string[] = []
    for (const clipId of Object.values(bindings)) {
      if (seen.has(clipId)) continue
      seen.add(clipId)
      try {
        const clip = engine.getClip(clipId)
        clipJsons.push(clip.toJSON() as unknown as Record<string, unknown>)
      } catch {
        missing.push(clipId.slice(0, 8))
      }
    }
    if (clipJsons.length > 0) clips = clipJsons
    if (missing.length > 0) {
      // Do not throw — save with available clips and warn; import will still work for available bindings
      console.warn(`Saving collection "${json.name}" with ${missing.length} missing clip(s): ${missing.join(', ')}`)
      useNotificationStore.getState().notify(
        `Saving "${json.name}" with ${missing.length} missing clip(s) — those bindings will not be self-contained. Re-export the hierarchy to fix.`,
      )
    }
  }
  return {
    id: json.id,
    name: json.name,
    bindings: { ...json.bindings } as Record<string, string>,
    source_node_id: json.sourceNodeId ?? null,
    clips,
  }
}

interface ClipCollectionLibraryState {
  definitions: ClipCollectionLibraryEntry[]
  loaded: boolean
  loading: boolean
  error: string | null
  unavailable: boolean
  loadLibrary: () => Promise<void>
  saveToLibrary: (
    collection: ClipCollection,
    overwriteEntryId?: string,
    engine?: EnginePublic,
  ) => Promise<ClipCollectionLibraryEntry | null>
  deleteFromLibrary: (collectionId: string) => Promise<void>
  importCollectionFromLibrary: (
    entry: ClipCollectionLibraryEntry,
    engine: EnginePublic,
  ) => Promise<string | null>
  createCollectionInProject: (name: string, bindings: Record<string, string>) => void
  clearError: () => void
}

let dispatchRef: ((command: Command<unknown>) => CommandResult<unknown>) | null = null
let requestSeq = 0

export function initClipCollectionLibraryStore(
  dispatchFn: (command: Command<unknown>) => CommandResult<unknown>,
): void {
  dispatchRef = dispatchFn
}

export const useClipCollectionLibraryStore = create<ClipCollectionLibraryState>()((set) => ({
  definitions: [],
  loaded: false,
  loading: false,
  error: null,
  unavailable: false,

  loadLibrary: async () => {
    const seq = ++requestSeq
    set({ loading: true, error: null })
    try {
      const definitions = await clipCollectionsApi.listCollections()
      if (seq !== requestSeq) return
      set({ definitions, loaded: true, loading: false, unavailable: false })
    } catch (error) {
      if (seq !== requestSeq) return
      set({
        definitions: [],
        loaded: false,
        loading: false,
        unavailable: true,
        error: errorMessage(error),
      })
    }
  },

  saveToLibrary: async (collection, overwriteEntryId, engine) => {
    try {
      const input = collectionToCreateInput(collection, engine as unknown as EnginePublic)
      let result: ClipCollectionLibraryEntry
      if (overwriteEntryId) {
        result = await clipCollectionsApi.updateCollection(overwriteEntryId, {
          name: input.name,
          bindings: input.bindings,
          source_node_id: input.source_node_id,
          clips: input.clips,
        })
        set((state) => ({
          definitions: state.definitions.map((d) => (d.id === result.id ? result : d)),
        }))
      } else {
        try {
          result = await clipCollectionsApi.createCollection(input)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          const isDuplicate = msg.includes('already exists') || msg.includes('409') || msg.includes('duplicate')
          if (isDuplicate) {
            try {
              result = await clipCollectionsApi.updateCollection(input.id, {
                name: input.name,
                bindings: input.bindings,
                source_node_id: input.source_node_id,
                clips: input.clips,
              })
              set((state) => ({
                definitions: state.definitions.map((d) => (d.id === result.id ? result : d)),
              }))
              return result
            } catch (updateErr) {
              throw updateErr
            }
          }
          throw e
        }
        set((state) => ({ definitions: [result, ...state.definitions] }))
      }
      set({ error: null })
      return result
    } catch (error) {
      const message = errorMessage(error)
      // Handle validation errors from collectionToCreateInput (e.g., missing clip) with actual detail
      if (error instanceof Error && error.message.includes('Cannot save collection')) {
        const msg = message
        useNotificationStore.getState().notify(msg)
        set({ error: msg })
        return null
      }
      set({ error: message })
      notifyRequestFailure(
        COLLECTION_SAVE_FAILED_MESSAGE,
        COLLECTION_SAVE_BACKEND_DOWN_MESSAGE,
        error,
        () => set({ unavailable: true, error: message }),
      )
      return null
    }
  },

  deleteFromLibrary: async (collectionId) => {
    try {
      await clipCollectionsApi.deleteCollection(collectionId)
    } catch (error) {
      notifyRequestFailure(
        COLLECTION_DELETE_FAILED_MESSAGE,
        COLLECTION_DELETE_BACKEND_DOWN_MESSAGE,
        error,
        () => set({ unavailable: true, error: errorMessage(error) }),
      )
      return
    }
    set((state) => ({
      definitions: state.definitions.filter((d) => d.id !== collectionId),
    }))
  },

  importCollectionFromLibrary: async (entry, engine) => {
    if (!dispatchRef) return null
    const newBindings: Record<string, string> = {}
    const clipIdMap = new Map<string, string>()
    const clipsSnapshot = (entry as unknown as { clips?: Record<string, unknown>[] | null }).clips
    if (Array.isArray(clipsSnapshot) && clipsSnapshot.length > 0) {
      for (const clipJson of clipsSnapshot) {
        const oldId = (clipJson as { id?: string }).id as string
        if (!oldId || clipIdMap.has(oldId)) continue
        try {
          engine.getClip(oldId)
          clipIdMap.set(oldId, oldId)
          continue
        } catch {
          // need to create
        }
        try {
          const entryForImport = {
            id: oldId,
            name: (clipJson as { name?: string }).name as string,
            duration: (clipJson as { duration?: number }).duration as number,
            category: ((clipJson as { category?: string }).category as string) ?? null,
            params: ((clipJson as { params?: unknown[] }).params as import('../api').ClipParamDef[]) ?? [],
            channels: ((clipJson as { channels?: unknown[] }).channels as import('../api').ClipChannelDefApi[]) ?? [],
            channelAnimations:
              ((clipJson as { channelAnimations?: unknown }).channelAnimations as Record<string, Record<string, unknown>>) ??
              ((clipJson as { channel_animations?: unknown }).channel_animations as Record<string, Record<string, unknown>>) ??
              null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as unknown as import('../api').ClipLibraryEntry
          const importResult = dispatchRef(new ImportClipCommand({ entry: entryForImport }))
          if (!importResult.ok) {
            set({ error: `Failed to import embedded clip ${oldId.slice(0, 8)}: ${importResult.error.message}` })
           return null
          }
          const newClipId = (importResult as { ok: true; inverse: { clipId: string } }).inverse.clipId
          clipIdMap.set(oldId, newClipId)
        } catch (e) {
          set({ error: `Failed to import embedded clip ${oldId.slice(0, 8)}: ${e instanceof Error ? e.message : String(e)}` })
           return null
        }
      }
      const missingBindings: string[] = []
      for (const [semantic, oldClipId] of Object.entries(entry.bindings)) {
        const mapped = clipIdMap.get(oldClipId)
        if (mapped) newBindings[semantic] = mapped
        else {
          try {
            engine.getClip(oldClipId)
            newBindings[semantic] = oldClipId
          } catch {
            missingBindings.push(`${semantic}→${oldClipId.slice(0, 8)}`)
          }
        }
      }
      if (Object.keys(newBindings).length === 0) {
        set({ error: `Collection "${entry.name}" has no importable bindings — all referenced clips missing: ${missingBindings.join(', ')}. Re-export in original project.` })
         return null
      }
      if (missingBindings.length > 0) {
        useNotificationStore.getState().notify(`Importing "${entry.name}" with ${missingBindings.length} missing clip(s) skipped: ${missingBindings.join(', ')}`)
      }
    } else {
      // Legacy entry without embedded clips — try clip library, skip missing with warning
      const missingLegacy: string[] = []
      for (const [semantic, clipId] of Object.entries(entry.bindings)) {
        try {
          engine.getClip(clipId)
          newBindings[semantic] = clipId
        } catch {
          try {
            const clipEntry = await clipsApi.getClip(clipId)
            const importResult = dispatchRef(new ImportClipCommand({ entry: clipEntry }))
            if (!importResult.ok) {
              missingLegacy.push(`${semantic}→${clipId.slice(0, 8)}`)
              continue
            }
            const newClipId = (importResult as { ok: true; inverse: { clipId: string } }).inverse.clipId
            newBindings[semantic] = newClipId
          } catch {
            missingLegacy.push(`${semantic}→${clipId.slice(0, 8)}`)
          }
        }
      }
      if (Object.keys(newBindings).length === 0) {
        const base = `Collection "${entry.name}" has no importable clips — all ${Object.keys(entry.bindings).length} bindings missing.`
        const hint = ' This is a legacy entry saved before self-contained support. Open the original project, re-export and Save to Library again.'
        set({ error: base + hint })
         return null
      }
      if (missingLegacy.length > 0) {
        useNotificationStore.getState().notify(`Importing legacy "${entry.name}" with ${missingLegacy.length} missing clip(s) skipped: ${missingLegacy.join(', ')}. Re-save self-contained to fix.`)
      }
    }
    const result = dispatchRef(
      new CreateClipCollectionCommand({
        name: entry.name,
        bindings: newBindings,
        // The source node belongs to the project that created the library
        // entry. It cannot be reused as a node reference in this project.
      }),
    )
    if (!result.ok) {
      set({ error: result.error.message })
      return null
    } else {
      set({ error: null })
      return (result as { ok: true; inverse: { collectionId: string } }).inverse.collectionId
    }
  },

  createCollectionInProject: (name, bindings) => {
    if (!dispatchRef) return
    const result = dispatchRef(new CreateClipCollectionCommand({ name, bindings }))
    if (!result.ok) {
      set({ error: result.error.message })
    }
  },

  clearError: () => set({ error: null }),
}))
