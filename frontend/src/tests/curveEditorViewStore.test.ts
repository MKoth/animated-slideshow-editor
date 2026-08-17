import { beforeEach, describe, expect, it } from 'vitest'
import { useCurveEditorViewStore } from '../stores/curveEditorViewStore'

beforeEach(() => {
  useCurveEditorViewStore.persist.clearStorage()
  useCurveEditorViewStore.setState({
    zoomX: 100,
    zoomY: 1,
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
    expect(state.zoomX).toBe(100)
    expect(state.zoomY).toBe(1)
    expect(state.scrollX).toBe(0)
    expect(state.scrollY).toBe(0)
    expect(state.filter).toBe('all')
    expect(state.viewMode).toBe('dopeSheet')
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
    setFilter('all')
    expect(useCurveEditorViewStore.getState().filter).toBe('all')
  })

  it('setZoom sets both zoom values', () => {
    const { setZoom } = useCurveEditorViewStore.getState()
    setZoom(200, 5)
    const state = useCurveEditorViewStore.getState()
    expect(state.zoomX).toBe(200)
    expect(state.zoomY).toBe(5)
  })

  it('setZoom clamps to minimum', () => {
    const { setZoom } = useCurveEditorViewStore.getState()
    setZoom(0.001, 0.001)
    expect(useCurveEditorViewStore.getState().zoomX).toBe(0.05)
    expect(useCurveEditorViewStore.getState().zoomY).toBe(0.05)
  })

  it('setZoom clamps to maximum', () => {
    const { setZoom } = useCurveEditorViewStore.getState()
    setZoom(500, 500)
    expect(useCurveEditorViewStore.getState().zoomX).toBe(200)
    expect(useCurveEditorViewStore.getState().zoomY).toBe(200)
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

  it('persists viewMode and filter to localStorage', () => {
    useCurveEditorViewStore.getState().setViewMode('curveEditor')
    useCurveEditorViewStore.getState().setFilter('position')
    const stored = JSON.parse(localStorage.getItem('curve-editor-view-state') ?? '{}')
    expect(stored.state.viewMode).toBe('curveEditor')
    expect(stored.state.filter).toBe('position')
  })

  it('persists zoom and scroll to localStorage', () => {
    useCurveEditorViewStore.getState().setZoom(200, 5)
    useCurveEditorViewStore.getState().setScroll(100, 50)
    const stored = JSON.parse(localStorage.getItem('curve-editor-view-state') ?? '{}')
    expect(stored.state.zoomX).toBe(200)
    expect(stored.state.zoomY).toBe(5)
    expect(stored.state.scrollX).toBe(100)
    expect(stored.state.scrollY).toBe(50)
  })
})
