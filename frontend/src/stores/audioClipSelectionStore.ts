import { create } from 'zustand'

export interface AudioMarqueeRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface AudioClipSelectionState {
  readonly selectedClipIds: ReadonlySet<string>
  readonly activeClipId: string | null
  readonly marquee: AudioMarqueeRect | null
  /** @deprecated use audioPlaybackStore for lane preview */
  readonly soloMuted: ReadonlySet<string>
  select(clipId: string): void
  toggle(clipId: string): void
  clear(): void
  clearSelection(): void
  /** Range select from activeClipId anchor to target inclusive, ordered by provided list. */
  selectRange(clipId: string, orderedIds: readonly string[]): void
  /** Alias for selectRange to satisfy spec naming `range`. */
  range(clipId: string, orderedIds: readonly string[]): void
  marqueeStart(x: number, y: number): void
  marqueeUpdate(width: number, height: number): void
  marqueeEnd(intersectingIds: readonly string[]): void
  setSoloMuted(clipId: string, muted: boolean): void
}

function computeRange(anchorIndex: number, targetIndex: number): [number, number] {
  return anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
}

export const useAudioClipSelectionStore = create<AudioClipSelectionState>()((set, get) => ({
  selectedClipIds: new Set<string>(),
  activeClipId: null,
  marquee: null,
  soloMuted: new Set<string>(),

  select: (clipId: string): void => {
    set({
      selectedClipIds: new Set([clipId]),
      activeClipId: clipId,
    })
  },

  toggle: (clipId: string): void => {
    const next = new Set(get().selectedClipIds)
    if (next.has(clipId)) next.delete(clipId)
    else next.add(clipId)
    const active = next.has(clipId)
      ? clipId
      : next.size > 0
        ? Array.from(next)[next.size - 1]
        : null
    // Keep active as toggled clip if added, otherwise last remaining or null
    set({ selectedClipIds: next, activeClipId: active })
  },

  clear: (): void => {
    set({ selectedClipIds: new Set<string>(), activeClipId: null, marquee: null })
  },

  clearSelection: (): void => {
    set({ selectedClipIds: new Set<string>(), activeClipId: null })
  },

  selectRange: (clipId: string, orderedIds: readonly string[]): void => {
    const anchorId = get().activeClipId
    if (!anchorId) {
      set({ selectedClipIds: new Set([clipId]), activeClipId: clipId })
      return
    }
    const anchorIndex = orderedIds.indexOf(anchorId)
    const targetIndex = orderedIds.indexOf(clipId)
    if (anchorIndex === -1 || targetIndex === -1) {
      set({ selectedClipIds: new Set([clipId]), activeClipId: clipId })
      return
    }
    const [start, end] = computeRange(anchorIndex, targetIndex)
    const rangeIds = orderedIds.slice(start, end + 1)
    set({ selectedClipIds: new Set(rangeIds) })
  },

  range: (clipId: string, orderedIds: readonly string[]): void => {
    get().selectRange(clipId, orderedIds)
  },

  marqueeStart: (x: number, y: number): void => {
    set({ marquee: { x, y, width: 0, height: 0 } })
  },

  marqueeUpdate: (width: number, height: number): void => {
    const current = get().marquee
    if (!current) return
    set({ marquee: { ...current, width, height } })
  },

  marqueeEnd: (intersectingIds: readonly string[]): void => {
    if (intersectingIds.length > 0) {
      set({
        selectedClipIds: new Set(intersectingIds),
        activeClipId: intersectingIds[intersectingIds.length - 1] ?? null,
        marquee: null,
      })
    } else {
      set({ marquee: null })
    }
  },

  setSoloMuted: (clipId: string, muted: boolean): void => {
    const next = new Set(get().soloMuted)
    if (muted) next.add(clipId)
    else next.delete(clipId)
    set({ soloMuted: next })
  },
}))
