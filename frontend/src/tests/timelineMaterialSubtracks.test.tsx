import { act } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { TimelinePanel } from '../components/panels/TimelinePanel'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { AddKeyframeCommand } from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { noopPersistence } from './contextHarness'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'
import { DEFAULT_TIMELINE_HEIGHT } from '../stores/uiPrefs'
import { useTimelineViewStore } from '../stores/timelineViewStore'

function renderPanel(): {
  engine: Engine
  undoStack: UndoStack
  dispatcher: CommandDispatcher
  logger: ReturnType<typeof vi.fn>
} {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const logger = vi.fn()
  const dispatcher = new CommandDispatcher(engine, undoStack, logger)
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
  return { engine, undoStack, dispatcher, logger }
}

function createSceneWithNode(
  engine: Engine,
  name = 'Boy',
  transform?: { x?: number; y?: number; rotation?: number; scaleX?: number; scaleY?: number },
): { slideId: string; nodeId: string } {
  engine.createProject({ name: 'Demo' })
  const slide = engine.createSlide('Slide 1')
  const node = engine.createNode(slide.scene.id, slide.scene.root.id, name, {
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, ...transform },
  })
  return { slideId: slide.id, nodeId: node.id }
}

function track(name: string) {
  return screen.getByRole('track', { name })
}

function expandNode(name: string): void {
  fireEvent.click(screen.getByRole('button', { name: `Toggle subtracks of ${name}` }))
}

function materialSubtrackAddButton(nodeName: string, parameterLabel: string): HTMLElement {
  const trackRow = track(nodeName).closest('li')
  if (!trackRow) {
    throw new Error('expected a track row')
  }
  const list = trackRow.parentElement
  if (!list) {
    throw new Error('expected a track list')
  }
  const subtrack = Array.from(list.children).find(
    (li) =>
      li.hasAttribute('data-parameter') &&
      within(li as HTMLElement).queryByText(parameterLabel) !== null,
  )
  if (!subtrack) {
    throw new Error(`expected a material subtrack row for ${parameterLabel}`)
  }
  return within(subtrack as HTMLElement).getByRole('button', {
    name: `Add Keyframe to ${parameterLabel}`,
  })
}

function scrub(slideId: string, time: number): void {
  act(() => {
    usePlaybackController.getState().setCurrentTime(slideId, time, 10)
  })
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  usePlaybackController.setState({ currentTimes: {} })
  useTimelineViewStore.persist.clearStorage()
  useTimelineViewStore.setState({
    zoomLevel: 1,
    scrollTime: 0,
    height: DEFAULT_TIMELINE_HEIGHT,
    expandedNodeIds: {},
  })
  localStorage.clear()
})

describe('TimelinePanel material subtracks', () => {
  it('shows material subtracks when a node has a material definition with parameters', async () => {
    const { engine } = renderPanel()
    createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })

    expandNode('Boy')

    await waitFor(() => {
      expect(screen.getByText('tint')).toBeInTheDocument()
      expect(screen.getByText('opacityMultiplier')).toBeInTheDocument()
    })
  })

  it('hides material subtracks when collapsed', async () => {
    const { engine } = renderPanel()
    createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })

    expandNode('Boy')
    await screen.findByText('tint')

    expandNode('Boy')

    await waitFor(() => {
      expect(screen.queryByText('tint')).not.toBeInTheDocument()
    })
  })

  it('shows custom material parameters as subtracks', async () => {
    const { engine } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })

    engine.registerMaterialDefinition('mat-custom', 'Custom Material', [
      { key: 'tint', kind: 'color', default: '#ffffff' },
      { key: 'opacityMultiplier', kind: 'number', default: 1 },
      { key: 'uGlow', kind: 'number', default: 0 },
      { key: 'uSteps', kind: 'int', default: 8 },
    ])
    engine.assignMaterial(nodeId, 'mat-custom')

    expandNode('Boy')

    await waitFor(() => {
      expect(screen.getByText('tint')).toBeInTheDocument()
      expect(screen.getByText('opacityMultiplier')).toBeInTheDocument()
      expect(screen.getByText('uGlow')).toBeInTheDocument()
      expect(screen.getByText('uSteps')).toBeInTheDocument()
    })
  })

  it('updates subtrack list when material changes', async () => {
    const { engine } = renderPanel()
    const { nodeId } = createSceneWithNode(engine)
    await screen.findByRole('track', { name: 'Boy' })

    engine.registerMaterialDefinition('mat-1', 'Material 1', [
      { key: 'tint', kind: 'color', default: '#ffffff' },
      { key: 'opacityMultiplier', kind: 'number', default: 1 },
      { key: 'uGlow', kind: 'number', default: 0 },
    ])
    engine.registerMaterialDefinition('mat-2', 'Material 2', [
      { key: 'tint', kind: 'color', default: '#ffffff' },
      { key: 'opacityMultiplier', kind: 'number', default: 1 },
      { key: 'uSteps', kind: 'int', default: 8 },
    ])
    engine.assignMaterial(nodeId, 'mat-1')

    expandNode('Boy')

    await waitFor(() => {
      expect(screen.getByText('uGlow')).toBeInTheDocument()
      expect(screen.queryByText('uSteps')).not.toBeInTheDocument()
    })

    engine.assignMaterial(nodeId, 'mat-2')

    await waitFor(() => {
      expect(screen.queryByText('uGlow')).not.toBeInTheDocument()
      expect(screen.getByText('uSteps')).toBeInTheDocument()
    })
  })

  it('adds a keyframe at the playhead via the + button with the current value', async () => {
    const { engine, logger } = renderPanel()
    const { slideId, nodeId } = createSceneWithNode(engine, 'Boy')
    await screen.findByRole('track', { name: 'Boy' })

    engine.registerMaterialDefinition('mat-glow', 'Glow Material', [
      { key: 'tint', kind: 'color', default: '#ffffff' },
      { key: 'opacityMultiplier', kind: 'number', default: 1 },
      { key: 'uGlow', kind: 'number', default: 0.5 },
    ])
    engine.assignMaterial(nodeId, 'mat-glow')

    expandNode('Boy')
    await screen.findByText('uGlow')
    scrub(slideId, 2)

    fireEvent.click(materialSubtrackAddButton('Boy', 'uGlow'))

    await waitFor(() => {
      expect(engine.getMaterialKeyframes(nodeId, 'uGlow')).toHaveLength(1)
    })
    const keyframe = engine.getMaterialKeyframes(nodeId, 'uGlow')[0]
    expect(keyframe.time).toBe(2)
    expect(keyframe.value).toBe(0.5)
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('AddKeyframe'))
  })

  it('renders keyframe markers on material subtracks', async () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine, 'Boy')
    await screen.findByRole('track', { name: 'Boy' })

    engine.registerMaterialDefinition('mat-glow', 'Glow Material', [
      { key: 'tint', kind: 'color', default: '#ffffff' },
      { key: 'opacityMultiplier', kind: 'number', default: 1 },
      { key: 'uGlow', kind: 'number', default: 0 },
    ])
    engine.assignMaterial(nodeId, 'mat-glow')

    expandNode('Boy')
    await screen.findByText('uGlow')

    const addResult = dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId, parameter: 'uGlow' },
        time: 1,
        value: 0.5,
      }),
    )
    expect(addResult.ok).toBe(true)

    const addResult2 = dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId, parameter: 'uGlow' },
        time: 2,
        value: 0.8,
      }),
    )
    expect(addResult2.ok).toBe(true)

    const markers = await screen.findAllByTestId('keyframe-marker')
    const materialMarkers = markers.filter((marker) => marker.dataset.parameter === 'uGlow')
    expect(materialMarkers).toHaveLength(2)
    expect(materialMarkers[0]).toHaveStyle({ left: '100px' })
    expect(materialMarkers[1]).toHaveStyle({ left: '200px' })
  })

  it('deletes material keyframes via context menu', async () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine, 'Boy')
    await screen.findByRole('track', { name: 'Boy' })

    engine.registerMaterialDefinition('mat-glow', 'Glow Material', [
      { key: 'tint', kind: 'color', default: '#ffffff' },
      { key: 'opacityMultiplier', kind: 'number', default: 1 },
      { key: 'uGlow', kind: 'number', default: 0 },
    ])
    engine.assignMaterial(nodeId, 'mat-glow')

    expandNode('Boy')
    await screen.findByText('uGlow')

    const addResult = dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId, parameter: 'uGlow' },
        time: 1,
        value: 0.5,
      }),
    )
    expect(addResult.ok).toBe(true)
    expect(engine.getMaterialKeyframes(nodeId, 'uGlow')).toHaveLength(1)

    const marker = await screen.findByTestId('keyframe-marker')
    fireEvent.contextMenu(marker)

    const contextMenu = await screen.findByTestId('timeline-context-menu')
    const deleteButton = within(contextMenu).getByRole('button', { name: 'Delete Keyframe' })
    fireEvent.click(deleteButton)

    await waitFor(() => {
      expect(engine.getMaterialKeyframes(nodeId, 'uGlow')).toHaveLength(0)
    })
  })

  it('survives material swap without losing keyframe data', async () => {
    const { engine, dispatcher } = renderPanel()
    const { nodeId } = createSceneWithNode(engine, 'Boy')
    await screen.findByRole('track', { name: 'Boy' })

    engine.registerMaterialDefinition('mat-1', 'Material 1', [
      { key: 'tint', kind: 'color', default: '#ffffff' },
      { key: 'opacityMultiplier', kind: 'number', default: 1 },
      { key: 'uGlow', kind: 'number', default: 0 },
    ])
    engine.registerMaterialDefinition('mat-2', 'Material 2', [
      { key: 'tint', kind: 'color', default: '#ffffff' },
      { key: 'opacityMultiplier', kind: 'number', default: 1 },
      { key: 'uSteps', kind: 'int', default: 8 },
    ])
    engine.assignMaterial(nodeId, 'mat-1')

    expandNode('Boy')
    await screen.findByText('uGlow')

    const addResult = dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId, parameter: 'uGlow' },
        time: 1,
        value: 0.5,
      }),
    )
    expect(addResult.ok).toBe(true)
    expect(engine.getMaterialKeyframes(nodeId, 'uGlow')).toHaveLength(1)

    engine.assignMaterial(nodeId, 'mat-2')

    await waitFor(() => {
      expect(screen.queryByText('uGlow')).not.toBeInTheDocument()
      expect(screen.getByText('uSteps')).toBeInTheDocument()
    })

    expect(engine.getMaterialKeyframes(nodeId, 'uGlow')).toHaveLength(1)
  })
})
