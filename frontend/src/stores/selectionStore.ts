import { create } from 'zustand'
import type { Unsubscribe } from '../engine'

export interface SelectionActions {
  select(nodeId: string): void
  selectMany(nodeIds: readonly string[]): void
  toggle(nodeId: string): void
  extend(nodeId: string): void
  clear(): void
  prune(validNodeIds: ReadonlySet<string>): void
}

export interface SelectionState extends SelectionActions {
  readonly selectedIds: readonly string[]
}

export interface SelectionStoreApi {
  subscribe(listener: () => void): Unsubscribe
  getState(): Pick<SelectionState, 'selectedIds'>
}

function withoutId(nodeIds: readonly string[], nodeId: string): readonly string[] {
  return nodeIds.filter((id) => id !== nodeId)
}

export const useSelectionStore = create<SelectionState>()((set) => ({
  selectedIds: [],

  select: (nodeId) => set({ selectedIds: [nodeId] }),

  selectMany: (nodeIds) => {
    const unique: string[] = []
    for (const nodeId of nodeIds) {
      if (!unique.includes(nodeId)) {
        unique.push(nodeId)
      }
    }
    set({ selectedIds: unique })
  },

  toggle: (nodeId) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(nodeId)
        ? withoutId(state.selectedIds, nodeId)
        : [...state.selectedIds, nodeId],
    })),

  extend: (nodeId) =>
    set((state) =>
      state.selectedIds.includes(nodeId) ? {} : { selectedIds: [...state.selectedIds, nodeId] },
    ),

  clear: () => set({ selectedIds: [] }),

  prune: (validNodeIds) =>
    set((state) => ({
      selectedIds: state.selectedIds.filter((nodeId) => validNodeIds.has(nodeId)),
    })),
}))
