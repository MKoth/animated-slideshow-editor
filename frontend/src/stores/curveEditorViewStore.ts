import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { BASE_PIXELS_PER_SECOND } from './timelineViewStore'

export const MIN_CURVE_ZOOM = 0.05
export const MAX_CURVE_ZOOM = 200

export type CurveFilter = 'all' | 'position' | 'rotation' | 'scale' | 'opacity' | 'animatedOnly'

export type TimelineViewMode = 'dopeSheet' | 'curveEditor'

export interface CurveEditorViewState {
  readonly zoomX: number
  readonly zoomY: number
  readonly scrollX: number
  readonly scrollY: number
  readonly filter: CurveFilter
  readonly viewMode: TimelineViewMode
  readonly fitPending: boolean
  readonly frameSelectedPending: boolean
  setViewMode(mode: TimelineViewMode): void
  setFilter(filter: CurveFilter): void
  setZoomX(zoom: number): void
  setZoomY(zoom: number): void
  setZoom(zoomX: number, zoomY: number): void
  setScroll(scrollX: number, scrollY: number): void
  syncFromTimeline(zoomLevel: number, scrollTime: number): void
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
    (set) => ({
      zoomX: 100,
      zoomY: 1,
      scrollX: 0,
      scrollY: 0,
      filter: 'all',
      viewMode: 'dopeSheet',
      fitPending: false,
      frameSelectedPending: false,

      setViewMode: (mode) => set({ viewMode: mode }),
      setFilter: (filter) => set({ filter }),

      setZoomX: (zoomX) => set({ zoomX: clamp(zoomX, MIN_CURVE_ZOOM, MAX_CURVE_ZOOM) }),
      setZoomY: (zoomY) => set({ zoomY: clamp(zoomY, MIN_CURVE_ZOOM, MAX_CURVE_ZOOM) }),
      setZoom: (zoomX, zoomY) =>
        set({
          zoomX: clamp(zoomX, MIN_CURVE_ZOOM, MAX_CURVE_ZOOM),
          zoomY: clamp(zoomY, MIN_CURVE_ZOOM, MAX_CURVE_ZOOM),
        }),

      setScroll: (scrollX, scrollY) => set({ scrollX, scrollY }),

      syncFromTimeline: (zoomLevel, scrollTime) =>
        set({
          zoomX: clamp(zoomLevel * BASE_PIXELS_PER_SECOND, MIN_CURVE_ZOOM, MAX_CURVE_ZOOM),
          scrollX: scrollTime,
        }),

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
        zoomX: state.zoomX,
        zoomY: state.zoomY,
        scrollX: state.scrollX,
        scrollY: state.scrollY,
        filter: state.filter,
        viewMode: state.viewMode,
      }),
    },
  ),
)
