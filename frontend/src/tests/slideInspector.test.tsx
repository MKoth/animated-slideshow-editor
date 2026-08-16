import { render, screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { InspectorPanel } from '../components/panels/InspectorPanel'
import { TimelinePanel } from '../components/panels/TimelinePanel'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { noopPersistence } from './contextHarness'
import { useNotificationStore } from '../stores/notificationStore'
import { useSelectionStore } from '../stores/selectionStore'

function renderPanel(): { engine: Engine; undoStack: UndoStack } {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
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
  return { engine, undoStack }
}

function renderWithTimeline(): { engine: Engine; undoStack: UndoStack } {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: (command) => dispatcher.dispatch(command),
    persistence: noopPersistence,
  }
  render(
    <EngineContext.Provider value={value}>
      <InspectorPanel width={300} />
      <TimelinePanel height={200} />
    </EngineContext.Provider>,
  )
  return { engine, undoStack }
}

function createSlide(engine: Engine, name = 'Slide 1'): string {
  engine.createProject({ name: 'Demo' })
  const slide = engine.createSlide(name)
  return slide.id
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  useNotificationStore.setState({ notifications: [] })
})

describe('InspectorPanel slide section', () => {
  it('shows the active slide name and duration', async () => {
    const { engine } = renderPanel()
    createSlide(engine, 'My Slide')

    expect(await screen.findByLabelText('Slide Name')).toHaveValue('My Slide')
    expect(screen.getByLabelText('Duration')).toHaveValue(10)
  })

  it('shows an empty state when there is no project', () => {
    renderPanel()

    expect(screen.getByText(/Nothing selected/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Slide Name')).not.toBeInTheDocument()
  })

  it('commits a duration edit through SetSlideDurationCommand', async () => {
    const { engine, undoStack } = renderPanel()
    const slideId = createSlide(engine)
    const user = userEvent.setup()
    const input = await screen.findByLabelText('Duration')

    await user.clear(input)
    await user.type(input, '15')
    await user.keyboard('{Enter}')

    expect(engine.project?.slides[0]?.duration).toBe(15)
    expect(undoStack.entries.at(-1)?.type).toBe('SetSlideDuration')
    expect(undoStack.entries.at(-1)?.parameters).toEqual({ slideId, duration: 15 })
  })

  it('commits a duration edit on blur', async () => {
    const { engine } = renderPanel()
    createSlide(engine)
    const user = userEvent.setup()
    const input = await screen.findByLabelText('Duration')

    await user.clear(input)
    await user.type(input, '7.5')
    await user.tab()

    await waitFor(() => {
      expect(engine.project?.slides[0]?.duration).toBe(7.5)
    })
  })

  it('rejects an out-of-bounds duration with the engine unchanged and a notification', async () => {
    const { engine, undoStack } = renderPanel()
    createSlide(engine)
    const user = userEvent.setup()
    const input = await screen.findByLabelText('Duration')

    await user.clear(input)
    await user.type(input, '4000')
    await user.keyboard('{Enter}')

    expect(engine.project?.slides[0]?.duration).toBe(10)
    expect(undoStack.entries).toHaveLength(0)
    expect(
      useNotificationStore
        .getState()
        .notifications.some((entry) => entry.message.includes('within [0.1, 3600]')),
    ).toBe(true)
  })

  it('rejects a non-numeric duration with the engine unchanged', async () => {
    const { engine, undoStack } = renderPanel()
    createSlide(engine)
    const input = await screen.findByLabelText('Duration')

    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(engine.project?.slides[0]?.duration).toBe(10)
    expect(undoStack.entries).toHaveLength(0)
    expect(
      useNotificationStore
        .getState()
        .notifications.some((entry) => entry.message.includes('must be a number')),
    ).toBe(true)
  })

  it('renames the active slide through RenameSlideCommand from the Inspector', async () => {
    const { engine, undoStack } = renderPanel()
    const slideId = createSlide(engine)
    const user = userEvent.setup()
    const input = await screen.findByLabelText('Slide Name')

    await user.clear(input)
    await user.type(input, 'Intro')
    await user.keyboard('{Enter}')

    expect(engine.project?.slides[0]?.name).toBe('Intro')
    expect(undoStack.entries.at(-1)?.type).toBe('RenameSlide')
    expect(undoStack.entries.at(-1)?.parameters).toEqual({ slideId, name: 'Intro' })
  })

  it('rejects an empty slide name with the engine unchanged', async () => {
    const { engine, undoStack } = renderPanel()
    createSlide(engine)
    const user = userEvent.setup()
    const input = await screen.findByLabelText('Slide Name')

    await user.clear(input)
    await user.keyboard('{Enter}')

    expect(engine.project?.slides[0]?.name).toBe('Slide 1')
    expect(undoStack.entries).toHaveLength(0)
    expect(
      useNotificationStore
        .getState()
        .notifications.some((entry) => entry.message.includes('must not be empty')),
    ).toBe(true)
  })

  it('follows the active slide when it changes', async () => {
    const { engine } = renderPanel()
    createSlide(engine)
    const second = engine.createSlide('Second')
    engine.setActiveSlide(second.id)

    await waitFor(() => {
      expect(screen.getByLabelText('Slide Name')).toHaveValue('Second')
    })
    expect(screen.getByLabelText('Duration')).toHaveValue(10)
  })

  it('keeps the timeline length equal to the active slide duration when edited', async () => {
    const { engine } = renderWithTimeline()
    const slideId = createSlide(engine)
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
    const user = userEvent.setup()

    const slider = await screen.findByRole('slider', { name: 'Playhead' })
    expect(slider).toHaveAttribute('aria-valuemax', '10')

    const input = screen.getByLabelText('Duration')
    await user.clear(input)
    await user.type(input, '25')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(slider).toHaveAttribute('aria-valuemax', '25')
    })
    expect(engine.project?.slides[0]?.duration).toBe(25)
    expect(engine.project?.slides[0]?.id).toBe(slideId)
  })

  it('shortening the duration clamps keyframes beyond it', async () => {
    const { engine } = renderPanel()
    createSlide(engine)
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
    engine.addKeyframe({ kind: 'node', nodeId: node.id, property: 'positionX' }, 8, 100)
    const user = userEvent.setup()
    const input = await screen.findByLabelText('Duration')

    await user.clear(input)
    await user.type(input, '5')
    await user.keyboard('{Enter}')

    const clamped = engine.getKeyframes(node.id, 'positionX')
    expect(clamped).toHaveLength(1)
    expect(clamped[0]?.time).toBe(5)
  })
})
