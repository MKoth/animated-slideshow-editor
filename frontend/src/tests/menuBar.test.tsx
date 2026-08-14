import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { MenuBar } from '../components/editor/MenuBar'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { useClipboardStore } from '../stores/clipboardStore'
import { useSelectionStore } from '../stores/selectionStore'

async function openEditMenu() {
  const user = userEvent.setup()
  await user.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Edit' }))
}

async function openFileMenu() {
  const user = userEvent.setup()
  await user.click(within(screen.getByRole('banner')).getByRole('button', { name: 'File' }))
}

function renderMenuBar(): {
  engine: Engine
  undoStack: UndoStack
  save: ReturnType<typeof vi.fn>
} {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const save = vi.fn()
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: (command) => dispatcher.dispatch(command),
    persistence: {
      save,
      onCommandSucceeded: () => undefined,
      dispose: () => undefined,
    },
  }
  render(
    <EngineContext.Provider value={value}>
      <MenuBar />
    </EngineContext.Provider>,
  )
  return { engine, undoStack, save }
}

function createProjectAndSlide(engine: Engine) {
  engine.createProject({ name: 'Demo' })
  return engine.createSlide('Slide 1')
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  useClipboardStore.setState({ items: [] })
})

describe('MenuBar z-order items', () => {
  it('disables the four z-order items without a selection', async () => {
    renderMenuBar()

    await openEditMenu()

    expect(screen.getByRole('menuitem', { name: 'Bring Forward' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Send Backward' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Bring To Front' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Send To Back' })).toBeDisabled()
  })

  it('disables the z-order items when no selected node can move', async () => {
    const { engine } = renderMenuBar()
    const slide = createProjectAndSlide(engine)
    const boy = engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
    useSelectionStore.getState().select(boy.id)

    await openEditMenu()

    expect(screen.getByRole('menuitem', { name: 'Bring Forward' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Send Backward' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Bring To Front' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Send To Back' })).toBeDisabled()
  })

  it('reorders through the Edit menu and records a ChangeZOrder command', async () => {
    const { engine, undoStack } = renderMenuBar()
    const slide = createProjectAndSlide(engine)
    const a = engine.createNode(slide.scene.id, slide.scene.root.id, 'A')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'B')
    const c = engine.createNode(slide.scene.id, slide.scene.root.id, 'C')
    const before = undoStack.entries.length
    useSelectionStore.getState().select(a.id)
    const user = userEvent.setup()

    await openEditMenu()
    expect(screen.getByRole('menuitem', { name: 'Bring To Front' })).toBeEnabled()
    await user.click(screen.getByRole('menuitem', { name: 'Bring To Front' }))

    expect(
      slide.scene.root.children.filter((node) => !node.components.camera).map((node) => node.name),
    ).toEqual(['B', 'C', 'A'])
    expect(undoStack.entries[0]).toMatchObject({
      type: 'ChangeZOrder',
      parameters: { nodeId: a.id, mode: 'bringToFront' },
    })
    expect(undoStack.entries).toHaveLength(before + 1)

    useSelectionStore.getState().select(c.id)
    await openEditMenu()
    expect(screen.getByRole('menuitem', { name: 'Send To Back' })).toBeEnabled()
    await user.click(screen.getByRole('menuitem', { name: 'Send To Back' }))

    expect(
      slide.scene.root.children.filter((node) => !node.components.camera).map((node) => node.name),
    ).toEqual(['C', 'B', 'A'])
  })

  it('re-evaluates the possible operations after a reorder without reselection', async () => {
    const { engine } = renderMenuBar()
    const slide = createProjectAndSlide(engine)
    engine.createNode(slide.scene.id, slide.scene.root.id, 'A')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'B')
    const c = engine.createNode(slide.scene.id, slide.scene.root.id, 'C')
    useSelectionStore.getState().select(c.id)
    const user = userEvent.setup()

    await openEditMenu()
    expect(screen.getByRole('menuitem', { name: 'Bring Forward' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Bring To Front' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Send Backward' })).toBeEnabled()
    await user.click(screen.getByRole('menuitem', { name: 'Send Backward' }))

    await openEditMenu()
    expect(screen.getByRole('menuitem', { name: 'Bring Forward' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Bring To Front' })).toBeEnabled()
  })
})

describe('MenuBar save item', () => {
  it('saves the project from the File menu', async () => {
    const { save } = renderMenuBar()
    const user = userEvent.setup()

    await openFileMenu()
    await user.click(screen.getByRole('menuitem', { name: 'Save' }))

    expect(save).toHaveBeenCalledTimes(1)
  })
})
