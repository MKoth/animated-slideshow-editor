import { create } from 'zustand'
import type { ClipDefinition } from '../engine/clipDefinition'
import type { EnginePublic } from '../engine'
import type { Command, CommandResult } from '../engine/commands'
import { CreateClipCommand } from '../engine/commands/createClipCommand'
import { RenameClipCommand } from '../engine/commands/renameClipCommand'
import { DuplicateClipCommand } from '../engine/commands/duplicateClipCommand'
import { DeleteClipCommand } from '../engine/commands/deleteClipCommand'

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
  definitions: ClipLibraryClip[]
  selectedId: string | null
  error: string | null
  loadFromEngine: (clipDefinitions: readonly ClipDefinition[]) => void
  selectClip: (clipId: string | null) => void
  clearError: () => void
  createClip: (name: string) => void
  renameClip: (clipId: string, name: string) => void
  duplicateClip: (sourceId: string, newName: string) => void
  deleteClip: (clipId: string, engine: EnginePublic) => void
}

let dispatchRef: ((command: Command<unknown>) => CommandResult<unknown>) | null = null

export function initClipLibraryStore(
  dispatchFn: (command: Command<unknown>) => CommandResult<unknown>,
): void {
  dispatchRef = dispatchFn
}

export const useClipLibraryStore = create<ClipLibraryState>()((set) => ({
  definitions: [],
  selectedId: null,
  error: null,

  loadFromEngine: (clipDefinitions) => {
    set({ definitions: clipDefinitions.map(clipToRecord) })
  },

  selectClip: (clipId) => set({ selectedId: clipId }),

  clearError: () => set({ error: null }),

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
