import { create } from 'zustand'

export interface OverlayVisibilityState {
  readonly meshVisible: boolean
  readonly bonesVisible: boolean
  setMeshVisible(visible: boolean): void
  toggleMeshVisible(): void
  setBonesVisible(visible: boolean): void
  toggleBonesVisible(): void
}

export const useOverlayVisibilityStore = create<OverlayVisibilityState>()((set) => ({
  meshVisible: true,
  bonesVisible: true,
  setMeshVisible: (visible) => set({ meshVisible: visible }),
  toggleMeshVisible: () => set((state) => ({ meshVisible: !state.meshVisible })),
  setBonesVisible: (visible) => set({ bonesVisible: visible }),
  toggleBonesVisible: () => set((state) => ({ bonesVisible: !state.bonesVisible })),
}))

export const OverlayVisibilityStore = useOverlayVisibilityStore
