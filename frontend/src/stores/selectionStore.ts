import { create } from 'zustand'
import type { Unsubscribe } from '../engine'

export interface SelectionActions {
  select(nodeId: string): void
  selectMany(nodeIds: readonly string[]): void
  toggle(nodeId: string): void
  extend(nodeId: string): void
  clear(): void
  prune(validNodeIds: ReadonlySet<string>): void
  selectKeyframes(keyframeIds: readonly string[]): void
  toggleKeyframe(keyframeId: string): void
  clearKeyframes(): void
  pruneKeyframes(validKeyframeIds: ReadonlySet<string>): void
}

export interface SelectionState extends SelectionActions {
  readonly selectedIds: readonly string[]
  readonly selectedKeyframeIds: readonly string[]
}

export interface SelectionStoreApi {
  subscribe(listener: () => void): Unsubscribe
  getState(): Pick<SelectionState, 'selectedIds' | 'selectedKeyframeIds'>
}

function withoutId(ids: readonly string[], id: string): readonly string[] {
  return ids.filter((candidate) => candidate !== id)
}

function uniqueIds(ids: readonly string[]): string[] {
  const unique: string[] = []
  for (const id of ids) {
    if (!unique.includes(id)) {
      unique.push(id)
    }
  }
  return unique
}

export const useSelectionStore = create<SelectionState>()((set) => ({
  selectedIds: [],
  selectedKeyframeIds: [],

  select: (nodeId) => set({ selectedIds: [nodeId], selectedKeyframeIds: [] }),

  selectMany: (nodeIds) => set({ selectedIds: uniqueIds(nodeIds), selectedKeyframeIds: [] }),

  toggle: (nodeId) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(nodeId)
        ? withoutId(state.selectedIds, nodeId)
        : [...state.selectedIds, nodeId],
      selectedKeyframeIds: [],
    })),

  extend: (nodeId) =>
    set((state) =>
      state.selectedIds.includes(nodeId)
        ? { selectedKeyframeIds: [] }
        : { selectedIds: [...state.selectedIds, nodeId], selectedKeyframeIds: [] },
    ),

  clear: () => set({ selectedIds: [], selectedKeyframeIds: [] }),

  prune: (validNodeIds) =>
    set((state) => ({
      selectedIds: state.selectedIds.filter((nodeId) => validNodeIds.has(nodeId)),
    })),

  selectKeyframes: (keyframeIds) =>
    set({ selectedKeyframeIds: uniqueIds(keyframeIds), selectedIds: [] }),

  toggleKeyframe: (keyframeId) =>
    set((state) => ({
      selectedKeyframeIds: state.selectedKeyframeIds.includes(keyframeId)
        ? withoutId(state.selectedKeyframeIds, keyframeId)
        : [...state.selectedKeyframeIds, keyframeId],
      selectedIds: [],
    })),

  clearKeyframes: () => set({ selectedKeyframeIds: [] }),

  pruneKeyframes: (validKeyframeIds) =>
    set((state) => ({
      selectedKeyframeIds: state.selectedKeyframeIds.filter((keyframeId) =>
        validKeyframeIds.has(keyframeId),
      ),
    })),
}))
