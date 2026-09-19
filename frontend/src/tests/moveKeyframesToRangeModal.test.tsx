import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { TimelinePanel } from '../components/panels/TimelinePanel'
import { MoveKeyframesToRangeModal } from '../components/panels/MoveKeyframesToRangeModal'
import type { RangeMoveSelection } from '../components/panels/MoveKeyframesToRangeModal'
import type { AnimationProperty } from '../engine'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import {
  AddKeyframeCommand,
  CommandDispatcher,
  CreateProjectCommand,
  CreateSlideCommand,
  UndoStack,
} from '../engine/commands'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'
import { useTimelineViewStore } from '../stores/timelineViewStore'
import { DEFAULT_TIMELINE_HEIGHT } from '../stores/uiPrefs'
import { noopPersistence } from './contextHarness'

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  usePlaybackController.setState({ currentTimes: {} })
  useTimelineViewStore.persist.clearStorage()
  useTimelineViewStore.setState({ zoomLevel: 1, scrollTime: 0, height: DEFAULT_TIMELINE_HEIGHT })
  localStorage.clear()
})

function addKeyframe(
  dispatcher: CommandDispatcher,
  nodeId: string,
  property: AnimationProperty,
  time: number,
): void {
  const result = dispatcher.dispatch(
    new AddKeyframeCommand({ target: { kind: 'node', nodeId, property }, time, value: 5 }),
  )
  if (!result.ok) {
    throw new Error(`expected add to succeed: ${result.error.message}`)
  }
}

function setup(): {
  engine: Engine
  value: EngineContextValue
  slideId: string
  parentId: string
  childId: string
  duration: number
} {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, vi.fn())
  dispatcher.dispatch(new CreateProjectCommand({ name: 'P' }))
  dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' }))
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
  const child = engine.createNode(slide.scene.id, parent.id, 'Child')
  addKeyframe(dispatcher, parent.id, 'positionX', 1)
  addKeyframe(dispatcher, parent.id, 'positionX', 3)
  addKeyframe(dispatcher, parent.id, 'positionY', 2)
  engine.addKeyframe({ kind: 'morph', nodeId: parent.id }, 1, 0.5)
  engine.addKeyframe({ kind: 'zIndex', nodeId: parent.id }, 2, 5)
  addKeyframe(dispatcher, child.id, 'positionX', 2)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: (command) => dispatcher.dispatch(command),
    persistence: noopPersistence,
  }
  return {
    engine,
    value,
    slideId: slide.id,
    parentId: parent.id,
    childId: child.id,
    duration: slide.duration,
  }
}

function renderModal(
  parentId: string,
  slideId: string,
  duration: number,
  value: EngineContextValue,
) {
  const onConfirm = vi.fn()
  const onClose = vi.fn()
  render(
    <EngineContext.Provider value={value}>
      <MoveKeyframesToRangeModal
        nodeId={parentId}
        slideId={slideId}
        slideDuration={duration}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    </EngineContext.Provider>,
  )
  return { onConfirm, onClose }
}

function planKeys(selection: RangeMoveSelection): string[] {
  return selection.plan.map((entry) => {
    const target = entry.target as {
      kind: string
      nodeId?: string
      property?: string
      parameter?: string
    }
    if (target.kind === 'node' && target.property) {
      return `${target.nodeId}:property:${target.property}`
    }
    if (target.kind === 'node' && target.parameter) {
      return `${target.nodeId}:material:${target.parameter}`
    }
    return `${target.nodeId}:${target.kind}`
  })
}

describe('MoveKeyframesToRangeModal', () => {
  it('defaults both sections to the full slide and disables confirm for the identity mapping', () => {
    const { value, slideId, parentId, childId, duration } = setup()
    renderModal(parentId, slideId, duration, value)

    expect((screen.getByTestId('move-range-from-input') as HTMLInputElement).value).toBe('0')
    expect((screen.getByTestId('move-range-to-input') as HTMLInputElement).value).toBe(
      String(Math.round(duration * 100) / 100),
    )
    expect((screen.getByTestId('move-range-target-from-input') as HTMLInputElement).value).toBe('0')
    expect((screen.getByTestId('move-range-target-to-input') as HTMLInputElement).value).toBe(
      String(Math.round(duration * 100) / 100),
    )
    expect(screen.getByTestId(`move-range-node-${parentId}`)).toBeInTheDocument()
    expect(screen.getByTestId(`move-range-node-${childId}`)).toBeInTheDocument()
    expect(
      (screen.getByTestId(`move-range-prop-${parentId}-positionX`) as HTMLInputElement).checked,
    ).toBe(true)
    expect(screen.getByTestId(`move-range-track-${parentId}-morph`)).toBeInTheDocument()
    expect(screen.getByTestId(`move-range-track-${parentId}-zIndex`)).toBeInTheDocument()
    expect(screen.getByTestId('move-range-total').textContent).toContain('0 keyframes selected')
    expect((screen.getByTestId('move-range-confirm') as HTMLButtonElement).disabled).toBe(true)
  })

  it('remaps proportionally and confirms the checked tracks with both sections', () => {
    const { value, slideId, parentId, childId, duration } = setup()
    const { onConfirm } = renderModal(parentId, slideId, duration, value)

    fireEvent.change(screen.getByTestId('move-range-target-to-input'), { target: { value: '4' } })
    expect(screen.getByTestId('move-range-total').textContent).toContain('6 keyframes selected')

    fireEvent.click(screen.getByTestId('move-range-confirm'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    const selection = onConfirm.mock.calls[0][0] as RangeMoveSelection
    expect(selection.from).toBe(0)
    expect(selection.to).toBe(duration)
    expect(selection.targetFrom).toBe(0)
    expect(selection.targetTo).toBe(4)
    const keys = new Set(planKeys(selection))
    expect(keys.has(`${parentId}:property:positionX`)).toBe(true)
    expect(keys.has(`${parentId}:property:positionY`)).toBe(true)
    expect(keys.has(`${parentId}:morph`)).toBe(true)
    expect(keys.has(`${parentId}:zIndex`)).toBe(true)
    expect(keys.has(`${childId}:property:positionX`)).toBe(true)
    const positionX = selection.plan.find(
      (entry) =>
        (entry.target as { nodeId?: string }).nodeId === parentId &&
        (entry.target as { property?: string }).property === 'positionX',
    )
    expect(positionX?.moves.map((move) => move.newTime)).toEqual([0.4, 1.2])
  })

  it('unchecking a property removes its moves from the total and the plan', () => {
    const { value, slideId, parentId, childId, duration } = setup()
    const { onConfirm } = renderModal(parentId, slideId, duration, value)

    fireEvent.change(screen.getByTestId('move-range-target-to-input'), { target: { value: '4' } })
    fireEvent.click(screen.getByTestId(`move-range-prop-${parentId}-positionX`))
    expect(screen.getByTestId('move-range-total').textContent).toContain('4 keyframes selected')

    fireEvent.click(screen.getByTestId('move-range-confirm'))
    const selection = onConfirm.mock.calls[0][0] as RangeMoveSelection
    expect(planKeys(selection)).not.toContain(`${parentId}:property:positionX`)
    expect(planKeys(selection)).toContain(`${parentId}:property:positionY`)
    expect(planKeys(selection)).toContain(`${childId}:property:positionX`)
  })

  it('unchecking a child node toggle excludes the whole subtree', () => {
    const { value, slideId, parentId, childId, duration } = setup()
    const { onConfirm } = renderModal(parentId, slideId, duration, value)

    fireEvent.change(screen.getByTestId('move-range-target-to-input'), { target: { value: '4' } })
    fireEvent.click(screen.getByTestId(`move-range-toggle-${childId}`))
    expect(screen.getByTestId('move-range-total').textContent).toContain('5 keyframes selected')

    fireEvent.click(screen.getByTestId('move-range-confirm'))
    const selection = onConfirm.mock.calls[0][0] as RangeMoveSelection
    expect(planKeys(selection)).not.toContain(`${childId}:property:positionX`)
  })

  it('collapses child sections without changing the selection', () => {
    const { value, slideId, parentId, childId, duration } = setup()
    renderModal(parentId, slideId, duration, value)

    fireEvent.click(screen.getByTestId(`move-range-collapse-${childId}`))
    expect(screen.queryByTestId(`move-range-prop-${childId}-positionX`)).toBeNull()
    fireEvent.change(screen.getByTestId('move-range-target-to-input'), { target: { value: '4' } })
    expect(screen.getByTestId('move-range-total').textContent).toContain('6 keyframes selected')

    fireEvent.click(screen.getByTestId(`move-range-collapse-${childId}`))
    expect(screen.getByTestId(`move-range-prop-${childId}-positionX`)).toBeInTheDocument()
  })

  it('rejects an invalid source section and disables confirm', () => {
    const { value, slideId, parentId, duration } = setup()
    renderModal(parentId, slideId, duration, value)

    fireEvent.change(screen.getByTestId('move-range-from-input'), { target: { value: '7' } })
    fireEvent.change(screen.getByTestId('move-range-to-input'), { target: { value: '2' } })

    expect(screen.getByTestId('move-range-source-error')).toBeInTheDocument()
    expect((screen.getByTestId('move-range-confirm') as HTMLButtonElement).disabled).toBe(true)
  })

  it('rejects an invalid target section and disables confirm', () => {
    const { value, slideId, parentId, duration } = setup()
    renderModal(parentId, slideId, duration, value)

    fireEvent.change(screen.getByTestId('move-range-target-from-input'), {
      target: { value: '7' },
    })
    fireEvent.change(screen.getByTestId('move-range-target-to-input'), { target: { value: '2' } })

    expect(screen.getByTestId('move-range-target-error')).toBeInTheDocument()
    expect((screen.getByTestId('move-range-confirm') as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows an empty state for a source section without keyframes', () => {
    const { value, slideId, parentId, duration } = setup()
    renderModal(parentId, slideId, duration, value)

    fireEvent.change(screen.getByTestId('move-range-from-input'), { target: { value: '8' } })
    fireEvent.change(screen.getByTestId('move-range-to-input'), { target: { value: '9' } })

    expect(screen.getByTestId('move-range-empty')).toBeInTheDocument()
    expect(screen.queryByTestId(`move-range-prop-${parentId}-positionX`)).toBeNull()
    expect((screen.getByTestId('move-range-confirm') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('Move keyframes to another timeline section (timeline integration)', () => {
  it('opens the modal from the object track header and moves in one undo step', async () => {
    const engine = createEngineInternal()
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, vi.fn())
    dispatcher.dispatch(new CreateProjectCommand({ name: 'P' }))
    dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' }))
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    const child = engine.createNode(slide.scene.id, parent.id, 'Child')
    addKeyframe(dispatcher, parent.id, 'positionX', 1)
    addKeyframe(dispatcher, child.id, 'positionX', 2)
    engine.addKeyframe({ kind: 'morph', nodeId: parent.id }, 1, 0.5)
    engine.addKeyframe({ kind: 'zIndex', nodeId: parent.id }, 2, 5)
    const value: EngineContextValue = {
      engine: toReadOnly(engine),
      undoStack,
      dispatch: (command) => dispatcher.dispatch(command),
      persistence: noopPersistence,
    }
    render(
      <EngineContext.Provider value={value}>
        <TimelinePanel height={200} />
      </EngineContext.Provider>,
    )

    const track = await screen.findByRole('track', { name: 'Parent' })
    fireEvent.contextMenu(track)
    const menuItem = await screen.findByTestId('move-keyframes-in-range-button')
    expect(menuItem).toHaveTextContent('Move keyframes to another timeline section')

    fireEvent.click(menuItem)
    expect(await screen.findByTestId('move-range-modal')).toBeInTheDocument()
    expect(screen.getByTestId(`move-range-prop-${parent.id}-positionX`)).toBeInTheDocument()
    expect(screen.getByTestId(`move-range-track-${parent.id}-morph`)).toBeInTheDocument()
    expect(screen.getByTestId(`move-range-node-${child.id}`)).toBeInTheDocument()

    const entriesBefore = undoStack.entries.length
    fireEvent.change(screen.getByTestId('move-range-target-from-input'), {
      target: { value: '2' },
    })
    fireEvent.change(screen.getByTestId('move-range-target-to-input'), { target: { value: '4' } })
    fireEvent.click(screen.getByTestId('move-range-confirm'))

    expect(engine.getKeyframes(parent.id, 'positionX')[0]!.time).toBeCloseTo(2.2)
    expect(engine.getKeyframes(child.id, 'positionX')[0]!.time).toBeCloseTo(2.4)
    expect(engine.getKeyframesOf({ kind: 'morph', nodeId: parent.id })[0]!.time).toBeCloseTo(2.2)
    expect(engine.getKeyframesOf({ kind: 'zIndex', nodeId: parent.id })[0]!.time).toBeCloseTo(2.4)
    // Single undo step for the whole move.
    expect(undoStack.entries.length).toBe(entriesBefore + 1)
    expect(screen.queryByTestId('move-range-modal')).toBeNull()

    undoStack.undo(engine)
    expect(engine.getKeyframes(parent.id, 'positionX')[0]!.time).toBe(1)
    expect(engine.getKeyframes(child.id, 'positionX')[0]!.time).toBe(2)
    expect(engine.getKeyframesOf({ kind: 'morph', nodeId: parent.id })[0]!.time).toBe(1)
    expect(engine.getKeyframesOf({ kind: 'zIndex', nodeId: parent.id })[0]!.time).toBe(2)
  })

  it('does not offer the range move on a property lane menu', async () => {
    const engine = createEngineInternal()
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, vi.fn())
    dispatcher.dispatch(new CreateProjectCommand({ name: 'P' }))
    dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' }))
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    addKeyframe(dispatcher, parent.id, 'positionX', 1)
    const value: EngineContextValue = {
      engine: toReadOnly(engine),
      undoStack,
      dispatch: (command) => dispatcher.dispatch(command),
      persistence: noopPersistence,
    }
    render(
      <EngineContext.Provider value={value}>
        <TimelinePanel height={200} />
      </EngineContext.Provider>,
    )

    await screen.findByRole('track', { name: 'Parent' })
    fireEvent.click(screen.getByRole('button', { name: 'Toggle subtracks of Parent' }))
    const marker = await screen.findByTestId('keyframe-marker')
    fireEvent.contextMenu(marker)
    const menu = await screen.findByTestId('timeline-context-menu')
    expect(screen.queryByTestId('move-keyframes-in-range-button')).toBeNull()
    expect(within(menu).getByText('Delete Keyframe')).toBeInTheDocument()
  })
})
