import { create } from 'zustand'

export interface OverlayVisibilityState {
  readonly meshVisible: boolean
  readonly bonesVisible: boolean
  readonly ikHandlesVisible: boolean
  readonly poleHandlesVisible: boolean
  setMeshVisible(visible: boolean): void
  toggleMeshVisible(): void
  setBonesVisible(visible: boolean): void
  toggleBonesVisible(): void
  setIkHandlesVisible(visible: boolean): void
  toggleIkHandlesVisible(): void
  setPoleHandlesVisible(visible: boolean): void
  togglePoleHandlesVisible(): void
}

export const useOverlayVisibilityStore = create<OverlayVisibilityState>()((set) => ({
  meshVisible: true,
  bonesVisible: true,
  ikHandlesVisible: true,
  poleHandlesVisible: true,
  setMeshVisible: (visible) => set({ meshVisible: visible }),
  toggleMeshVisible: () => set((state) => ({ meshVisible: !state.meshVisible })),
  setBonesVisible: (visible) => set({ bonesVisible: visible }),
  toggleBonesVisible: () => set((state) => ({ bonesVisible: !state.bonesVisible })),
  setIkHandlesVisible: (visible) => set({ ikHandlesVisible: visible }),
  toggleIkHandlesVisible: () => set((state) => ({ ikHandlesVisible: !state.ikHandlesVisible })),
  setPoleHandlesVisible: (visible) => set({ poleHandlesVisible: visible }),
  togglePoleHandlesVisible: () => set((state) => ({ poleHandlesVisible: !state.poleHandlesVisible })),
}))

export const OverlayVisibilityStore = useOverlayVisibilityStore
