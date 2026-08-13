import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { ScenePanel, SCENE_NODE_IDS_MIME } from '../components/panels/ScenePanel'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { useSelectionStore } from '../stores/selectionStore'

function renderPanel(): { engine: Engine; undoStack: UndoStack } {
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
  return { engine, undoStack }
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

  it('opens a z-order context menu on right-click, selecting the row', async () => {
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    const boy = engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
    const cat = engine.createNode(slide.scene.id, slide.scene.root.id, 'Cat')
    useSelectionStore.getState().select(cat.id)

    fireEvent.contextMenu(await screen.findByRole('treeitem', { name: 'Boy' }), {
      clientX: 120,
      clientY: 80,
    })

    const menu = screen.getByRole('menu', { name: 'Z-order' })
    expect(menu).toBeInTheDocument()
    expect(menu.style.left).toBe('120px')
    expect(menu.style.top).toBe('80px')
    expect(within(menu).getByRole('menuitem', { name: 'Bring Forward' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Send Backward' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Bring To Front' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Send To Back' })).toBeInTheDocument()
    expect(useSelectionStore.getState().selectedIds).toEqual([boy.id])
  })

  it('reorders siblings from the context menu and updates the tree order', async () => {
    const user = userEvent.setup()
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Cat')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Dog')

    fireEvent.contextMenu(await screen.findByRole('treeitem', { name: 'Boy' }), {
      clientX: 100,
      clientY: 100,
    })
    await user.click(screen.getByRole('menuitem', { name: 'Bring To Front' }))

    expect(
      slide.scene.root.children.filter((node) => !node.components.camera).map((node) => node.name),
    ).toEqual(['Cat', 'Dog', 'Boy'])
    const tree = await waitForTree('Slide 1')
    expect(
      tree.getAllByRole('treeitem').map((row) => row.textContent?.replace(/\s+/g, ' ').trim()),
    ).toEqual(['Root', 'Cat', 'Dog', 'Boy'])
    expect(screen.queryByRole('menu', { name: 'Z-order' })).not.toBeInTheDocument()
  })

  it('keeps a multi-selection when right-clicking an already selected row and reorders all of it', async () => {
    const user = userEvent.setup()
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    const boy = engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
    const cat = engine.createNode(slide.scene.id, slide.scene.root.id, 'Cat')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Dog')
    useSelectionStore.getState().selectMany([boy.id, cat.id])

    fireEvent.contextMenu(await screen.findByRole('treeitem', { name: 'Cat' }), {
      clientX: 100,
      clientY: 100,
    })
    expect(useSelectionStore.getState().selectedIds).toEqual([boy.id, cat.id])
    expect(screen.getByRole('menuitem', { name: 'Send To Back' })).toBeEnabled()
    await user.click(screen.getByRole('menuitem', { name: 'Send To Back' }))

    expect(
      slide.scene.root.children.filter((node) => !node.components.camera).map((node) => node.name),
    ).toEqual(['Boy', 'Cat', 'Dog'])
  })
})

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

function startDrag(row: HTMLElement): DataTransfer {
  const dataTransfer = new DataTransfer()
  fireEvent.dragStart(row, { dataTransfer })
  return dataTransfer
}

function hoverZone(
  row: HTMLElement,
  zone: 'before' | 'into' | 'after',
  dataTransfer: DataTransfer,
) {
  const clientY = zone === 'before' ? 5 : zone === 'into' ? 20 : 35
  fireEvent.dragOver(row, { dataTransfer, clientY })
}

function dropOn(row: HTMLElement, zone: 'before' | 'into' | 'after', dataTransfer: DataTransfer) {
  const clientY = zone === 'before' ? 5 : zone === 'into' ? 20 : 35
  fireEvent.drop(row, { dataTransfer, clientY })
}

function transactions(undoStack: UndoStack): number {
  return undoStack.entries.filter((entry) => entry.type === 'Transaction').length
}

describe('ScenePanel drag & drop', () => {
  it('makes every non-root row draggable and leaves the root row fixed', async () => {
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')

    const tree = await waitForTree('Slide 1')
    expect(tree.getByRole('treeitem', { name: 'Root' })).not.toHaveAttribute('draggable')
    expect(tree.getByRole('treeitem', { name: 'Boy' })).toHaveAttribute('draggable', 'true')
  })

  it('selects an unselected row first and carries it alone in the drag payload', async () => {
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    const boy = engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
    const cat = engine.createNode(slide.scene.id, slide.scene.root.id, 'Cat')
    useSelectionStore.getState().select(cat.id)

    await waitForTree('Slide 1')
    const boyRow = screen.getByRole('treeitem', { name: 'Boy' })
    const dataTransfer = startDrag(boyRow)

    expect(useSelectionStore.getState().selectedIds).toEqual([boy.id])
    expect(dataTransfer.getData(SCENE_NODE_IDS_MIME)).toBe(JSON.stringify([boy.id]))
    expect(dataTransfer.effectAllowed).toBe('move')
  })

  it('carries the whole selection when the drag starts on a selected row', async () => {
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    const boy = engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
    const cat = engine.createNode(slide.scene.id, slide.scene.root.id, 'Cat')
    const dog = engine.createNode(slide.scene.id, slide.scene.root.id, 'Dog')
    useSelectionStore.getState().selectMany([boy.id, cat.id])

    await waitForTree('Slide 1')
    const dataTransfer = startDrag(screen.getByRole('treeitem', { name: 'Boy' }))

    expect(dataTransfer.getData(SCENE_NODE_IDS_MIME)).toBe(JSON.stringify([boy.id, cat.id]))
    expect(useSelectionStore.getState().selectedIds).toEqual([boy.id, cat.id])
    void dog
  })

  it('shows a before/after insertion line and a parent highlight per hover zone', async () => {
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Cat')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Dog')

    await waitForTree('Slide 1')
    const boyRow = screen.getByRole('treeitem', { name: 'Boy' })
    const catRow = screen.getByRole('treeitem', { name: 'Cat' })
    mockRowRect(catRow)
    const dataTransfer = startDrag(boyRow)

    hoverZone(catRow, 'before', dataTransfer)
    await waitFor(() => expect(catRow).toHaveClass('scene-tree__row--drop-before'))
    expect(catRow).not.toHaveClass('scene-tree__row--drop-into')

    hoverZone(catRow, 'into', dataTransfer)
    await waitFor(() => expect(catRow).toHaveClass('scene-tree__row--drop-into'))

    hoverZone(catRow, 'after', dataTransfer)
    await waitFor(() => expect(catRow).toHaveClass('scene-tree__row--drop-after'))
  })

  it('offers no affordance when hovering a dragged row or one of its descendants', async () => {
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    const group = engine.createNode(slide.scene.id, slide.scene.root.id, 'Group')
    engine.createNode(slide.scene.id, group.id, 'Child')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Other')

    await waitForTree('Slide 1')
    const groupRow = screen.getByRole('treeitem', { name: 'Group' })
    const childRow = screen.getByRole('treeitem', { name: 'Child' })
    mockRowRect(groupRow)
    mockRowRect(childRow)
    const dataTransfer = startDrag(groupRow)

    hoverZone(groupRow, 'into', dataTransfer)
    expect(groupRow).not.toHaveClass('scene-tree__row--drop-before')
    expect(groupRow).not.toHaveClass('scene-tree__row--drop-into')
    expect(groupRow).not.toHaveClass('scene-tree__row--drop-after')

    hoverZone(childRow, 'into', dataTransfer)
    expect(childRow).not.toHaveClass('scene-tree__row--drop-before')
    expect(childRow).not.toHaveClass('scene-tree__row--drop-into')
    expect(childRow).not.toHaveClass('scene-tree__row--drop-after')
  })

  it('ignores a drop onto a dragged row or one of its descendants', async () => {
    const { engine, undoStack } = renderPanel()
    const slide = createProjectAndSlide(engine)
    const group = engine.createNode(slide.scene.id, slide.scene.root.id, 'Group')
    engine.createNode(slide.scene.id, group.id, 'Child')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Other')

    await waitForTree('Slide 1')
    const groupRow = screen.getByRole('treeitem', { name: 'Group' })
    const childRow = screen.getByRole('treeitem', { name: 'Child' })
    mockRowRect(groupRow)
    mockRowRect(childRow)
    const dataTransfer = startDrag(groupRow)
    const before = undoStack.entries.length

    dropOn(groupRow, 'into', dataTransfer)
    dropOn(childRow, 'into', dataTransfer)

    expect(undoStack.entries).toHaveLength(before)
    expect(slide.scene.root.children.map((node) => node.name)).toEqual(['Camera', 'Group', 'Other'])
    expect(slide.scene.root.children[0]?.parent).not.toBeNull()
  })

  it('reorders a single node by dropping above a sibling row in one transaction', async () => {
    const { engine, undoStack } = renderPanel()
    const slide = createProjectAndSlide(engine)
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Cat')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Dog')

    await waitForTree('Slide 1')
    const boyRow = screen.getByRole('treeitem', { name: 'Boy' })
    const catRow = screen.getByRole('treeitem', { name: 'Cat' })
    mockRowRect(catRow)
    const dataTransfer = startDrag(boyRow)

    hoverZone(catRow, 'before', dataTransfer)
    dropOn(catRow, 'before', dataTransfer)

    expect(
      slide.scene.root.children.filter((node) => !node.components.camera).map((node) => node.name),
    ).toEqual(['Cat', 'Boy', 'Dog'])
    expect(transactions(undoStack)).toBe(1)
    const tree = await waitForTree('Slide 1')
    expect(
      tree.getAllByRole('treeitem').map((row) => row.textContent?.replace(/\s+/g, ' ').trim()),
    ).toEqual(['Root', 'Cat', 'Boy', 'Dog'])
  })

  it('reorders a whole selection preserving relative order in one transaction', async () => {
    const { engine, undoStack } = renderPanel()
    const slide = createProjectAndSlide(engine)
    const boy = engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
    const cat = engine.createNode(slide.scene.id, slide.scene.root.id, 'Cat')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Dog')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Fox')
    useSelectionStore.getState().selectMany([boy.id, cat.id])

    await waitForTree('Slide 1')
    const foxRow = screen.getByRole('treeitem', { name: 'Fox' })
    await waitForTree('Slide 1')
    const boyRow = screen.getByRole('treeitem', { name: 'Boy' })
    mockRowRect(foxRow)
    const dataTransfer = startDrag(boyRow)

    hoverZone(foxRow, 'before', dataTransfer)
    dropOn(foxRow, 'before', dataTransfer)

    expect(
      slide.scene.root.children.filter((node) => !node.components.camera).map((node) => node.name),
    ).toEqual(['Dog', 'Boy', 'Cat', 'Fox'])
    expect(transactions(undoStack)).toBe(1)
  })

  it('reparents a node by dropping into the center of a row', async () => {
    const { engine, undoStack } = renderPanel()
    const slide = createProjectAndSlide(engine)
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
    const cat = engine.createNode(slide.scene.id, slide.scene.root.id, 'Cat')

    await waitForTree('Slide 1')
    const boyRow = screen.getByRole('treeitem', { name: 'Boy' })
    const catRow = screen.getByRole('treeitem', { name: 'Cat' })
    mockRowRect(catRow)
    const dataTransfer = startDrag(boyRow)

    hoverZone(catRow, 'into', dataTransfer)
    dropOn(catRow, 'into', dataTransfer)

    expect(slide.scene.root.children[1]?.name).toBe('Cat')
    expect(
      slide.scene.root.children.filter((node) => !node.components.camera).map((node) => node.name),
    ).toEqual(['Cat'])
    expect(engine.getNode(cat.id).children.map((child) => child.name)).toEqual(['Boy'])
    expect(transactions(undoStack)).toBe(1)
  })

  it('inserts after a row when dropping on its bottom half', async () => {
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Cat')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Dog')

    await waitForTree('Slide 1')
    const boyRow = screen.getByRole('treeitem', { name: 'Boy' })
    const catRow = screen.getByRole('treeitem', { name: 'Cat' })
    mockRowRect(catRow)
    const dataTransfer = startDrag(boyRow)

    hoverZone(catRow, 'after', dataTransfer)
    dropOn(catRow, 'after', dataTransfer)

    expect(
      slide.scene.root.children.filter((node) => !node.components.camera).map((node) => node.name),
    ).toEqual(['Cat', 'Boy', 'Dog'])
  })

  it('sends a node to the top level when dropped on the root row', async () => {
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    const group = engine.createNode(slide.scene.id, slide.scene.root.id, 'Group')
    const leaf = engine.createNode(slide.scene.id, group.id, 'Leaf')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Other')

    await waitForTree('Slide 1')
    const rootRow = screen.getByRole('treeitem', { name: 'Root' })
    const leafRow = screen.getByRole('treeitem', { name: 'Leaf' })
    mockRowRect(rootRow)
    mockRowRect(leafRow)
    const dataTransfer = startDrag(leafRow)

    hoverZone(rootRow, 'into', dataTransfer)
    dropOn(rootRow, 'into', dataTransfer)

    expect(
      slide.scene.root.children.filter((node) => !node.components.camera).map((node) => node.name),
    ).toEqual(['Group', 'Other', 'Leaf'])
    expect(engine.getNode(group.id).children).toHaveLength(0)
    expect(engine.getNode(leaf.id).parent?.id).toBe(slide.scene.root.id)
  })

  it('keeps the camera first when a node is dropped above the first child', async () => {
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Girl')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')

    await waitForTree('Slide 1')
    const girlRow = screen.getByRole('treeitem', { name: 'Girl' })
    await waitForTree('Slide 1')
    const boyRow = screen.getByRole('treeitem', { name: 'Boy' })
    mockRowRect(girlRow)
    const dataTransfer = startDrag(boyRow)

    hoverZone(girlRow, 'before', dataTransfer)
    dropOn(girlRow, 'before', dataTransfer)

    expect(slide.scene.root.children.map((node) => node.name)).toEqual(['Camera', 'Boy', 'Girl'])
  })

  it('cancels an in-progress drag when Escape is pressed so a drop does nothing', async () => {
    const { engine, undoStack } = renderPanel()
    const slide = createProjectAndSlide(engine)
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Cat')

    await waitForTree('Slide 1')
    const catRow = screen.getByRole('treeitem', { name: 'Cat' })
    mockRowRect(catRow)
    const dataTransfer = startDrag(screen.getByRole('treeitem', { name: 'Boy' }))
    const before = undoStack.entries.length

    fireEvent.keyDown(document, { key: 'Escape' })
    dropOn(catRow, 'into', dataTransfer)

    expect(undoStack.entries).toHaveLength(before)
    expect(
      slide.scene.root.children.filter((node) => !node.components.camera).map((node) => node.name),
    ).toEqual(['Boy', 'Cat'])
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
