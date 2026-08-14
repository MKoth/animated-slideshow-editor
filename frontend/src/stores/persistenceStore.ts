import { create } from 'zustand'

interface PersistenceState {
  dirty: boolean
  markDirty: () => void
  markSaved: () => void
}

export const usePersistenceStore = create<PersistenceState>()((set) => ({
  dirty: false,
  markDirty: () => set({ dirty: true }),
  markSaved: () => set({ dirty: false }),
}))
