import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMELINE_HEIGHT,
  MAX_TIMELINE_HEIGHT,
  MIN_TIMELINE_HEIGHT,
} from '../stores/uiPrefs'
import {
  BASE_PIXELS_PER_SECOND,
  MAX_TIMELINE_ZOOM,
  MIN_TIMELINE_ZOOM,
  clampScrollTime,
  pixelsPerSecond,
  rulerTickStep,
  rulerTickTimes,
  snapTimeToGrid,
  tickLabel,
  useTimelineViewStore,
} from '../stores/timelineViewStore'

describe('pixelsPerSecond', () => {
  it('scales the base rate by the zoom level', () => {
    expect(pixelsPerSecond(1)).toBe(BASE_PIXELS_PER_SECOND)
    expect(pixelsPerSecond(2)).toBe(BASE_PIXELS_PER_SECOND * 2)
    expect(pixelsPerSecond(0.5)).toBe(BASE_PIXELS_PER_SECOND / 2)
  })
})

describe('ruler ticks', () => {
  it('ticks at 0.5s steps at the default zoom level', () => {
    expect(rulerTickStep(pixelsPerSecond(1))).toBe(0.5)
  })

  it('adapts the step to the zoom level', () => {
    expect(rulerTickStep(pixelsPerSecond(8))).toBe(0.05)
    expect(rulerTickStep(pixelsPerSecond(0.25))).toBe(2)
  })

  it('generates tick times aligned to the grid across a range', () => {
    expect(rulerTickTimes(0, 2, 0.5)).toEqual([0, 0.5, 1, 1.5, 2])
    expect(rulerTickTimes(0.3, 1.6, 0.5)).toEqual([0.5, 1, 1.5])
  })

  it('labels ticks with a precision that matches the step', () => {
    expect(tickLabel(0, 0.5)).toBe('0.0')
    expect(tickLabel(1, 0.5)).toBe('1.0')
    expect(tickLabel(2, 1)).toBe('2')
    expect(tickLabel(1.2, 0.2)).toBe('1.2')
    expect(tickLabel(0.1, 0.05)).toBe('0.10')
  })
})

describe('snapTimeToGrid', () => {
  it('snaps to the nearest ruler grid step', () => {
    expect(snapTimeToGrid(0.37, 0.5)).toBe(0.5)
    expect(snapTimeToGrid(0.2, 0.5)).toBe(0)
    expect(snapTimeToGrid(0.75, 0.5)).toBe(1)
    expect(snapTimeToGrid(1.24, 0.2)).toBe(1.2)
  })
})

describe('clampScrollTime', () => {
  it('keeps the scroll time within the scrollable range', () => {
    const pps = pixelsPerSecond(1)
    expect(clampScrollTime(-1, pps, 200, 10)).toBe(0)
    expect(clampScrollTime(5, pps, 200, 10)).toBe(5)
    expect(clampScrollTime(20, pps, 200, 10)).toBe(8)
  })

  it('returns 0 when the content fits entirely in the viewport', () => {
    expect(clampScrollTime(3, pixelsPerSecond(1), 2000, 10)).toBe(0)
  })

  it('lets the scroll extend past the duration by the trailing padding', () => {
    const pps = pixelsPerSecond(1)
    expect(clampScrollTime(20, pps, 800, 10, 80)).toBeCloseTo(10 + 0.8 - 8)
    expect(clampScrollTime(9, pps, 800, 10, 80)).toBeCloseTo(10 + 0.8 - 8)
  })
})

describe('TimelineViewStore', () => {
  beforeEach(() => {
    useTimelineViewStore.persist.clearStorage()
    useTimelineViewStore.setState({
      zoomLevel: 1,
      scrollTime: 0,
      height: DEFAULT_TIMELINE_HEIGHT,
      gridSnapEnabled: true,
      snapToKeyframesEnabled: false,
    })
  })

  it('starts at default zoom, scroll and panel height', () => {
    const state = useTimelineViewStore.getState()
    expect(state.zoomLevel).toBe(1)
    expect(state.scrollTime).toBe(0)
    expect(state.height).toBe(DEFAULT_TIMELINE_HEIGHT)
  })

  it('clamps the panel height to the supported range', () => {
    useTimelineViewStore.getState().setHeight(5000)
    expect(useTimelineViewStore.getState().height).toBe(MAX_TIMELINE_HEIGHT)
    useTimelineViewStore.getState().setHeight(-10)
    expect(useTimelineViewStore.getState().height).toBe(MIN_TIMELINE_HEIGHT)
  })

  it('zooms in and out with the anchor time staying under the cursor', () => {
    const store = useTimelineViewStore.getState()
    store.setScrollTime(2, 800, 10)
    store.setZoom(2, 4, 800, 10)
    let state = useTimelineViewStore.getState()
    expect(state.zoomLevel).toBe(2)
    const kept = 4 - ((4 - 2) * pixelsPerSecond(1)) / pixelsPerSecond(2)
    expect(state.scrollTime).toBeCloseTo(kept, 6)

    store.setZoom(0.5, 4, 800, 10)
    state = useTimelineViewStore.getState()
    expect(state.zoomLevel).toBe(0.5)
    expect(state.scrollTime).toBeCloseTo(
      4 - ((4 - 2) * pixelsPerSecond(1)) / pixelsPerSecond(0.5),
      6,
    )
  })

  it('clamps the zoom level to the supported range', () => {
    const store = useTimelineViewStore.getState()
    store.setZoom(64, 0, 800, 10)
    expect(useTimelineViewStore.getState().zoomLevel).toBe(MAX_TIMELINE_ZOOM)
    store.setZoom(0.01, 0, 800, 10)
    expect(useTimelineViewStore.getState().zoomLevel).toBe(MIN_TIMELINE_ZOOM)
  })

  it('keeps the scroll time clamped while zooming', () => {
    const store = useTimelineViewStore.getState()
    store.setScrollTime(9, 800, 10)
    store.setZoom(2, 4, 800, 10)
    const state = useTimelineViewStore.getState()
    expect(state.scrollTime).toBeLessThanOrEqual(clampScrollTime(100, pixelsPerSecond(2), 800, 10))
  })

  it('fits the full duration into the viewport', () => {
    const store = useTimelineViewStore.getState()
    store.fitTimeline(10, 1000)
    let state = useTimelineViewStore.getState()
    expect(state.zoomLevel).toBe(1)
    expect(state.scrollTime).toBe(0)

    store.fitTimeline(100, 1000)
    state = useTimelineViewStore.getState()
    expect(state.zoomLevel).toBe(MIN_TIMELINE_ZOOM)
  })

  it('persists zoom, scroll and height in localStorage', async () => {
    const store = useTimelineViewStore.getState()
    store.setZoom(2, 0, 800, 10)
    store.setScrollTime(3, 200, 10)
    store.setHeight(300)

    const persisted = localStorage.getItem('timeline-view-state')
    expect(persisted).not.toBeNull()
    expect(persisted).toContain('"zoomLevel":2')
    expect(persisted).toContain('"scrollTime":3')
    expect(persisted).toContain('"height":300')

    useTimelineViewStore.setState({
      zoomLevel: 1,
      scrollTime: 0,
      height: DEFAULT_TIMELINE_HEIGHT,
      gridSnapEnabled: true,
      snapToKeyframesEnabled: false,
    })
    localStorage.setItem('timeline-view-state', persisted ?? '')
    await useTimelineViewStore.persist.rehydrate()
    const state = useTimelineViewStore.getState()
    expect(state.zoomLevel).toBe(2)
    expect(state.scrollTime).toBe(3)
    expect(state.height).toBe(300)
  })

  it('persists gridSnapEnabled and snapToKeyframesEnabled in localStorage', async () => {
    const store = useTimelineViewStore.getState()
    store.setGridSnapEnabled(false)
    store.setSnapToKeyframesEnabled(true)

    const persisted = localStorage.getItem('timeline-view-state')
    expect(persisted).not.toBeNull()
    expect(persisted).toContain('"gridSnapEnabled":false')
    expect(persisted).toContain('"snapToKeyframesEnabled":true')

    useTimelineViewStore.setState({
      zoomLevel: 1,
      scrollTime: 0,
      height: DEFAULT_TIMELINE_HEIGHT,
      gridSnapEnabled: true,
      snapToKeyframesEnabled: false,
    })
    localStorage.setItem('timeline-view-state', persisted ?? '')
    await useTimelineViewStore.persist.rehydrate()
    const state = useTimelineViewStore.getState()
    expect(state.gridSnapEnabled).toBe(false)
    expect(state.snapToKeyframesEnabled).toBe(true)
  })

  it('defaults gridSnapEnabled to true and snapToKeyframesEnabled to false', () => {
    const state = useTimelineViewStore.getState()
    expect(state.gridSnapEnabled).toBe(true)
    expect(state.snapToKeyframesEnabled).toBe(false)
  })

  it('toggles gridSnapEnabled', () => {
    const store = useTimelineViewStore.getState()
    expect(store.gridSnapEnabled).toBe(true)
    store.toggleGridSnap()
    expect(useTimelineViewStore.getState().gridSnapEnabled).toBe(false)
    store.toggleGridSnap()
    expect(useTimelineViewStore.getState().gridSnapEnabled).toBe(true)
  })

  it('toggles snapToKeyframesEnabled', () => {
    const store = useTimelineViewStore.getState()
    expect(store.snapToKeyframesEnabled).toBe(false)
    store.toggleSnapToKeyframes()
    expect(useTimelineViewStore.getState().snapToKeyframesEnabled).toBe(true)
    store.toggleSnapToKeyframes()
    expect(useTimelineViewStore.getState().snapToKeyframesEnabled).toBe(false)
  })
})
