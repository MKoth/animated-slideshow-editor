import { act, render, screen, waitFor, within } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
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
import { useNotificationStore } from '../stores/notificationStore'
import { useThumbnailStore } from '../stores/thumbnailStore'

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
  useThumbnailStore.setState({ thumbnails: {} })
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

describe('SlidesPanel inline rename', () => {
  type SlidesList = Awaited<ReturnType<typeof slidesList>>

  async function startRename(list: SlidesList, slideName: string): Promise<HTMLInputElement> {
    const row = list.getByRole('option', { name: new RegExp(slideName) })
    await userEvent.dblClick(within(row).getByText(slideName))
    return screen.findByRole('textbox', { name: `Rename ${slideName}` })
  }

  it('commits the rename on Enter via RenameSlideCommand and the row updates', async () => {
    const { engine, undoStack } = renderPanel()
    createProjectWithSlides(engine)
    const list = await slidesList()
    const input = await startRename(list, 'Slide 1')

    await userEvent.clear(input)
    await userEvent.type(input, 'Intro')
    await userEvent.keyboard('{Enter}')

    expect(engine.project?.slides[0]?.name).toBe('Intro')
    await waitFor(() => {
      expect(
        within(list.getByRole('option', { name: /Intro/ })).getByText('Intro'),
      ).toBeInTheDocument()
    })
    expect(undoStack.entries.at(-1)?.type).toBe('RenameSlide')
    expect(undoStack.entries.at(-1)?.parameters).toEqual({
      slideId: engine.project?.slides[0]?.id,
      name: 'Intro',
    })
    expect(screen.queryByRole('textbox', { name: 'Rename Intro' })).not.toBeInTheDocument()
  })

  it('commits the rename on blur', async () => {
    const { engine, undoStack } = renderPanel()
    createProjectWithSlides(engine)
    const list = await slidesList()
    const input = await startRename(list, 'Slide 1')

    await userEvent.type(input, 'X')
    await userEvent.tab()

    await waitFor(() => {
      expect(engine.project?.slides[0]?.name).toBe('Slide 1X')
    })
    expect(undoStack.entries.at(-1)?.type).toBe('RenameSlide')
  })

  it('rejects an empty name, leaving the engine unchanged and showing a notification', async () => {
    const { engine, undoStack } = renderPanel()
    createProjectWithSlides(engine)
    const list = await slidesList()
    const input = await startRename(list, 'Slide 1')

    await userEvent.clear(input)
    await userEvent.keyboard('{Enter}')

    expect(engine.project?.slides[0]?.name).toBe('Slide 1')
    expect(undoStack.entries).toHaveLength(0)
    expect(
      useNotificationStore
        .getState()
        .notifications.some((entry) => entry.message.includes('Slide name')),
    ).toBe(true)
    await waitFor(() => {
      expect(
        within(list.getByRole('option', { name: /Slide 1/ })).getByText('Slide 1'),
      ).toBeInTheDocument()
    })
  })

  it('cancels the rename on Escape', async () => {
    const { engine } = renderPanel()
    createProjectWithSlides(engine)
    const list = await slidesList()
    const input = await startRename(list, 'Slide 1')

    await userEvent.type(input, 'Discarded')
    await userEvent.keyboard('{Escape}')

    expect(engine.project?.slides[0]?.name).toBe('Slide 1')
    expect(screen.queryByRole('textbox', { name: 'Rename Slide 1' })).not.toBeInTheDocument()
  })
})

describe('SlidesPanel duplicate', () => {
  it('inserts an independent copy after the source and makes it active', async () => {
    const { engine, undoStack } = renderPanel()
    const slides = createProjectWithSlides(engine)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Duplicate Slide 1' }))

    const list = await slidesList()
    const allSlides = engine.project?.slides ?? []
    expect(allSlides.map((slide) => slide.name)).toEqual(['Slide 1', 'Slide 1', 'Slide 2'])
    expect(allSlides[1]?.id).not.toBe(slides[0]?.id)
    expect(allSlides[1]?.scene.id).not.toBe(slides[0]?.scene.id)
    expect(allSlides[1]?.duration).toBe(allSlides[0]?.duration)
    expect(engine.activeSlideId).toBe(allSlides[1]?.id)
    expect(list.getAllByRole('option')).toHaveLength(3)
    const copies = list.getAllByRole('option', { name: 'Slide 110 s' })
    expect(copies).toHaveLength(2)
    expect(within(copies[1]).getByTitle('Active slide')).toBeInTheDocument()
    expect(undoStack.entries.at(-1)?.type).toBe('DuplicateSlide')
  })
})

describe('SlidesPanel drag-and-drop reorder', () => {
  type SlidesList = Awaited<ReturnType<typeof slidesList>>

  function mockRowRect(element: HTMLElement, height = 40): void {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 200,
      bottom: height,
      left: 0,
      width: 200,
      height,
      toJSON: () => ({}),
    } as DOMRect)
  }

  async function dragFrom(list: SlidesList, name: string): Promise<DataTransfer> {
    const row = list.getByRole('option', { name: new RegExp(name) })
    mockRowRect(row)
    const dataTransfer = new DataTransfer()
    fireEvent.dragStart(row, { dataTransfer })
    return dataTransfer
  }

  function dropOn(
    list: SlidesList,
    name: string,
    zone: 'before' | 'after',
    dataTransfer: DataTransfer,
  ): void {
    const row = list.getByRole('option', { name: new RegExp(name) })
    mockRowRect(row)
    const clientY = zone === 'before' ? 5 : 35
    fireEvent.dragOver(row, { dataTransfer, clientY })
    fireEvent.drop(row, { dataTransfer, clientY })
  }

  it('moves a slide below another via MoveSlideCommand and keeps the list in sync', async () => {
    const { engine, undoStack } = renderPanel()
    createProjectWithSlides(engine, ['A', 'B', 'C'])
    const list = await slidesList()

    const dataTransfer = await dragFrom(list, 'A')
    dropOn(list, 'C', 'after', dataTransfer)

    expect(engine.project?.slides.map((slide) => slide.name)).toEqual(['B', 'C', 'A'])
    expect(undoStack.entries.at(-1)?.type).toBe('MoveSlide')
    expect(undoStack.entries.at(-1)?.parameters).toEqual({
      slideId: engine.project?.slides[2]?.id,
      index: 2,
    })
    const names = list.getAllByRole('option').map((row) => row.textContent)
    expect(names.join('|')).toMatch(/B.*C.*A/)
  })

  it('moves a slide above another via MoveSlideCommand', async () => {
    const { engine, undoStack } = renderPanel()
    createProjectWithSlides(engine, ['A', 'B', 'C'])
    const list = await slidesList()

    const dataTransfer = await dragFrom(list, 'C')
    dropOn(list, 'A', 'before', dataTransfer)

    expect(engine.project?.slides.map((slide) => slide.name)).toEqual(['C', 'A', 'B'])
    expect(undoStack.entries.at(-1)?.type).toBe('MoveSlide')
  })

  it('keeps the same order when dropped on its own position', async () => {
    const { engine, undoStack } = renderPanel()
    createProjectWithSlides(engine, ['A', 'B', 'C'])
    const list = await slidesList()

    const dataTransfer = await dragFrom(list, 'B')
    dropOn(list, 'B', 'before', dataTransfer)

    expect(engine.project?.slides.map((slide) => slide.name)).toEqual(['A', 'B', 'C'])
    expect(undoStack.entries).toHaveLength(0)
  })
})

describe('SlidesPanel thumbnails', () => {
  it('shows the placeholder before the first capture and the image after', async () => {
    const { engine } = renderPanel()
    const [first] = createProjectWithSlides(engine)
    const list = await slidesList()

    const firstRow = list.getByRole('option', { name: /Slide 1/ })
    expect(firstRow.querySelector('.slides-list__thumb img')).toBeNull()

    act(() => {
      useThumbnailStore.getState().setThumbnail(first.id, 'data:image/png;base64,thumb')
    })

    await waitFor(() => {
      const row = list.getByRole('option', { name: /Slide 1/ })
      const image = row.querySelector<HTMLImageElement>('.slides-list__thumb img')
      expect(image).not.toBeNull()
      expect(image?.getAttribute('src')).toBe('data:image/png;base64,thumb')
    })
  })

  it('falls back to the placeholder when the thumbnail is removed', async () => {
    const { engine } = renderPanel()
    const [first] = createProjectWithSlides(engine)
    const list = await slidesList()
    act(() => {
      useThumbnailStore.getState().setThumbnail(first.id, 'data:image/png;base64,thumb')
    })
    await waitFor(() => {
      expect(
        list.getByRole('option', { name: /Slide 1/ }).querySelector('.slides-list__thumb img'),
      ).not.toBeNull()
    })

    act(() => {
      useThumbnailStore.getState().remove(first.id)
    })

    await waitFor(() => {
      const row = list.getByRole('option', { name: /Slide 1/ })
      expect(row.querySelector('.slides-list__thumb img')).toBeNull()
    })
  })
})
