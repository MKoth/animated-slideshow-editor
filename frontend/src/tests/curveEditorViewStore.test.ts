import { beforeEach, describe, expect, it } from 'vitest'
import { useCurveEditorViewStore } from '../stores/curveEditorViewStore'

beforeEach(() => {
  useCurveEditorViewStore.persist.clearStorage()
  useCurveEditorViewStore.setState({
    zoomLevel: 1,
    scrollX: 0,
    scrollY: 0,
    filter: 'all',
    viewMode: 'dopeSheet',
    fitPending: false,
    frameSelectedPending: false,
  })
  localStorage.clear()
})

describe('curveEditorViewStore', () => {
  it('has default state', () => {
    const state = useCurveEditorViewStore.getState()
    expect(state.zoomLevel).toBe(1)
    expect(state.scrollX).toBe(0)
    expect(state.scrollY).toBe(0)
    expect(state.filter).toBe('all')
    expect(state.viewMode).toBe('dopeSheet')
    expect(state.fitPending).toBe(false)
    expect(state.frameSelectedPending).toBe(false)
  })

  it('setViewMode toggles between dopeSheet and curveEditor', () => {
    const { setViewMode } = useCurveEditorViewStore.getState()
    setViewMode('curveEditor')
    expect(useCurveEditorViewStore.getState().viewMode).toBe('curveEditor')
    setViewMode('dopeSheet')
    expect(useCurveEditorViewStore.getState().viewMode).toBe('dopeSheet')
  })

  it('setFilter changes the active filter', () => {
    const { setFilter } = useCurveEditorViewStore.getState()
    setFilter('position')
    expect(useCurveEditorViewStore.getState().filter).toBe('position')
    setFilter('rotation')
    expect(useCurveEditorViewStore.getState().filter).toBe('rotation')
    setFilter('scale')
    expect(useCurveEditorViewStore.getState().filter).toBe('scale')
    setFilter('opacity')
    expect(useCurveEditorViewStore.getState().filter).toBe('opacity')
    setFilter('animatedOnly')
    expect(useCurveEditorViewStore.getState().filter).toBe('animatedOnly')
    setFilter('all')
    expect(useCurveEditorViewStore.getState().filter).toBe('all')
  })

  it('setZoom clamps zoom level and adjusts scroll', () => {
    const { setZoom } = useCurveEditorViewStore.getState()
    setZoom(5, 100, 200)
    const state = useCurveEditorViewStore.getState()
    expect(state.zoomLevel).toBe(5)
  })

  it('setZoom clamps to minimum', () => {
    const { setZoom } = useCurveEditorViewStore.getState()
    setZoom(0.01, 0, 800)
    expect(useCurveEditorViewStore.getState().zoomLevel).toBe(0.25)
  })

  it('setZoom clamps to maximum', () => {
    const { setZoom } = useCurveEditorViewStore.getState()
    setZoom(100, 0, 800)
    expect(useCurveEditorViewStore.getState().zoomLevel).toBe(8)
  })

  it('zoomIn doubles the zoom level', () => {
    const { zoomIn } = useCurveEditorViewStore.getState()
    zoomIn(100, 800)
    expect(useCurveEditorViewStore.getState().zoomLevel).toBe(2)
  })

  it('zoomOut halves the zoom level', () => {
    const { zoomOut } = useCurveEditorViewStore.getState()
    zoomOut(100, 800)
    expect(useCurveEditorViewStore.getState().zoomLevel).toBe(0.5)
  })

  it('setScroll sets both scroll values', () => {
    const { setScroll } = useCurveEditorViewStore.getState()
    setScroll(50, 100)
    const state = useCurveEditorViewStore.getState()
    expect(state.scrollX).toBe(50)
    expect(state.scrollY).toBe(100)
  })

  it('pan adjusts scroll values', () => {
    const { pan } = useCurveEditorViewStore.getState()
    pan(30, -20)
    const state = useCurveEditorViewStore.getState()
    expect(state.scrollX).toBe(30)
    expect(state.scrollY).toBe(-20)
  })

  it('fitCurves sets fitPending flag', () => {
    const { fitCurves } = useCurveEditorViewStore.getState()
    fitCurves()
    expect(useCurveEditorViewStore.getState().fitPending).toBe(true)
  })

  it('clearFitPending clears the flag', () => {
    useCurveEditorViewStore.setState({ fitPending: true })
    useCurveEditorViewStore.getState().clearFitPending()
    expect(useCurveEditorViewStore.getState().fitPending).toBe(false)
  })

  it('frameSelected sets frameSelectedPending flag', () => {
    const { frameSelected } = useCurveEditorViewStore.getState()
    frameSelected()
    expect(useCurveEditorViewStore.getState().frameSelectedPending).toBe(true)
  })

  it('clearFrameSelectedPending clears the flag', () => {
    useCurveEditorViewStore.setState({ frameSelectedPending: true })
    useCurveEditorViewStore.getState().clearFrameSelectedPending()
    expect(useCurveEditorViewStore.getState().frameSelectedPending).toBe(false)
  })

  it('persists viewMode and filter to localStorage', () => {
    useCurveEditorViewStore.getState().setViewMode('curveEditor')
    useCurveEditorViewStore.getState().setFilter('position')
    const stored = JSON.parse(localStorage.getItem('curve-editor-view-state') ?? '{}')
    expect(stored.state.viewMode).toBe('curveEditor')
    expect(stored.state.filter).toBe('position')
  })

  it('persists zoom and scroll to localStorage', () => {
    useCurveEditorViewStore.getState().setZoom(3, 0, 800)
    useCurveEditorViewStore.getState().setScroll(100, 50)
    const stored = JSON.parse(localStorage.getItem('curve-editor-view-state') ?? '{}')
    expect(stored.state.zoomLevel).toBe(3)
    expect(stored.state.scrollX).toBe(100)
    expect(stored.state.scrollY).toBe(50)
  })
})
