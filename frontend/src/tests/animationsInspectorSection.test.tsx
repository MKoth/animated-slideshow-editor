import { act } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { InspectorPanel } from '../components/panels/InspectorPanel'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { noopPersistence } from './contextHarness'
import { useSelectionStore } from '../stores/selectionStore'
import { usePlaybackController } from '../stores/playbackStore'
import { useTimelineSelectionStore } from '../stores/timelineSelectionStore'
import { useClipLibraryStore } from '../stores/clipLibraryStore'
import type { AnimationProperty } from '../engine'

function renderInspector(): {
  engine: Engine
  undoStack: UndoStack
  dispatcher: CommandDispatcher
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
      <InspectorPanel width={300} />
    </EngineContext.Provider>,
  )
  return { engine, undoStack, dispatcher }
}

function createProjectAndSlide(engine: Engine) {
  engine.createProject({ name: 'Demo' })
  return engine.createSlide('Slide 1')
}

function createNode(engine: Engine, name: string) {
  const slide = engine.project?.slides[0]
  if (!slide) throw new Error('expected a slide')
  return engine.createNode(slide.scene.id, slide.scene.root.id, name)
}

function createClipWithParams(
  engine: Engine,
  name: string,
  channels: AnimationProperty[],
  params: { key: string; label: string; kind: string; default: number }[] = [],
) {
  return engine.createClip(
    name,
    2,
    'motion',
    params,
    channels.map((ch) => ({ property: ch })),
  )
}

function selectNode(nodeId: string) {
  act(() => {
    useSelectionStore.getState().select(nodeId)
  })
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  usePlaybackController.setState({ currentTimes: {} })
  useTimelineSelectionStore.setState({ editingContext: 'slide' })
  useClipLibraryStore.setState({ selectedId: null })
  localStorage.clear()
})

describe('AnimationsInspectorSection', () => {
  it('renders the Animations section when a node is selected', () => {
    const { engine } = renderInspector()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')
    const clip = createClipWithParams(engine, 'Fade In', ['opacity'])
    engine.assignClipInstance(node.id, clip.id, 0, 1, true, {})

    selectNode(node.id)

    expect(screen.getByTestId('animations-section')).toBeInTheDocument()
    expect(screen.getByText('Animations')).toBeInTheDocument()
  })

  it('lists clip instances with clip names', () => {
    const { engine } = renderInspector()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')
    const clip = createClipWithParams(engine, 'Fade In', ['opacity'])
    engine.assignClipInstance(node.id, clip.id, 0, 1, true, {})

    selectNode(node.id)

    const nameLabels = screen.getAllByText('Fade In')
    expect(nameLabels.length).toBeGreaterThanOrEqual(2) // instance row + picker option
    expect(screen.getByTitle('Fade In')).toBeInTheDocument()
  })

  it('shows enabled toggle for each instance', () => {
    const { engine } = renderInspector()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')
    const clip = createClipWithParams(engine, 'Fade In', ['opacity'])
    engine.assignClipInstance(node.id, clip.id, 0, 1, true, {})

    selectNode(node.id)

    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeChecked()
  })

  it('shows "No clips assigned" when no instances exist', () => {
    const { engine } = renderInspector()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')
    void createClipWithParams(engine, 'Fade In', ['opacity'])

    selectNode(node.id)

    // Section shows because clips exist project-wide, but node has no instances
    expect(screen.getByText('No clips assigned.')).toBeInTheDocument()
  })

  it('add clip picker is present', () => {
    const { engine } = renderInspector()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')
    createClipWithParams(engine, 'Fade In', ['opacity'])

    selectNode(node.id)

    expect(screen.getByLabelText('Add clip')).toBeInTheDocument()
  })

  it('assigns a clip via the add picker', () => {
    const { engine } = renderInspector()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')
    const clip = createClipWithParams(engine, 'Fade In', ['opacity'])

    selectNode(node.id)

    const picker = screen.getByLabelText('Add clip')
    fireEvent.change(picker, { target: { value: clip.id } })

    const instances = engine.getClipInstances(node.id)
    expect(instances.length).toBe(1)
    expect(instances[0].clipId).toBe(clip.id)
  })

  it('removes a clip instance via the remove button', () => {
    const { engine } = renderInspector()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')
    const clip = createClipWithParams(engine, 'Fade In', ['opacity'])
    engine.assignClipInstance(node.id, clip.id, 0, 1, true, {})

    selectNode(node.id)

    const removeBtn = screen.getByLabelText('Remove clip Fade In')
    fireEvent.click(removeBtn)

    const instances = engine.getClipInstances(node.id)
    expect(instances.length).toBe(0)
  })

  it('toggles enabled state via checkbox', () => {
    const { engine } = renderInspector()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')
    const clip = createClipWithParams(engine, 'Fade In', ['opacity'])
    engine.assignClipInstance(node.id, clip.id, 0, 1, true, {})

    selectNode(node.id)

    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)

    const instances = engine.getClipInstances(node.id)
    expect(instances[0].enabled).toBe(false)
  })

  it('shows start time and speed fields', () => {
    const { engine } = renderInspector()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')
    const clip = createClipWithParams(engine, 'Fade In', ['opacity'])
    engine.assignClipInstance(node.id, clip.id, 0, 1, true, {})

    selectNode(node.id)

    expect(screen.getByLabelText('Start')).toBeInTheDocument()
    expect(screen.getByLabelText('Speed')).toBeInTheDocument()
  })

  it('hides the section when no node is selected', () => {
    renderInspector()

    expect(screen.queryByTestId('animations-section')).not.toBeInTheDocument()
  })

  it('shows multiple clip instances in layer order', () => {
    const { engine } = renderInspector()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')
    const clip1 = createClipWithParams(engine, 'Fade In', ['opacity'])
    const clip2 = createClipWithParams(engine, 'Bounce', ['positionY'])
    engine.assignClipInstance(node.id, clip1.id, 0, 1, true, {})
    engine.assignClipInstance(node.id, clip2.id, 0, 1, true, {})

    selectNode(node.id)

    const names = screen.getAllByText(/Fade In|Bounce/)
    expect(names.length).toBeGreaterThanOrEqual(2)
  })

  it('shows param overrides for clips with params', () => {
    const { engine } = renderInspector()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')
    const clip = createClipWithParams(
      engine,
      'Fade In',
      ['opacity'],
      [{ key: 'gain', label: 'Gain', kind: 'gain', default: 1 }],
    )
    engine.assignClipInstance(node.id, clip.id, 0, 1, true, {})

    selectNode(node.id)

    const gainLabels = screen.getAllByText('Gain')
    expect(gainLabels.length).toBeGreaterThanOrEqual(2) // param row label + NumericField label
  })

  it('dispatches OverrideClipParamCommand when editing a param', () => {
    const { engine } = renderInspector()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')
    const clip = createClipWithParams(
      engine,
      'Fade In',
      ['opacity'],
      [{ key: 'gain', label: 'Gain', kind: 'gain', default: 1 }],
    )
    engine.assignClipInstance(node.id, clip.id, 0, 1, true, {})

    selectNode(node.id)

    const gainInput = screen.getByLabelText('Gain')
    fireEvent.change(gainInput, { target: { value: '2' } })
    fireEvent.blur(gainInput)

    const instances = engine.getClipInstances(node.id)
    expect(instances[0].paramOverrides['gain']).toBe(2)
  })

  it('clears a param override when Clear is clicked', () => {
    const { engine } = renderInspector()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')
    const clip = createClipWithParams(
      engine,
      'Fade In',
      ['opacity'],
      [{ key: 'gain', label: 'Gain', kind: 'gain', default: 1 }],
    )
    engine.assignClipInstance(node.id, clip.id, 0, 1, true, { gain: 2 })

    selectNode(node.id)

    const clearBtn = screen.getByLabelText('Clear Gain override')
    fireEvent.click(clearBtn)

    const instances = engine.getClipInstances(node.id)
    expect(instances[0].paramOverrides['gain']).toBe(1)
  })

  it('shows effective vs default for overridden params', () => {
    const { engine } = renderInspector()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')
    const clip = createClipWithParams(
      engine,
      'Fade In',
      ['opacity'],
      [{ key: 'gain', label: 'Gain', kind: 'gain', default: 1 }],
    )
    engine.assignClipInstance(node.id, clip.id, 0, 1, true, { gain: 2 })

    selectNode(node.id)

    expect(screen.getByText('default: 1')).toBeInTheDocument()
  })

  it('shows no default text for non-overridden params', () => {
    const { engine } = renderInspector()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')
    const clip = createClipWithParams(
      engine,
      'Fade In',
      ['opacity'],
      [{ key: 'gain', label: 'Gain', kind: 'gain', default: 1 }],
    )
    engine.assignClipInstance(node.id, clip.id, 0, 1, true, {})

    selectNode(node.id)

    const defaultTexts = screen.queryAllByText(/default:/)
    expect(defaultTexts.length).toBe(0)
  })

  it('disables controls while playing', () => {
    const { engine } = renderInspector()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')
    const clip = createClipWithParams(engine, 'Fade In', ['opacity'])
    engine.assignClipInstance(node.id, clip.id, 0, 1, true, {})

    selectNode(node.id)

    act(() => {
      usePlaybackController.setState({ status: 'playing' })
    })

    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeDisabled()
  })

  it('reorders clip instances via drag and drop', () => {
    const { engine } = renderInspector()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')
    const clip1 = createClipWithParams(engine, 'Fade In', ['opacity'])
    const clip2 = createClipWithParams(engine, 'Bounce', ['positionY'])
    engine.assignClipInstance(node.id, clip1.id, 0, 1, true, {})
    engine.assignClipInstance(node.id, clip2.id, 0, 1, true, {})

    selectNode(node.id)

    const rows = document.querySelectorAll('.clip-instance-row')
    expect(rows.length).toBe(2)

    // Verify initial order: Fade In first, Bounce second
    expect(rows[0].querySelector('.clip-instance-row__name')).toHaveTextContent('Fade In')
    expect(rows[1].querySelector('.clip-instance-row__name')).toHaveTextContent('Bounce')

    // Simulate drag from index 0 to index 1 using native event dispatch
    // JSDOM's FakeDataTransfer doesn't support effectAllowed, so we use a real DataTransfer
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('text/plain', '0')
    fireEvent.dragStart(rows[0], { dataTransfer })
    fireEvent.dragOver(rows[1], { dataTransfer })
    fireEvent.drop(rows[1], { dataTransfer })

    // Verify the instances were reordered in the engine
    const instances = engine.getClipInstances(node.id)
    expect(instances[0].clipId).toBe(clip2.id)
    expect(instances[1].clipId).toBe(clip1.id)
  })

  it('hides the Animations section in clip-edit mode', async () => {
    const { engine } = renderInspector()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')
    const clip = createClipWithParams(engine, 'Fade In', ['opacity'])
    engine.assignClipInstance(node.id, clip.id, 0, 1, true, {})

    selectNode(node.id)

    // Animations section should be visible
    expect(screen.getByTestId('animations-section')).toBeInTheDocument()

    // Deselect node, then enter clip-edit mode
    act(() => {
      useSelectionStore.getState().clear()
    })
    useClipLibraryStore.getState().selectClip(clip.id)
    useTimelineSelectionStore.getState().setEditingContext('clip-edit')

    await waitFor(() => {
      // In clip-edit with no node targeted, Animations section should be gone
      // and ClipEditInspectorSection should render instead
      expect(screen.queryByTestId('animations-section')).not.toBeInTheDocument()
      expect(screen.getByText('Clip')).toBeInTheDocument()
    })
  })

  it('hides the section when no clips exist project-wide', () => {
    const { engine } = renderInspector()
    createProjectAndSlide(engine)
    const node = createNode(engine, 'Boy')

    selectNode(node.id)

    // No clips in project, section should not render
    expect(screen.queryByTestId('animations-section')).not.toBeInTheDocument()
  })
})
