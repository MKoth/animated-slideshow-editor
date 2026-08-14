import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { SlidesPanel } from '../components/panels/SlidesPanel'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { noopPersistence } from './contextHarness'
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
      <SlidesPanel />
    </EngineContext.Provider>,
  )
  return { engine, undoStack }
}

function createProjectWithSlides(engine: Engine, names: string[] = ['Slide 1', 'Slide 2']) {
  engine.createProject({ name: 'Demo' })
  const slides = names.map((name) => engine.createSlide(name))
  engine.setActiveSlide(slides[0].id)
  return slides
}

async function slidesList() {
  return within(await screen.findByRole('listbox', { name: 'Slides' }))
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SlidesPanel', () => {
  it('shows an empty state when there is no project', () => {
    renderPanel()

    expect(screen.getByText('No slides created.')).toBeInTheDocument()
  })

  it('shows an empty state when the project has no slides', async () => {
    const { engine } = renderPanel()
    engine.createProject({ name: 'Demo' })

    await waitFor(() => {
      expect(screen.getByText('No slides created.')).toBeInTheDocument()
    })
  })

  it('renders a row per slide with a placeholder thumbnail, name, duration, and active indicator', async () => {
    const { engine } = renderPanel()
    const [first] = createProjectWithSlides(engine)

    const list = await slidesList()
    const firstRow = list.getByRole('option', { name: /Slide 1/ })
    const secondRow = list.getByRole('option', { name: /Slide 2/ })

    expect(list.getAllByRole('option')).toHaveLength(2)
    expect(firstRow.querySelector('.slides-list__thumb')).not.toBeNull()
    expect(secondRow.querySelector('.slides-list__thumb')).not.toBeNull()
    expect(within(firstRow).getByText('Slide 1')).toBeInTheDocument()
    expect(within(firstRow).getByText('10 s')).toBeInTheDocument()
    expect(within(firstRow).getByTitle('Active slide')).toBeInTheDocument()
    expect(within(secondRow).queryByTitle('Active slide')).not.toBeInTheDocument()
    expect(firstRow).toHaveAttribute('aria-selected', 'true')
    expect(secondRow).toHaveAttribute('aria-selected', 'false')
    expect(engine.activeSlideId).toBe(first.id)
  })

  it('appends a slide via the + button with the next free Slide N name and makes it active', async () => {
    const { engine, undoStack } = renderPanel()
    createProjectWithSlides(engine)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Add Slide' }))

    const list = await slidesList()
    const thirdRow = list.getByRole('option', { name: /Slide 3/ })
    expect(list.getAllByRole('option')).toHaveLength(3)
    expect(engine.activeSlideId).toBe(engine.project?.slides[2]?.id)
    expect(thirdRow).toHaveAttribute('aria-selected', 'true')
    expect(within(thirdRow).getByTitle('Active slide')).toBeInTheDocument()
    expect(undoStack.entries.at(-1)?.type).toBe('CreateSlide')
  })

  it('names a new slide with the lowest free ordinal when custom names exist', async () => {
    const { engine } = renderPanel()
    createProjectWithSlides(engine, ['Intro', 'Slide 1'])
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Add Slide' }))

    const list = await slidesList()
    expect(list.getByRole('option', { name: /Slide 2/ })).toBeInTheDocument()
    expect(engine.project?.slides.map((slide) => slide.name)).toEqual([
      'Intro',
      'Slide 1',
      'Slide 2',
    ])
  })

  it('removes a slide instantly with no confirmation dialog', async () => {
    const { engine, undoStack } = renderPanel()
    createProjectWithSlides(engine)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Delete Slide 1' }))

    const list = await slidesList()
    expect(list.queryByRole('option', { name: /Slide 1/ })).not.toBeInTheDocument()
    expect(list.getByRole('option', { name: /Slide 2/ })).toBeInTheDocument()
    expect(engine.project?.slides.map((slide) => slide.name)).toEqual(['Slide 2'])
    expect(engine.activeSlideId).toBe(engine.project?.slides[0]?.id)
    expect(
      within(list.getByRole('option', { name: /Slide 2/ })).getByTitle('Active slide'),
    ).toBeInTheDocument()
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(undoStack.entries.at(-1)?.type).toBe('DeleteSlide')
  })

  it('disables delete for the last remaining slide and leaves the engine unchanged', async () => {
    const { engine, undoStack } = renderPanel()
    const [only] = createProjectWithSlides(engine, ['Slide 1'])
    const user = userEvent.setup()

    const deleteButton = await screen.findByRole('button', { name: 'Delete Slide 1' })
    expect(deleteButton).toBeDisabled()
    await user.click(deleteButton)

    const list = await slidesList()
    expect(list.getByRole('option', { name: /Slide 1/ })).toBeInTheDocument()
    expect(engine.project?.slides.map((slide) => slide.id)).toEqual([only.id])
    expect(undoStack.entries).toHaveLength(0)
  })

  it('selects the slide and calls setActiveSlide on row click, never touching the scene-node selection store', async () => {
    const { engine } = renderPanel()
    const [, second] = createProjectWithSlides(engine)
    useSelectionStore.getState().select('some-node')
    const user = userEvent.setup()

    const list = await slidesList()
    await user.click(list.getByRole('option', { name: /Slide 2/ }))

    expect(engine.activeSlideId).toBe(second.id)
    expect(list.getByRole('option', { name: /Slide 2/ })).toHaveAttribute('aria-selected', 'true')
    expect(
      within(list.getByRole('option', { name: /Slide 2/ })).getByTitle('Active slide'),
    ).toBeInTheDocument()
    expect(
      within(list.getByRole('option', { name: /Slide 1/ })).queryByTitle('Active slide'),
    ).not.toBeInTheDocument()
    expect(useSelectionStore.getState().selectedIds).toEqual(['some-node'])
  })

  it('marks the row of the engine active slide when it changes from outside the panel', async () => {
    const { engine } = renderPanel()
    const [, second] = createProjectWithSlides(engine)

    await slidesList()
    engine.setActiveSlide(second.id)

    const list = await slidesList()
    expect(
      within(list.getByRole('option', { name: /Slide 2/ })).getByTitle('Active slide'),
    ).toBeInTheDocument()
    expect(
      within(list.getByRole('option', { name: /Slide 1/ })).queryByTitle('Active slide'),
    ).not.toBeInTheDocument()
    expect(list.getByRole('option', { name: /Slide 2/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('repoints the active indicator when the active slide is deleted', async () => {
    const { engine } = renderPanel()
    const slides = createProjectWithSlides(engine, ['Slide 1', 'Slide 2', 'Slide 3'])
    engine.setActiveSlide(slides[1].id)
    const user = userEvent.setup()

    await slidesList()
    await user.click(screen.getByRole('button', { name: 'Delete Slide 2' }))

    const list = await slidesList()
    expect(list.getAllByRole('option')).toHaveLength(2)
    expect(engine.activeSlideId).toBe(slides[2].id)
    expect(
      within(list.getByRole('option', { name: /Slide 3/ })).getByTitle('Active slide'),
    ).toBeInTheDocument()
  })
})
