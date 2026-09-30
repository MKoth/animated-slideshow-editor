import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { TimelineCollectionBlocks } from '../components/panels/TimelineCollectionBlocks'
import { CommandDispatcher, UndoStack, PlaceCollectionCommand } from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { Keyframe } from '../engine/keyframe'
import { noopPersistence } from './contextHarness'
import { useTimelineViewStore } from '../stores/timelineViewStore'

function setupPlaced() {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const logger = vi.fn()
  const dispatcher = new CommandDispatcher(engine, undoStack, logger)
  engine.createProject({ name: 'P' })
  engine.createSlide('S1')
  const slide = engine.getActiveSlide()!
  slide.duration = 20
  const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Cat')
  const paw = engine.createNode(slide.scene.id, parent.id, 'Paw')
  engine.setSemanticName(paw.id, 'paw')
  const clip = engine.createClip('pawClip', 2, '', [], [{ property: 'positionX' }])
  clip.addChannelKeyframe('positionX', new Keyframe('k1', 0, 10))
  clip.addChannelKeyframe('positionX', new Keyframe('k2', 1, 30))
  const col = engine.createClipCollection('Pose', { paw: clip.id })
  const res = dispatcher.dispatch(
    new PlaceCollectionCommand({ collectionId: col.id, parentNodeId: parent.id, startTime: 2 }),
  )
  if (!res.ok) throw new Error('place failed')
  const placementId = (res.inverse as { placementId: string }).placementId
  return { engine, undoStack, dispatcher, parent, paw, clip, col, placementId }
}

beforeEach(() => {
  useTimelineViewStore.setState({ gridSnapEnabled: false } as never)
})

describe('timeline collection lane drag commits once', () => {
  it('move across several pointermoves applies delta exactly once', async () => {
    const { engine, undoStack, dispatcher, parent, placementId } = setupPlaced()
    const value: EngineContextValue = {
      engine: toReadOnly(engine),
      undoStack,
      dispatch: (c) => dispatcher.dispatch(c as never) as never,
      persistence: noopPersistence,
    }
    const pps = 100
    render(
      <EngineContext.Provider value={value}>
        <TimelineCollectionBlocks node={parent} duration={20} pps={pps} />
      </EngineContext.Provider>,
    )
    const block = await screen.findByTestId(`timeline-collection-block-${placementId}`)
    // drag +1s in 5 steps (20px each at 100pps)
    fireEvent.pointerDown(block, { button: 0, clientX: 0, clientY: 0 })
    for (let i = 1; i <= 5; i++) {
      act(() => {
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: i * 20, clientY: 0 }))
      })
    }
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', {}))
    })
    const placement = engine.getCollectionPlacement(placementId)
    // 2 + 1 = 3. Old stacked-pointerup bug produced ~5-6 (multiple commits).
    expect(placement.startTime).toBeCloseTo(3, 5)
    const members = engine.getPlacementMembers(placementId)
    expect(members[0]!.instance.startTime).toBeCloseTo(3, 5)
  })
})
