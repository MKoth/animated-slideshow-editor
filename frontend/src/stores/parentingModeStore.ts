import { create } from 'zustand'
import type { ParentingMode } from '../engine/commands/reparentNodeCommand'

export type { ParentingMode }

interface ParentingModeState {
  mode: ParentingMode
  rememberChoice: boolean
  setMode: (mode: ParentingMode) => void
  setRememberChoice: (remember: boolean) => void
  reset: () => void
}

export const useParentingModeStore = create<ParentingModeState>((set) => ({
  mode: 'keepWorld',
  rememberChoice: false,
  setMode: (mode) => set({ mode }),
  setRememberChoice: (rememberChoice) => set({ rememberChoice }),
  reset: () => set({ mode: 'keepWorld', rememberChoice: false }),
}))
