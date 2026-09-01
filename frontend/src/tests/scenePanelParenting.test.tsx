import { fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { ScenePanel } from '../components/panels/ScenePanel'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { noopPersistence } from './contextHarness'
import { useMissingAssetsStore } from '../stores/missingAssetsStore'
import { useParentingModeStore } from '../stores/parentingModeStore'
import { useSelectionStore } from '../stores/selectionStore'
import { worldTransformOf } from '../engine/worldTransform'

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

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  useMissingAssetsStore.setState({ report: null, dialogVisible: false })
  useParentingModeStore.getState().reset()
})

describe('ScenePanel parenting mode dialog', () => {
  it('shows Keep World vs Snap to Tail modal before committing (default Keep World)', async () => {
    const user = userEvent.setup()
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    engine.createNode(slide.scene.id, slide.scene.root.id, 'ParentBone', {
      components: { bone: { kind: 'bone', length: 100 } },
    })
    const child = engine.createNode(slide.scene.id, slide.scene.root.id, 'ChildBone', {
      transform: { x: 50, y: 50, rotation: 0, scaleX: 1, scaleY: 1 },
      components: { bone: { kind: 'bone', length: 50 } },
    })
    await waitForTree('Slide 1')
    const parentRow = screen.getByRole('treeitem', { name: 'ParentBone' })
    const childRow = screen.getByRole('treeitem', { name: 'ChildBone' })
    mockRowRect(parentRow)
    const dt = startDrag(childRow)
    hoverZone(parentRow, 'into', dt)
    dropOn(parentRow, 'into', dt)

    const dialog = await screen.findByRole('dialog', { name: 'Parenting mode' })
    expect(within(dialog).getByText(/Keep World Transform/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Snap to Parent Tail/)).toBeInTheDocument()
    // default Keep World checked
    const keepRadio = within(dialog).getByRole('radio', {
      name: /Keep World Transform/,
    }) as HTMLInputElement
    expect(keepRadio.checked).toBe(true)
    // cancel should not reparent
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(engine.getNode(child.id).parent?.id).toBe(slide.scene.root.id)
    expect(screen.queryByRole('dialog', { name: 'Parenting mode' })).not.toBeInTheDocument()
  })

  it('Keep World recomputes local to preserve world position', async () => {
    const user = userEvent.setup()
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent', {
      transform: { x: 30, y: 40, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    const child = engine.createNode(slide.scene.id, slide.scene.root.id, 'Child', {
      transform: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    const worldBefore = worldTransformOf(slide.scene, child.id)!
    await waitForTree('Slide 1')
    const parentRow = screen.getByRole('treeitem', { name: 'Parent' })
    const childRow = screen.getByRole('treeitem', { name: 'Child' })
    mockRowRect(parentRow)
    const dt = startDrag(childRow)
    hoverZone(parentRow, 'into', dt)
    dropOn(parentRow, 'into', dt)
    const dialog = await screen.findByRole('dialog', { name: 'Parenting mode' })
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    // Use engine's scene to compute
    const scene = engine.getSlide(slide.id).scene
    const wAfter = worldTransformOf(scene, child.id)!
    expect(wAfter.x).toBeCloseTo(worldBefore.x, 5)
    expect(wAfter.y).toBeCloseTo(worldBefore.y, 5)
  })

  it('Snap to Tail resets child local to 0 at parent tail', async () => {
    const user = userEvent.setup()
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    engine.createNode(slide.scene.id, slide.scene.root.id, 'ParentBone', {
      components: { bone: { kind: 'bone', length: 120 } },
    })
    const child = engine.createNode(slide.scene.id, slide.scene.root.id, 'ChildBone', {
      transform: { x: 99, y: 99, rotation: 1, scaleX: 2, scaleY: 2 },
      components: { bone: { kind: 'bone', length: 40 } },
    })
    await waitForTree('Slide 1')
    const parentRow = screen.getByRole('treeitem', { name: 'ParentBone' })
    const childRow = screen.getByRole('treeitem', { name: 'ChildBone' })
    mockRowRect(parentRow)
    const dt = startDrag(childRow)
    hoverZone(parentRow, 'into', dt)
    dropOn(parentRow, 'into', dt)
    const dialog = await screen.findByRole('dialog', { name: 'Parenting mode' })
    const snapRadio = within(dialog).getByRole('radio', { name: /Snap to Parent Tail/ })
    await user.click(snapRadio)
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    const t = engine.getNode(child.id).transform
    expect(t.x).toBeCloseTo(120, 5)
    expect(t.y).toBeCloseTo(0, 5)
    expect(t.rotation).toBeCloseTo(0, 5)
    expect(t.scaleX).toBe(1)
  })

  it('Remember my choice persists for session and is resettable', async () => {
    const user = userEvent.setup()
    const { engine } = renderPanel()
    const slide = createProjectAndSlide(engine)
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'ParentBone', {
      components: { bone: { kind: 'bone', length: 100 } },
    })
    const child1 = engine.createNode(slide.scene.id, slide.scene.root.id, 'Child1', {
      components: { bone: { kind: 'bone', length: 30 } },
    })
    const child2 = engine.createNode(slide.scene.id, slide.scene.root.id, 'Child2', {
      components: { bone: { kind: 'bone', length: 30 } },
    })
    await waitForTree('Slide 1')
    // First reparent with Snap + Remember
    {
      const parentRow = screen.getByRole('treeitem', { name: 'ParentBone' })
      const childRow = screen.getByRole('treeitem', { name: 'Child1' })
      mockRowRect(parentRow)
      const dt = startDrag(childRow)
      hoverZone(parentRow, 'into', dt)
      dropOn(parentRow, 'into', dt)
      const dialog = await screen.findByRole('dialog', { name: 'Parenting mode' })
      await user.click(within(dialog).getByRole('radio', { name: /Snap to Parent Tail/ }))
      await user.click(within(dialog).getByLabelText('Remember my choice'))
      await user.click(within(dialog).getByRole('button', { name: 'Confirm' }))
      await waitFor(() => expect(engine.getNode(child1.id).parent?.id).toBe(parent.id))
      expect(useParentingModeStore.getState().rememberChoice).toBe(true)
      expect(useParentingModeStore.getState().mode).toBe('snapToTail')
      // banner should appear
      expect(screen.getByText(/Parenting: Snap to Tail/)).toBeInTheDocument()
    }
    // Second reparent should auto-apply remembered Snap without dialog
    {
      const parentRow = screen.getByRole('treeitem', { name: 'ParentBone' })
      const childRow = screen.getByRole('treeitem', { name: 'Child2' })
      mockRowRect(parentRow)
      const dt = startDrag(childRow)
      hoverZone(parentRow, 'into', dt)
      dropOn(parentRow, 'into', dt)
      // No dialog should appear, directly reparented
      await waitFor(() => expect(engine.getNode(child2.id).parent?.id).toBe(parent.id))
      expect(screen.queryByRole('dialog', { name: 'Parenting mode' })).not.toBeInTheDocument()
      const t = engine.getNode(child2.id).transform
      expect(t.x).toBeCloseTo(100, 5)
    }
    // Reset should clear remembered choice
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(useParentingModeStore.getState().rememberChoice).toBe(false)
    expect(screen.queryByText(/Parenting: Snap to Tail/)).not.toBeInTheDocument()
    // Next reparent should show dialog again
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Child3', {
      components: { bone: { kind: 'bone', length: 30 } },
    })
    await waitForTree('Slide 1') // tree updates
    const parentRow2 = screen.getByRole('treeitem', { name: 'ParentBone' })
    const child3Row = await screen.findByRole('treeitem', { name: 'Child3' })
    mockRowRect(parentRow2)
    const dt2 = startDrag(child3Row)
    hoverZone(parentRow2, 'into', dt2)
    dropOn(parentRow2, 'into', dt2)
    expect(await screen.findByRole('dialog', { name: 'Parenting mode' })).toBeInTheDocument()
  })

  it('Undo groups whole reparent as one Transaction', async () => {
    const user = userEvent.setup()
    const { engine, undoStack } = renderPanel()
    const slide = createProjectAndSlide(engine)
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    const a = engine.createNode(slide.scene.id, slide.scene.root.id, 'A')
    const b = engine.createNode(slide.scene.id, slide.scene.root.id, 'B')
    useSelectionStore.getState().selectMany([a.id, b.id])
    await waitForTree('Slide 1')
    const parentRow = screen.getByRole('treeitem', { name: 'Parent' })
    const aRow = screen.getByRole('treeitem', { name: 'A' })
    mockRowRect(parentRow)
    const dt = startDrag(aRow) // drags whole selection (A,B) because A is selected and selection includes B
    hoverZone(parentRow, 'into', dt)
    dropOn(parentRow, 'into', dt)
    const dialog = await screen.findByRole('dialog', { name: 'Parenting mode' })
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(engine.getNode(a.id).parent?.id).toBe(parent.id))
    expect(engine.getNode(b.id).parent?.id).toBe(parent.id)
    const txCount = undoStack.entries.filter((e) => e.type === 'Transaction').length
    expect(txCount).toBe(1)
    // undo should revert both
    const dispatcher = new CommandDispatcher(engine as unknown as Engine, undoStack)
    dispatcher.undo()
    expect(engine.getNode(a.id).parent?.id).toBe(slide.scene.root.id)
    expect(engine.getNode(b.id).parent?.id).toBe(slide.scene.root.id)
  })
})
