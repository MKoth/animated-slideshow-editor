import { create } from 'zustand'

export const GHOST_DEFAULT_COLOR = 0xff8c42
export const GHOST_DEFAULT_ALPHA = 0.28
export const GHOST_WIRE_ALPHA = 0.55

export interface ShapeGhostState {
  readonly ghostShapeId: string | null
  readonly ghostColor: number
  readonly ghostAlpha: number
  setGhost(shapeId: string | null): void
  setGhostOptions(opts: { color?: number; alpha?: number }): void
  clearGhost(): void
}

export const useShapeGhostStore = create<ShapeGhostState>()((set) => ({
  ghostShapeId: null,
  ghostColor: GHOST_DEFAULT_COLOR,
  ghostAlpha: GHOST_DEFAULT_ALPHA,
  setGhost: (shapeId) => set({ ghostShapeId: shapeId }),
  setGhostOptions: (opts) =>
    set((s) => ({
      ghostColor: opts.color ?? s.ghostColor,
      ghostAlpha: opts.alpha ?? s.ghostAlpha,
    })),
  clearGhost: () => set({ ghostShapeId: null }),
}))
