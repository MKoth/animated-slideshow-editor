import { create } from 'zustand'
import { clipsApi, type ClipCreateInput, type ClipLibraryEntry } from '../api'
import type { ClipDefinition } from '../engine/clipDefinition'
import type { EnginePublic } from '../engine'
import type { Command, CommandResult } from '../engine/commands'
import { CreateClipCommand } from '../engine/commands/createClipCommand'
import { RenameClipCommand } from '../engine/commands/renameClipCommand'
import { DuplicateClipCommand } from '../engine/commands/duplicateClipCommand'
import { DeleteClipCommand } from '../engine/commands/deleteClipCommand'
import { ImportClipCommand } from '../engine/commands/importClipCommand'
import { libraryEventBus } from './libraryEvents'
import { notifyRequestFailure } from './requestNotifications'

export const LOAD_FAILED_MESSAGE = 'Failed to load clip library.'
export const LOAD_BACKEND_DOWN_MESSAGE = 'Failed to load clip library — backend unavailable.'
export const SAVE_FAILED_MESSAGE = 'Failed to save clip to library.'
export const SAVE_BACKEND_DOWN_MESSAGE = 'Failed to save clip to library — backend unavailable.'
export const UPDATE_FAILED_MESSAGE = 'Failed to update clip in library.'
export const UPDATE_BACKEND_DOWN_MESSAGE = 'Failed to update clip in library — backend unavailable.'
export const DELETE_FAILED_MESSAGE = 'Failed to delete clip from library.'
export const DELETE_BACKEND_DOWN_MESSAGE =
  'Failed to delete clip from library — backend unavailable.'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

function replaceDefinition(
  definitions: ClipLibraryEntry[],
  updated: ClipLibraryEntry,
): ClipLibraryEntry[] {
  return definitions.map((definition) => (definition.id === updated.id ? updated : definition))
}

function clipToCreateInput(clip: ClipDefinition): ClipCreateInput {
  const json = clip.toJSON()
  return {
    id: json.id,
    name: json.name,
    duration: json.duration,
    category: json.category || null,
    params: [...json.params] as ClipCreateInput['params'],
    channels: [...json.channels] as ClipCreateInput['channels'],
    channelAnimations: (json.channelAnimations as Record<string, Record<string, unknown>>) ?? null,
  }
}

export interface ClipLibraryClip {
  readonly id: string
  readonly name: string
  readonly duration: number
  readonly category: string
  readonly channelCount: number
}

export function clipToRecord(clip: ClipDefinition): ClipLibraryClip {
  return {
    id: clip.id,
    name: clip.name,
    duration: clip.duration,
    category: clip.category,
    channelCount: clip.channels.length,
  }
}

interface ClipLibraryState {
  definitions: ClipLibraryEntry[]
  loaded: boolean
  loading: boolean
  error: string | null
  unavailable: boolean
  selectedId: string | null
  libraryBrowserVisible: boolean
  loadLibrary: () => Promise<void>
  saveToLibrary: (
    clip: ClipDefinition,
    overwriteEntryId?: string,
  ) => Promise<ClipLibraryEntry | null>
  updateInLibrary: (clip: ClipDefinition) => Promise<void>
  deleteFromLibrary: (clipId: string) => Promise<void>
  selectClip: (clipId: string | null) => void
  clearError: () => void
  openLibraryBrowser: () => void
  closeLibraryBrowser: () => void
  importClipFromLibrary: (entry: ClipLibraryEntry) => void
  createClip: (name: string) => void
  renameClip: (clipId: string, name: string) => void
  duplicateClip: (sourceId: string, newName: string) => void
  deleteClip: (clipId: string, engine: EnginePublic) => void
}

let dispatchRef: ((command: Command<unknown>) => CommandResult<unknown>) | null = null
let requestSeq = 0

export function initClipLibraryStore(
  dispatchFn: (command: Command<unknown>) => CommandResult<unknown>,
): void {
  dispatchRef = dispatchFn
}

export const useClipLibraryStore = create<ClipLibraryState>()((set) => ({
  definitions: [],
  loaded: false,
  loading: false,
  error: null,
  unavailable: false,
  selectedId: null,
  libraryBrowserVisible: false,

  loadLibrary: async () => {
    const seq = ++requestSeq
    set({ loading: true, error: null })
    try {
      const definitions = await clipsApi.listClips()
      if (seq !== requestSeq) return
      set({ definitions, loaded: true, loading: false, unavailable: false })
    } catch (error) {
      if (seq !== requestSeq) return
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

  saveToLibrary: async (clip, overwriteEntryId) => {
    try {
      const input = clipToCreateInput(clip)
      let result: ClipLibraryEntry
      if (overwriteEntryId) {
        result = await clipsApi.updateClip(overwriteEntryId, {
          name: input.name,
          duration: input.duration,
          category: input.category,
          params: input.params,
          channels: input.channels,
          channelAnimations: input.channelAnimations,
        })
        set((state) => ({ definitions: replaceDefinition(state.definitions, result) }))
        libraryEventBus.emit({ type: 'ClipUpdated', clip: result })
      } else {
        result = await clipsApi.createClip(input)
        set((state) => ({ definitions: [result, ...state.definitions] }))
        libraryEventBus.emit({ type: 'ClipSaved', clip: result })
      }
      return result
    } catch (error) {
      notifyRequestFailure(SAVE_FAILED_MESSAGE, SAVE_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
      return null
    }
  },

  updateInLibrary: async (clip) => {
    try {
      const input = clipToCreateInput(clip)
      const updated = await clipsApi.updateClip(input.id, {
        name: input.name,
        duration: input.duration,
        category: input.category,
        params: input.params,
        channels: input.channels,
        channelAnimations: input.channelAnimations,
      })
      set((state) => ({ definitions: replaceDefinition(state.definitions, updated) }))
      libraryEventBus.emit({ type: 'ClipUpdated', clip: updated })
    } catch (error) {
      notifyRequestFailure(UPDATE_FAILED_MESSAGE, UPDATE_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
    }
  },

  deleteFromLibrary: async (clipId) => {
    try {
      await clipsApi.deleteClip(clipId)
    } catch (error) {
      notifyRequestFailure(DELETE_FAILED_MESSAGE, DELETE_BACKEND_DOWN_MESSAGE, error, () =>
        set({ unavailable: true, error: errorMessage(error) }),
      )
      return
    }
    set((state) => ({
      definitions: state.definitions.filter((d) => d.id !== clipId),
      selectedId: state.selectedId === clipId ? null : state.selectedId,
    }))
    libraryEventBus.emit({ type: 'ClipDeleted', id: clipId })
  },

  selectClip: (clipId) => set({ selectedId: clipId }),

  clearError: () => set({ error: null }),

  openLibraryBrowser: () => set({ libraryBrowserVisible: true }),

  closeLibraryBrowser: () => set({ libraryBrowserVisible: false }),

  importClipFromLibrary: (entry) => {
    if (!dispatchRef) return
    const result = dispatchRef(new ImportClipCommand({ entry }))
    if (!result.ok) {
      set({ error: result.error.message })
    }
  },

  createClip: (name) => {
    if (!dispatchRef) return
    const result = dispatchRef(new CreateClipCommand({ name, duration: 1 }))
    if (!result.ok) {
      set({ error: result.error.message })
    }
  },

  renameClip: (clipId, name) => {
    if (!dispatchRef) return
    const result = dispatchRef(new RenameClipCommand({ clipId, name }))
    if (!result.ok) {
      set({ error: result.error.message })
    }
  },

  duplicateClip: (sourceId, newName) => {
    if (!dispatchRef) return
    const result = dispatchRef(new DuplicateClipCommand({ clipId: sourceId }))
    if (!result.ok) {
      set({ error: result.error.message })
      return
    }
    const newClipId = (result as { ok: true; inverse: { clipId: string } }).inverse.clipId
    const renameResult = dispatchRef(new RenameClipCommand({ clipId: newClipId, name: newName }))
    if (!renameResult.ok) {
      set({ error: renameResult.error.message })
    }
  },

  deleteClip: (clipId, engine) => {
    if (engine.isClipReferenced(clipId)) {
      const names = engine.getClipBlockingNodeNames(clipId)
      set({ error: `Cannot delete clip: it is referenced by nodes: ${names.join(', ')}` })
      return
    }
    if (!dispatchRef) return
    const result = dispatchRef(new DeleteClipCommand({ clipId }))
    if (!result.ok) {
      set({ error: result.error.message })
    }
  },
}))
