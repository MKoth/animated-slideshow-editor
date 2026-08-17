import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const MIN_CURVE_ZOOM = 0.25
export const MAX_CURVE_ZOOM = 8
export const CURVE_ZOOM_STEP = 2

export type CurveFilter = 'all' | 'position' | 'rotation' | 'scale' | 'opacity' | 'animatedOnly'

export type TimelineViewMode = 'dopeSheet' | 'curveEditor'

export interface CurveEditorViewState {
  readonly zoomLevel: number
  readonly scrollX: number
  readonly scrollY: number
  readonly filter: CurveFilter
  readonly viewMode: TimelineViewMode
  readonly fitPending: boolean
  readonly frameSelectedPending: boolean
  setViewMode(mode: TimelineViewMode): void
  setFilter(filter: CurveFilter): void
  setZoom(zoomLevel: number, centerX: number, viewportWidth: number): void
  zoomIn(centerX: number, viewportWidth: number): void
  zoomOut(centerX: number, viewportWidth: number): void
  setScroll(scrollX: number, scrollY: number): void
  pan(dx: number, dy: number): void
  fitCurves(): void
  clearFitPending(): void
  frameSelected(): void
  clearFrameSelectedPending(): void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export const useCurveEditorViewStore = create<CurveEditorViewState>()(
  persist(
    (set, get) => ({
      zoomLevel: 1,
      scrollX: 0,
      scrollY: 0,
      filter: 'all',
      viewMode: 'dopeSheet',
      fitPending: false,
      frameSelectedPending: false,

      setViewMode: (mode) => set({ viewMode: mode }),

      setFilter: (filter) => set({ filter }),

      setZoom: (zoomLevel, centerX) => {
        const current = get()
        const bounded = clamp(zoomLevel, MIN_CURVE_ZOOM, MAX_CURVE_ZOOM)
        const oldScale = current.zoomLevel
        const newScale = bounded
        const scrolled = centerX - (centerX - current.scrollX) * (oldScale / newScale)
        set({
          zoomLevel: bounded,
          scrollX: scrolled,
        })
      },

      zoomIn: (centerX, viewportWidth) => {
        const current = get()
        current.setZoom(current.zoomLevel * CURVE_ZOOM_STEP, centerX, viewportWidth)
      },

      zoomOut: (centerX, viewportWidth) => {
        const current = get()
        current.setZoom(current.zoomLevel / CURVE_ZOOM_STEP, centerX, viewportWidth)
      },

      setScroll: (scrollX, scrollY) => set({ scrollX, scrollY }),

      pan: (dx, dy) =>
        set((state) => ({
          scrollX: state.scrollX + dx,
          scrollY: state.scrollY + dy,
        })),

      fitCurves: () => set({ fitPending: true }),

      clearFitPending: () => set({ fitPending: false }),

      frameSelected: () => set({ frameSelectedPending: true }),

      clearFrameSelectedPending: () => set({ frameSelectedPending: false }),
    }),
    {
      name: 'curve-editor-view-state',
      partialize: (state) => ({
        zoomLevel: state.zoomLevel,
        scrollX: state.scrollX,
        scrollY: state.scrollY,
        filter: state.filter,
        viewMode: state.viewMode,
      }),
    },
  ),
)
