import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { ScenePanel } from '../components/panels/ScenePanel'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { useSelectionStore } from '../stores/selectionStore'

function renderPanel(): { engine: Engine } {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: (command) => dispatcher.dispatch(command),
  }
  render(
    <EngineContext.Provider value={value}>
      <ScenePanel />
    </EngineContext.Provider>,
  )
  return { engine }
}

function createProjectAndSlide(engine: Engine) {
  engine.createProject({ name: 'Demo' })
  return engine.createSlide('Slide 1')
}

async function waitForTree(slideName: string) {
  return within(await screen.findByRole('tree', { name: `Scene tree of ${slideName}` }))
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
})

describe('ScenePanel', () => {
  it('shows an empty state when there is no project', () => {
    renderPanel()

    expect(screen.getByText('No project. Create one to get started.')).toBeInTheDocument()
  })

  it('shows an empty state when the project has no slides', async () => {
    const { engine } = renderPanel()
    engine.createProject({ name: 'Demo' })

    expect(await screen.findByText('No slides created.')).toBeInTheDocument()
  })

  it('lists the scene tree per slide with the camera node hidden', async () => {
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')

    const tree = await waitForTree('Slide 1')
    expect(await screen.findByRole('heading', { name: 'Slide 1' })).toBeInTheDocument()
    expect(await tree.findByRole('treeitem', { name: 'Root' })).toBeInTheDocument()
    expect(tree.getByRole('treeitem', { name: 'Boy' })).toBeInTheDocument()
    expect(tree.queryByRole('treeitem', { name: 'Camera' })).not.toBeInTheDocument()
  })

  it('nests children under their parent row', async () => {
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    engine.createNode(slide.scene.id, parent.id, 'Child')

    const tree = await waitForTree('Slide 1')
    const parentRow = await tree.findByRole('treeitem', { name: 'Parent' })
    const childRow = tree.getByRole('treeitem', { name: 'Child' })
    expect(parentRow.closest('li')?.contains(childRow.closest('li') as Node)).toBe(true)
  })

  it('renders an icon per node kind', async () => {
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Tree', {
      components: {
        assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-1' },
      },
    })
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Label', {
      components: { text: { kind: 'text', content: 'Hi', fontSize: 20, alignment: 'left' } },
    })

    const tree = await waitForTree('Slide 1')
    const rootRow = await tree.findByRole('treeitem', { name: 'Root' })
    expect(rootRow.querySelector('[data-icon="folder"]')).not.toBeNull()
    expect(
      tree.getByRole('treeitem', { name: 'Tree' }).querySelector('[data-icon="image"]'),
    ).not.toBeNull()
    expect(
      tree.getByRole('treeitem', { name: 'Label' }).querySelector('[data-icon="text"]'),
    ).not.toBeNull()
  })

  it('shows visibility and lock placeholder indicators on every row', async () => {
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Hidden', { visible: false })

    const tree = await waitForTree('Slide 1')
    const boyRow = await tree.findByRole('treeitem', { name: 'Boy' })
    const hiddenRow = tree.getByRole('treeitem', { name: 'Hidden' })
    expect(within(boyRow).getByTitle('Visible')).toBeInTheDocument()
    expect(within(hiddenRow).getByTitle('Hidden')).toBeInTheDocument()
    expect(within(boyRow).getByTitle('Locked')).toBeInTheDocument()
    expect(within(hiddenRow).getByTitle('Locked')).toBeInTheDocument()
  })

  it('renders a tree for every slide', async () => {
    const { engine } = renderPanel()
    const first = createProjectAndSlide(engine)
    const second = engine.createSlide('Slide 2')
    engine.createNode(first.scene.id, first.scene.root.id, 'Only First')
    engine.createNode(second.scene.id, second.scene.root.id, 'Only Second')

    await waitFor(() => {
      expect(screen.getByRole('tree', { name: 'Scene tree of Slide 1' })).toBeInTheDocument()
      expect(screen.getByRole('tree', { name: 'Scene tree of Slide 2' })).toBeInTheDocument()
    })
    expect(
      within(screen.getByRole('tree', { name: 'Scene tree of Slide 1' })).getByRole('treeitem', {
        name: 'Only First',
      }),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('tree', { name: 'Scene tree of Slide 2' })).queryByRole('treeitem', {
        name: 'Only First',
      }),
    ).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('tree', { name: 'Scene tree of Slide 2' })).getByRole('treeitem', {
        name: 'Only Second',
      }),
    ).toBeInTheDocument()
  })

  it('selects the node in the selection store when its row is clicked', async () => {
    const user = userEvent.setup()
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    const boy = engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')

    await user.click(await screen.findByRole('treeitem', { name: 'Boy' }))

    expect(useSelectionStore.getState().selectedIds).toEqual([boy.id])
  })

  it('extends the selection with shift-click and toggles with ctrl-click like the canvas', async () => {
    const user = userEvent.setup()
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    const boy = engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
    const cat = engine.createNode(slide.scene.id, slide.scene.root.id, 'Cat')

    await user.click(await screen.findByRole('treeitem', { name: 'Boy' }))
    fireEvent.click(screen.getByRole('treeitem', { name: 'Cat' }), { shiftKey: true })

    expect(useSelectionStore.getState().selectedIds).toEqual([boy.id, cat.id])

    fireEvent.click(screen.getByRole('treeitem', { name: 'Boy' }), { ctrlKey: true })

    expect(useSelectionStore.getState().selectedIds).toEqual([cat.id])
  })

  it('highlights rows in sync with the selection store', async () => {
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    const boy = engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
    const cat = engine.createNode(slide.scene.id, slide.scene.root.id, 'Cat')

    const tree = await waitForTree('Slide 1')
    const boyRow = await tree.findByRole('treeitem', { name: 'Boy' })
    const catRow = tree.getByRole('treeitem', { name: 'Cat' })
    const rootRow = tree.getByRole('treeitem', { name: 'Root' })

    useSelectionStore.getState().selectMany([boy.id, cat.id])

    await waitFor(() => expect(boyRow).toHaveAttribute('aria-selected', 'true'))
    expect(catRow).toHaveAttribute('aria-selected', 'true')
    expect(rootRow).toHaveAttribute('aria-selected', 'false')
  })

  it('adds and renames rows as nodes change', async () => {
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    const boy = engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')

    expect(
      await (await waitForTree('Slide 1')).findByRole('treeitem', { name: 'Boy' }),
    ).toBeInTheDocument()

    engine.renameNode(boy.id, 'Hero')

    expect(
      await (await waitForTree('Slide 1')).findByRole('treeitem', { name: 'Hero' }),
    ).toBeInTheDocument()
    expect(
      (await waitForTree('Slide 1')).queryByRole('treeitem', { name: 'Boy' }),
    ).not.toBeInTheDocument()
  })
})
