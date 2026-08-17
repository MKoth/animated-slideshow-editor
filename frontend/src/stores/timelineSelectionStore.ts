import { create } from 'zustand'

export type EditingContext = 'slide' | 'clip-edit'

export interface KeyframeSelectionItem {
  readonly keyframeId: string
  readonly time: number
  readonly rowIndex: number
}

interface MarqueeAnchor {
  readonly x: number
  readonly y: number
}

interface TimelineSelectionState {
  readonly editingContext: EditingContext
  readonly selections: Readonly<Record<EditingContext, readonly KeyframeSelectionItem[]>>
  readonly anchorKeyframeId: Readonly<Record<EditingContext, string | null>>
  readonly marqueeAnchor: MarqueeAnchor | null
}

interface TimelineSelectionActions {
  setEditingContext(context: EditingContext): void
  selectKeyframe(keyframeId: string, meta?: { time: number; rowIndex: number }): void
  toggleKeyframe(keyframeId: string, meta?: { time: number; rowIndex: number }): void
  selectKeyframeRange(
    keyframeId: string,
    meta: KeyframeSelectionItem,
    allItems: readonly KeyframeSelectionItem[],
  ): void
  marqueeStart(x: number, y: number): void
  marqueeEnd(
    intersectingKeyframeIds: readonly string[],
    allItems: readonly KeyframeSelectionItem[],
  ): void
  clearSelection(): void
  pruneSelection(validKeyframeIds: ReadonlySet<string>): void
}

export type TimelineSelectionStore = TimelineSelectionState & TimelineSelectionActions

/** Derive the ordered keyframe IDs for the given editing context. */
export function selectedKeyframeIdsOf(
  state: Pick<TimelineSelectionState, 'editingContext' | 'selections'>,
): readonly string[] {
  return state.selections[state.editingContext].map((item) => item.keyframeId)
}

function appendUnique(
  items: readonly KeyframeSelectionItem[],
  item: KeyframeSelectionItem,
): readonly KeyframeSelectionItem[] {
  if (items.some((i) => i.keyframeId === item.keyframeId)) {
    return items
  }
  return [...items, item]
}

function withoutKeyframeId(
  items: readonly KeyframeSelectionItem[],
  keyframeId: string,
): readonly KeyframeSelectionItem[] {
  return items.filter((i) => i.keyframeId !== keyframeId)
}

function computeRange(anchorIndex: number, targetIndex: number): [number, number] {
  return anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
}

export const useTimelineSelectionStore = create<TimelineSelectionStore>()((set, get) => ({
  editingContext: 'slide',
  selections: { slide: [], 'clip-edit': [] },
  anchorKeyframeId: { slide: null, 'clip-edit': null },
  marqueeAnchor: null,

  setEditingContext: (context) => set({ editingContext: context }),

  selectKeyframe: (keyframeId, meta) => {
    const ctx = get().editingContext
    const item: KeyframeSelectionItem = meta
      ? { keyframeId, time: meta.time, rowIndex: meta.rowIndex }
      : { keyframeId, time: 0, rowIndex: 0 }
    set({
      selections: { ...get().selections, [ctx]: [item] },
      anchorKeyframeId: { ...get().anchorKeyframeId, [ctx]: keyframeId },
    })
  },

  toggleKeyframe: (keyframeId, meta) => {
    const ctx = get().editingContext
    const current = get().selections[ctx]
    const exists = current.some((i) => i.keyframeId === keyframeId)
    let next: readonly KeyframeSelectionItem[]
    if (exists) {
      next = withoutKeyframeId(current, keyframeId)
    } else {
      const item: KeyframeSelectionItem = meta
        ? { keyframeId, time: meta.time, rowIndex: meta.rowIndex }
        : { keyframeId, time: 0, rowIndex: 0 }
      next = appendUnique(current, item)
    }
    set({ selections: { ...get().selections, [ctx]: next } })
  },

  selectKeyframeRange: (keyframeId, meta, allItems) => {
    const ctx = get().editingContext
    const anchorId = get().anchorKeyframeId[ctx]
    if (!anchorId) {
      set({
        selections: { ...get().selections, [ctx]: [meta] },
        anchorKeyframeId: { ...get().anchorKeyframeId, [ctx]: keyframeId },
      })
      return
    }
    const anchorIndex = allItems.findIndex((i) => i.keyframeId === anchorId)
    const targetIndex = allItems.findIndex((i) => i.keyframeId === keyframeId)
    if (anchorIndex === -1 || targetIndex === -1) {
      set({
        selections: { ...get().selections, [ctx]: [meta] },
        anchorKeyframeId: { ...get().anchorKeyframeId, [ctx]: keyframeId },
      })
      return
    }
    const [start, end] = computeRange(anchorIndex, targetIndex)
    const rangeItems = allItems.slice(start, end + 1)
    set({ selections: { ...get().selections, [ctx]: rangeItems } })
  },

  marqueeStart: (x, y) => set({ marqueeAnchor: { x, y } }),

  marqueeEnd: (intersectingKeyframeIds, allItems) => {
    const ctx = get().editingContext
    if (intersectingKeyframeIds.length > 0) {
      const itemById = new Map(allItems.map((item) => [item.keyframeId, item]))
      const items: KeyframeSelectionItem[] = intersectingKeyframeIds
        .map((id) => itemById.get(id))
        .filter((item): item is KeyframeSelectionItem => item !== undefined)
      set({
        selections: { ...get().selections, [ctx]: items },
        marqueeAnchor: null,
      })
    } else {
      set({ marqueeAnchor: null })
    }
  },

  clearSelection: () => {
    const ctx = get().editingContext
    set({
      selections: { ...get().selections, [ctx]: [] },
      anchorKeyframeId: { ...get().anchorKeyframeId, [ctx]: null },
    })
  },

  pruneSelection: (validKeyframeIds) => {
    const ctx = get().editingContext
    const current = get().selections[ctx]
    const pruned = current.filter((item) => validKeyframeIds.has(item.keyframeId))
    const anchorId = get().anchorKeyframeId[ctx]
    const newAnchor = anchorId && !validKeyframeIds.has(anchorId) ? null : anchorId
    set({
      selections: { ...get().selections, [ctx]: pruned },
      anchorKeyframeId: { ...get().anchorKeyframeId, [ctx]: newAnchor },
    })
  },
}))
