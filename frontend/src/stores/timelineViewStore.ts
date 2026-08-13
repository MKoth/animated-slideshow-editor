import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_TIMELINE_HEIGHT, MAX_TIMELINE_HEIGHT, MIN_TIMELINE_HEIGHT } from './uiPrefs'

export const BASE_PIXELS_PER_SECOND = 100
export const MIN_TIMELINE_ZOOM = 0.25
export const MAX_TIMELINE_ZOOM = 8
export const ZOOM_STEP = 2
export const DEFAULT_TIMELINE_VIEWPORT_WIDTH = 800
export const TRAILING_SCROLL_PADDING_PX = 80

const RULER_TICK_CANDIDATES = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300] as const
const MIN_TICK_SPACING_PX = 40

export function pixelsPerSecond(zoomLevel: number): number {
  return BASE_PIXELS_PER_SECOND * zoomLevel
}

export function rulerTickStep(pixelsPerSecondValue: number): number {
  for (const step of RULER_TICK_CANDIDATES) {
    if (step * pixelsPerSecondValue >= MIN_TICK_SPACING_PX) {
      return step
    }
  }
  return RULER_TICK_CANDIDATES[RULER_TICK_CANDIDATES.length - 1]
}

function stepDecimals(step: number): number {
  if (step >= 1) {
    return 0
  }
  if (step >= 0.1) {
    return 1
  }
  return 2
}

export function tickLabel(time: number, step: number): string {
  return time.toFixed(stepDecimals(step))
}

export function snapTimeToGrid(time: number, step: number): number {
  const decimals = stepDecimals(step)
  return Number((Math.round(time / step) * step).toFixed(decimals))
}

export function rulerTickTimes(start: number, end: number, step: number): number[] {
  const decimals = stepDecimals(step)
  const times: number[] = []
  const first = Math.ceil((start - 1e-9) / step) * step || 0
  const last = Math.floor((end + 1e-9) / step) * step
  for (let time = first; time <= last + 1e-9; time = Number((time + step).toFixed(decimals))) {
    times.push(time)
  }
  return times
}

export function clampScrollTime(
  time: number,
  pixelsPerSecondValue: number,
  viewportWidth: number,
  duration: number,
  trailingPaddingPx = 0,
): number {
  const max =
    duration + trailingPaddingPx / pixelsPerSecondValue - viewportWidth / pixelsPerSecondValue
  return Math.min(Math.max(time, 0), Math.max(0, max))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export interface TimelineViewState {
  readonly zoomLevel: number
  readonly scrollTime: number
  readonly height: number
  readonly expandedNodeIds: Readonly<Record<string, boolean>>
  toggleExpanded(nodeId: string): void
  setZoom(zoomLevel: number, anchorTime: number, viewportWidth: number, duration: number): void
  zoomIn(anchorTime: number, viewportWidth: number, duration: number): void
  zoomOut(anchorTime: number, viewportWidth: number, duration: number): void
  fitTimeline(duration: number, viewportWidth: number): void
  setScrollTime(time: number, viewportWidth: number, duration: number): void
  setHeight(height: number): void
}

export const useTimelineViewStore = create<TimelineViewState>()(
  persist(
    (set, get) => ({
      zoomLevel: 1,
      scrollTime: 0,
      height: DEFAULT_TIMELINE_HEIGHT,
      expandedNodeIds: {},

      toggleExpanded: (nodeId) =>
        set((state) => ({
          expandedNodeIds: {
            ...state.expandedNodeIds,
            [nodeId]: state.expandedNodeIds[nodeId] !== true,
          },
        })),

      setHeight: (height) =>
        set({ height: clamp(height, MIN_TIMELINE_HEIGHT, MAX_TIMELINE_HEIGHT) }),

      setScrollTime: (time, viewportWidth, duration) =>
        set({
          scrollTime: clampScrollTime(
            time,
            pixelsPerSecond(get().zoomLevel),
            viewportWidth,
            duration,
            TRAILING_SCROLL_PADDING_PX,
          ),
        }),

      setZoom: (zoomLevel, anchorTime, viewportWidth, duration) => {
        const current = get()
        const bounded = clamp(zoomLevel, MIN_TIMELINE_ZOOM, MAX_TIMELINE_ZOOM)
        const oldPps = pixelsPerSecond(current.zoomLevel)
        const newPps = pixelsPerSecond(bounded)
        const scrolled = anchorTime - (anchorTime - current.scrollTime) * (oldPps / newPps)
        set({
          zoomLevel: bounded,
          scrollTime: clampScrollTime(
            scrolled,
            newPps,
            viewportWidth,
            duration,
            TRAILING_SCROLL_PADDING_PX,
          ),
        })
      },

      zoomIn: (anchorTime, viewportWidth, duration) => {
        const current = get()
        current.setZoom(current.zoomLevel * ZOOM_STEP, anchorTime, viewportWidth, duration)
      },

      zoomOut: (anchorTime, viewportWidth, duration) => {
        const current = get()
        current.setZoom(current.zoomLevel / ZOOM_STEP, anchorTime, viewportWidth, duration)
      },

      fitTimeline: (duration, viewportWidth) => {
        const pps = duration > 0 ? viewportWidth / duration : Number.POSITIVE_INFINITY
        set({
          zoomLevel: clamp(pps / BASE_PIXELS_PER_SECOND, MIN_TIMELINE_ZOOM, MAX_TIMELINE_ZOOM),
          scrollTime: 0,
        })
      },
    }),
    {
      name: 'timeline-view-state',
      partialize: (state) => ({
        zoomLevel: state.zoomLevel,
        scrollTime: state.scrollTime,
        height: state.height,
      }),
    },
  ),
)
