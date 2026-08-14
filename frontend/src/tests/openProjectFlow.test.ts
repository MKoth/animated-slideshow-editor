import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openProjectInEditor } from '../app/openProjectActions'
import { createEngine } from '../engine/internal'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'
import { makeProject } from './engine/helpers'

function setupEditor() {
  const engine = createEngine()
  engine.createProject({ name: 'Current' })
  engine.createSlide('Old A')
  const active = engine.createSlide('Old B')
  engine.setActiveSlide(active.id)
  return { engine, activeSlideId: active.id }
}

describe('openProjectInEditor', () => {
  beforeEach(() => {
    usePlaybackController.setState({
      currentTimes: {},
      status: 'stopped',
      playbackSpeed: 1,
      loopEnabled: false,
    })
    useSelectionStore.setState({ selectedIds: [], selectedKeyframeIds: [] })
  })

  afterEach(() => {
    usePlaybackController.getState().reset()
  })

  it('opens the project through the engine, leaving the first slide active', () => {
    const { engine } = setupEditor()
    const incoming = makeProject('New', ['N1', 'N2'])

    openProjectInEditor(engine, incoming)

    expect(engine.project).toBe(incoming)
    expect(engine.activeSlideId).toBe(incoming.slides[0].id)
  })

  it('resets every per-slide playback time and stops playback', () => {
    const { engine } = setupEditor()
    usePlaybackController.getState().setCurrentTime('stale-slide', 4.5, 10)
    usePlaybackController.getState().setCurrentTime('stale-slide-2', 8, 10)
    usePlaybackController.setState({ status: 'playing' })

    openProjectInEditor(engine, makeProject('New', ['N1']))

    const state = usePlaybackController.getState()
    expect(state.currentTimes).toEqual({})
    expect(state.getTime('stale-slide')).toBe(0)
    expect(state.status).toBe('stopped')
  })

  it('clears the scene-node and keyframe selection', () => {
    const { engine } = setupEditor()
    const store = useSelectionStore.getState()
    store.select('node-1')
    store.selectKeyframes(['kf-1'])

    openProjectInEditor(engine, makeProject('New', ['N1']))

    expect(useSelectionStore.getState().selectedIds).toEqual([])
    expect(useSelectionStore.getState().selectedKeyframeIds).toEqual([])
  })

  it('rejects an invalid project, leaving engine, playback, and selection untouched', () => {
    const { engine, activeSlideId } = setupEditor()
    const before = engine.toJSON()
    usePlaybackController.getState().setCurrentTime('stale-slide', 4.5, 10)
    useSelectionStore.getState().select('node-1')
    const incoming = makeProject('New', ['N1'])
    incoming.slides[0].name = ''

    expect(() => openProjectInEditor(engine, incoming)).toThrow(/name/i)

    expect(engine.project?.name).toBe('Current')
    expect(engine.activeSlideId).toBe(activeSlideId)
    expect(engine.toJSON()).toEqual(before)
    expect(usePlaybackController.getState().currentTimes).toEqual({ 'stale-slide': 4.5 })
    expect(useSelectionStore.getState().selectedIds).toEqual(['node-1'])
  })
})
