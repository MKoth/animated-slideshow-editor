import { create } from 'zustand'
import type { ParentingMode } from '../engine/commands/reparentNodeCommand'

export type { ParentingMode }

interface ParentingModeState {
  mode: ParentingMode
  setMode: (mode: ParentingMode) => void
  reset: () => void
}

export const useParentingModeStore = create<ParentingModeState>((set) => ({
  mode: 'keepWorld',
  setMode: (mode) => set({ mode }),
  reset: () => set({ mode: 'keepWorld' }),
}))
