import { create } from 'zustand'

export type EditingMode =
  'default' | 'boneCreation' | 'ikTarget' | 'poleVector' | 'meshEdit' | 'weightPaint'

export interface EditingModeState {
  readonly mode: EditingMode
  readonly selectedNodeId: string | null
  setMode: (mode: EditingMode) => void
  setSelectedNodeId: (nodeId: string | null) => void
  exitMode: () => void
}

export const useEditingModeStore = create<EditingModeState>()((set) => ({
  mode: 'default',
  selectedNodeId: null,

  setMode: (mode) => set({ mode }),

  setSelectedNodeId: (nodeId) => set({ selectedNodeId: nodeId }),

  exitMode: () => set({ mode: 'default', selectedNodeId: null }),
}))
