import { create } from 'zustand'
import type { WorldPoint } from '../pixi/renderer/worldGeometry'

export interface BoneCreationState {
  readonly pendingStart: WorldPoint | null
  setPendingStart(point: WorldPoint | null): void
  clear(): void
}

export const useBoneCreationStore = create<BoneCreationState>()((set) => ({
  pendingStart: null,
  setPendingStart: (point) => set({ pendingStart: point }),
  clear: () => set({ pendingStart: null }),
}))
