import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerActiveSlideSync } from '../app/activeSlideSync'
import { createEngine } from '../engine/internal'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'

function setup() {
  const engine = createEngine()
  engine.createProject({ name: 'P' })
  const first = engine.createSlide('First')
  const second = engine.createSlide('Second')
  engine.setActiveSlide(first.id)
  return { engine, first, second }
}

describe('registerActiveSlideSync', () => {
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

  it('stops playback and keeps every slide time when the active slide changes', () => {
    const { engine, first, second } = setup()
    const unsubscribe = registerActiveSlideSync(engine)
    usePlaybackController.getState().setCurrentTime(first.id, 3, 10)
    usePlaybackController.getState().setCurrentTime(second.id, 7, 10)
    usePlaybackController.getState().play(second.id, 10)

    engine.setActiveSlide(second.id)

    const state = usePlaybackController.getState()
    expect(state.status).toBe('stopped')
    expect(state.getTime(first.id)).toBe(3)
    expect(state.getTime(second.id)).toBe(7)
    unsubscribe()
  })

  it('restores each slide time when switching back', () => {
    const { engine, first, second } = setup()
    const unsubscribe = registerActiveSlideSync(engine)
    usePlaybackController.getState().setCurrentTime(first.id, 2.5, 10)
    usePlaybackController.getState().setCurrentTime(second.id, 8, 10)

    engine.setActiveSlide(second.id)
    engine.setActiveSlide(first.id)

    expect(usePlaybackController.getState().getTime(first.id)).toBe(2.5)
    expect(usePlaybackController.getState().getTime(second.id)).toBe(8)
    unsubscribe()
  })

  it('clears the scene-node and keyframe selection on switch', () => {
    const { engine, first, second } = setup()
    const unsubscribe = registerActiveSlideSync(engine)
    useSelectionStore.getState().select('node-of-first')
    useSelectionStore.getState().selectKeyframes(['kf-of-first'])

    engine.setActiveSlide(second.id)

    const selection = useSelectionStore.getState()
    expect(selection.selectedIds).toEqual([])
    expect(selection.selectedKeyframeIds).toEqual([])
    expect(usePlaybackController.getState().getTime(first.id)).toBe(0)
    unsubscribe()
  })

  it('leaves playback and selection untouched for non-switch events', () => {
    const { engine, first } = setup()
    const unsubscribe = registerActiveSlideSync(engine)
    const node = engine.createNode(first.scene.id, first.scene.root.id, 'Boy')
    usePlaybackController.getState().setCurrentTime(first.id, 4, 10)
    usePlaybackController.getState().play(first.id, 10)
    useSelectionStore.getState().select(node.id)

    engine.renameNode(node.id, 'Girl')
    engine.setOpacity(node.id, 0.5)

    const state = usePlaybackController.getState()
    expect(state.status).toBe('playing')
    expect(useSelectionStore.getState().selectedIds).toEqual([node.id])
    unsubscribe()
  })

  it('stops reacting after unsubscribe', () => {
    const { engine, first, second } = setup()
    const unsubscribe = registerActiveSlideSync(engine)
    usePlaybackController.getState().setCurrentTime(first.id, 4, 10)
    usePlaybackController.getState().setCurrentTime(second.id, 6, 10)
    usePlaybackController.getState().play(second.id, 10)
    useSelectionStore.getState().select('stale-node')
    unsubscribe()

    engine.setActiveSlide(second.id)

    const state = usePlaybackController.getState()
    expect(state.status).toBe('playing')
    expect(useSelectionStore.getState().selectedIds).toEqual(['stale-node'])
  })
})
