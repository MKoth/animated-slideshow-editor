import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface SceneTreeViewState {
  readonly collapsedNodeIds: Readonly<Record<string, boolean>>
  toggleCollapsed(nodeId: string): void
  setCollapsed(nodeId: string, collapsed: boolean): void
  expandAll(): void
  collapseAll(nodeIds: readonly string[]): void
  prune(validIds: ReadonlySet<string>): void
  isCollapsed(nodeId: string): boolean
}

export const useSceneTreeViewStore = create<SceneTreeViewState>()(
  persist(
    (set, get) => ({
      collapsedNodeIds: {},

      toggleCollapsed: (nodeId) =>
        set((state) => ({
          collapsedNodeIds: {
            ...state.collapsedNodeIds,
            [nodeId]: state.collapsedNodeIds[nodeId] !== true,
          },
        })),

      setCollapsed: (nodeId, collapsed) =>
        set((state) => {
          if (collapsed) {
            return { collapsedNodeIds: { ...state.collapsedNodeIds, [nodeId]: true } }
          }
          if (!(nodeId in state.collapsedNodeIds)) return state
          const next = { ...state.collapsedNodeIds }
          delete next[nodeId]
          return { collapsedNodeIds: next }
        }),

      expandAll: () => set({ collapsedNodeIds: {} }),

      collapseAll: (nodeIds) =>
        set({
          collapsedNodeIds: Object.fromEntries(nodeIds.map((id) => [id, true])),
        }),

      prune: (validIds) =>
        set((state) => {
          let changed = false
          const next: Record<string, boolean> = {}
          for (const [id, value] of Object.entries(state.collapsedNodeIds)) {
            if (validIds.has(id)) {
              next[id] = value
            } else {
              changed = true
            }
          }
          return changed ? { collapsedNodeIds: next } : state
        }),

      isCollapsed: (nodeId) => get().collapsedNodeIds[nodeId] === true,
    }),
    {
      name: 'scene-tree-view-state',
      partialize: (state) => ({
        collapsedNodeIds: state.collapsedNodeIds,
      }),
    },
  ),
)
