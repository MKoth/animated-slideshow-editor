import { create } from 'zustand'

export interface HighlightRequest {
  readonly hostNodeId: string
  readonly controlKey?: string
}

interface AnimationManagerNavState {
  readonly pending: HighlightRequest | null
  requestHighlight(hostNodeId: string, controlKey?: string): void
  clear(): void
}

export const useAnimationManagerNavStore = create<AnimationManagerNavState>((set) => ({
  pending: null,
  requestHighlight: (hostNodeId, controlKey) => set({ pending: { hostNodeId, controlKey } }),
  clear: () => set({ pending: null }),
}))
