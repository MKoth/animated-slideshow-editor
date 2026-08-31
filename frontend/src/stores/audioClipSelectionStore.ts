import { create } from 'zustand'

export interface AudioClipSelectionState {
  readonly selectedClipIds: ReadonlySet<string>
  readonly soloMuted: ReadonlySet<string>
  select(clipId: string): void
  toggle(clipId: string): void
  clear(): void
  setSoloMuted(clipId: string, muted: boolean): void
}

export const useAudioClipSelectionStore = create<AudioClipSelectionState>()((set, get) => ({
  selectedClipIds: new Set<string>(),
  soloMuted: new Set<string>(),

  select: (clipId: string): void => {
    set({ selectedClipIds: new Set([clipId]) })
  },

  toggle: (clipId: string): void => {
    const next = new Set(get().selectedClipIds)
    if (next.has(clipId)) next.delete(clipId)
    else next.add(clipId)
    set({ selectedClipIds: next })
  },

  clear: (): void => {
    set({ selectedClipIds: new Set<string>() })
  },

  setSoloMuted: (clipId: string, muted: boolean): void => {
    const next = new Set(get().soloMuted)
    if (muted) next.add(clipId)
    else next.delete(clipId)
    set({ soloMuted: next })
  },
}))
