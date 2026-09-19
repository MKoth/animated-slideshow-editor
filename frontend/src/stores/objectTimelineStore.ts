import { create } from 'zustand'

interface ObjectTimelineState {
  readonly nodeId: string | null
  open(nodeId: string): void
  close(): void
}

export const useObjectTimelineStore = create<ObjectTimelineState>()((set) => ({
  nodeId: null,
  open: (nodeId) => set({ nodeId }),
  close: () => set({ nodeId: null }),
}))
