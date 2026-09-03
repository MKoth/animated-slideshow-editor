import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import { TimelinePanel } from '../components/panels/TimelinePanel'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { noopPersistence } from './contextHarness'
import { useTimelineSelectionStore } from '../stores/timelineSelectionStore'
import { useTimelineViewStore } from '../stores/timelineViewStore'
import { usePlaybackController } from '../stores/playbackStore'

function renderTimeline(): { engine: import('../engine/internal').Engine; dispatcher: CommandDispatcher } {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, vi.fn())
  const value: import('../app/engineContext').EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: dispatcher.dispatch.bind(dispatcher) as import('../app/engineContext').EngineContextValue['dispatch'],
    persistence: noopPersistence,
  }
  engine.createProject({ name: 'P' })
  engine.createSlide()
  render(
    <EngineContext.Provider value={value}>
      <TimelinePanel height={200} />
    </EngineContext.Provider>,
  )
  return { engine, dispatcher }
}

describe('ClipExtraction UI', () => {
  beforeEach(() => {
    useTimelineSelectionStore.setState({ editingContext: 'slide', selections: { slide: [], 'clip-edit': [] }, anchorKeyframeId: { slide: null, 'clip-edit': null }, marqueeAnchor: null })
    useTimelineViewStore.setState({ expandedNodeIds: {} })
    usePlaybackController.setState({ currentTimes: {}, status: 'stopped' } as unknown as Record<string, unknown>)
  })

  it('shows Add to clip in context menu alongside Delete', async () => {
    const { engine } = renderTimeline()
    const slide = engine.getActiveSlide()!
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
    engine.addKeyframe({ kind: 'node', nodeId: node.id, property: 'positionX' }, 1, 0)
    // Expand node to show subtracks
    useTimelineViewStore.getState().toggleExpanded(node.id)
    // Force re-render by waiting
    const marker = await screen.findByTestId('keyframe-marker')
    // Select keyframe via click
    fireEvent.pointerDown(marker, { button: 0, clientX: 100, clientY: 10 })
    // Right-click to open context menu
    fireEvent.contextMenu(marker, { clientX: 100, clientY: 120 })
    const menu = await screen.findByTestId('timeline-context-menu')
    expect(menu).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Delete Keyframe' }).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByTestId('add-to-clip-button')).toBeInTheDocument()
  })

  it('opens extraction modal and creates a new clip', async () => {
    const { engine } = renderTimeline()
    const slide = engine.getActiveSlide()!
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
    engine.addKeyframe({ kind: 'node', nodeId: node.id, property: 'positionX' }, 1, 0)
    engine.addKeyframe({ kind: 'node', nodeId: node.id, property: 'positionX' }, 2, 10)
    useTimelineViewStore.getState().toggleExpanded(node.id)
    const markers = await screen.findAllByTestId('keyframe-marker')
    expect(markers.length).toBe(2)
    // Select both via ctrl click
    const second = markers[1] as HTMLElement
    const first = markers[0] as HTMLElement
    // Select first
    fireEvent.pointerDown(first, { button: 0, clientX: 100, clientY: 10 })
    // Ctrl+click second
    fireEvent.pointerDown(second, { button: 0, clientX: 150, clientY: 10, ctrlKey: true })
    // Right-click first
    fireEvent.contextMenu(first, { clientX: 100, clientY: 120 })
    const addButton = await screen.findByTestId('add-to-clip-button')
    fireEvent.click(addButton)
    const modal = await screen.findByTestId('clip-extraction-modal')
    expect(modal).toBeInTheDocument()
    // Should have name input default
    const nameInput = screen.getByTestId('clip-extraction-name') as HTMLInputElement
    expect(nameInput.value).toBe('Extracted Clip')
    // Confirm
    const confirm = screen.getByTestId('clip-extraction-confirm')
    fireEvent.click(confirm)
    await waitFor(() => expect(engine.clips).toHaveLength(1))
    const clip = engine.clips[0]!
    expect(clip.name).toBe('Extracted Clip')
    expect(clip.getChannelKeyframes('positionX')).toHaveLength(2)
  })

  it('modal lists existing clips and can append', async () => {
    const { engine } = renderTimeline()
    const slide = engine.getActiveSlide()!
    // Create an existing clip via engine
    engine.createClip('ExistingClip', 1, 'test', [], [{ property: 'positionX' }])
    expect(engine.clips).toHaveLength(1)
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
    engine.addKeyframe({ kind: 'node', nodeId: node.id, property: 'opacity' }, 0, 0.5)
    useTimelineViewStore.getState().toggleExpanded(node.id)
    const marker = await screen.findByTestId('keyframe-marker')
    fireEvent.pointerDown(marker, { button: 0, clientX: 100, clientY: 10 })
    fireEvent.contextMenu(marker, { clientX: 100, clientY: 120 })
    const addButton = await screen.findByTestId('add-to-clip-button')
    fireEvent.click(addButton)
    const modal = await screen.findByTestId('clip-extraction-modal')
    expect(modal).toHaveTextContent('ExistingClip')
    // Select existing clip radio (should be default if clips exist)
    const confirm = screen.getByTestId('clip-extraction-confirm')
    fireEvent.click(confirm)
    await waitFor(() => expect(engine.getClip(engine.clips[0]!.id).getChannelKeyframes('opacity')).toHaveLength(1))
  })
})
