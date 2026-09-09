import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface OverlayVisibilityState {
  readonly meshVisible: boolean
  readonly bonesVisible: boolean
  readonly ikHandlesVisible: boolean
  readonly poleHandlesVisible: boolean
  readonly vertexSize: number
  setMeshVisible(visible: boolean): void
  toggleMeshVisible(): void
  setBonesVisible(visible: boolean): void
  toggleBonesVisible(): void
  setIkHandlesVisible(visible: boolean): void
  toggleIkHandlesVisible(): void
  setPoleHandlesVisible(visible: boolean): void
  togglePoleHandlesVisible(): void
  setVertexSize(size: number): void
}

export const useOverlayVisibilityStore = create<OverlayVisibilityState>()(
  persist(
    (set) => ({
      meshVisible: true,
      bonesVisible: true,
      ikHandlesVisible: true,
      poleHandlesVisible: true,
      vertexSize: 6,
      setMeshVisible: (visible) => set({ meshVisible: visible }),
      toggleMeshVisible: () => set((state) => ({ meshVisible: !state.meshVisible })),
      setBonesVisible: (visible) => set({ bonesVisible: visible }),
      toggleBonesVisible: () => set((state) => ({ bonesVisible: !state.bonesVisible })),
      setIkHandlesVisible: (visible) => set({ ikHandlesVisible: visible }),
      toggleIkHandlesVisible: () => set((state) => ({ ikHandlesVisible: !state.ikHandlesVisible })),
      setPoleHandlesVisible: (visible) => set({ poleHandlesVisible: visible }),
      togglePoleHandlesVisible: () =>
        set((state) => ({ poleHandlesVisible: !state.poleHandlesVisible })),
      setVertexSize: (size) => set({ vertexSize: Math.min(12, Math.max(2, Math.round(size))) }),
    }),
    {
      name: 'overlay-visibility',
      partialize: (state) => ({
        meshVisible: state.meshVisible,
        bonesVisible: state.bonesVisible,
        ikHandlesVisible: state.ikHandlesVisible,
        poleHandlesVisible: state.poleHandlesVisible,
        vertexSize: state.vertexSize,
      }),
    },
  ),
)

export const OverlayVisibilityStore = useOverlayVisibilityStore
