import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface ShapeCategoryViewState {
  readonly collapsedIds: Readonly<Record<string, boolean>> // key: `${nodeId}:${categoryId}`
  isCollapsed: (nodeId: string, categoryId: string) => boolean
  toggleCollapsed: (nodeId: string, categoryId: string) => void
  setCollapsed: (nodeId: string, categoryId: string, collapsed: boolean) => void
  prune: (validKeys: ReadonlySet<string>) => void
}

function keyOf(nodeId: string, categoryId: string): string {
  return `${nodeId}:${categoryId}`
}

export const useShapeCategoryViewStore = create<ShapeCategoryViewState>()(
  persist(
    (set, get) => ({
      collapsedIds: {},

      isCollapsed: (nodeId, categoryId) => get().collapsedIds[keyOf(nodeId, categoryId)] === true,

      toggleCollapsed: (nodeId, categoryId) =>
        set((state) => {
          const k = keyOf(nodeId, categoryId)
          const next = { ...state.collapsedIds }
          if (next[k]) delete next[k]
          else next[k] = true
          return { collapsedIds: next }
        }),

      setCollapsed: (nodeId, categoryId, collapsed) =>
        set((state) => {
          const k = keyOf(nodeId, categoryId)
          if (collapsed) return { collapsedIds: { ...state.collapsedIds, [k]: true } }
          if (!(k in state.collapsedIds)) return state
          const next = { ...state.collapsedIds }
          delete next[k]
          return { collapsedIds: next }
        }),

      prune: (validKeys) =>
        set((state) => {
          let changed = false
          const next: Record<string, boolean> = {}
          for (const [k, v] of Object.entries(state.collapsedIds)) {
            if (validKeys.has(k)) next[k] = v
            else changed = true
          }
          return changed ? { collapsedIds: next } : state
        }),
    }),
    {
      name: 'shape-category-view-state',
      partialize: (state) => ({ collapsedIds: state.collapsedIds }),
    },
  ),
)
