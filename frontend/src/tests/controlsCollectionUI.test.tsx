import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { AnimationManagerModal } from '../components/panels/AnimationManagerModal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import type { Engine } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { CreateClipCommand } from '../engine/commands'
import { createControl, createControlSet, groupCollectionBlocks } from '../engine/control'
import { useSelectionStore } from '../stores/selectionStore'
import { useMissingAssetsStore } from '../stores/missingAssetsStore'
import { useParentingModeStore } from '../stores/parentingModeStore'
import { useTimelineViewStore } from '../stores/timelineViewStore'
import { noopPersistence } from './contextHarness'

function renderManager(engine: Engine, undoStack: UndoStack, parentNodeId: string | null) {
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: (c) => dispatcher.dispatch(c),
    persistence: noopPersistence,
  }
  const onClose = () => {}
  return render(
    <EngineContext.Provider value={value}>
      <AnimationManagerModal
        open={parentNodeId !== null}
        parentNodeId={parentNodeId}
        onClose={onClose}
      />
    </EngineContext.Provider>,
  )
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  useMissingAssetsStore.setState({ report: null, dialogVisible: false } as never)
  useParentingModeStore.getState().reset()
  useTimelineViewStore.setState({ zoomLevel: 1, scrollTime: 0 })
})

describe('Controls tab — live-linked collection blocks', () => {
  it('attaches a collection via Add Block and renders one grouped row', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const host = engine.createNode(slide.scene.id, slide.scene.root.id, 'Host')
    const child = engine.createNode(slide.scene.id, host.id, 'Child')
    child.semanticName = 'mouth'
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    const clipRes = dispatcher.dispatch(
      new CreateClipCommand({
        name: 'Mouth Clip',
        duration: 1,
        category: 'control',
        params: [],
        channels: [{ property: 'positionX' }],
      }),
    )
    const clipId = clipRes.ok
      ? (clipRes.inverse as unknown as { clipId: string }).clipId
      : engine.clips[0]!.id
    const collection = engine.createClipCollection('Rig', { mouth: clipId })
    host.controlSet = createControlSet(host.id, [createControl({ key: 'Open', exposed: true })])

    const user = userEvent.setup()
    renderManager(engine, undo, host.id)
    const modal = await screen.findByTestId('animation-manager-modal')
    await user.click(within(modal).getByTestId('manager-tab-controls'))

    // Open Add Block on the first timeline and switch to collection mode
    await user.click(within(modal).getByTestId('manager-control-add-block-here-Open-0'))
    const dialog = await screen.findByTestId('control-add-block-dialog-Open')
    fireEvent.change(within(dialog).getByTestId('control-add-block-kind-Open'), {
      target: { value: 'collection' },
    })
    fireEvent.change(within(dialog).getByTestId('control-add-block-collection-Open'), {
      target: { value: collection.id },
    })
    await user.click(within(dialog).getByTestId('control-add-block-confirm-Open'))

    // One grouped row appears below the (empty) clip rows
    const row = await screen.findByTestId('collection-block-inline-Open-g0-0')
    expect(row).toBeInTheDocument()
    expect(row.getAttribute('data-collection')).toBe(collection.id)
    // Engine state holds a live link, not an expanded copy
    const control = engine.getNode(host.id).controlSet!.controls[0]!
    expect(groupCollectionBlocks(control.groups[0])).toHaveLength(1)
    expect(Object.keys(control.groups[0]!.bindings)).toHaveLength(0)

    // Detach via the row × button
    await user.click(within(row).getByTestId('collection-block-unbind-inline-Open-g0-0'))
    expect(
      groupCollectionBlocks(engine.getNode(host.id).controlSet!.controls[0]!.groups[0]),
    ).toHaveLength(0)
  })

  it('surfaces a missing collection instead of crashing', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const host = engine.createNode(slide.scene.id, slide.scene.root.id, 'Host')
    const child = engine.createNode(slide.scene.id, host.id, 'Child')
    child.semanticName = 'mouth'
    // Hand-wire a dangling block (collection deleted out from under the control)
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    const clipRes = dispatcher.dispatch(
      new CreateClipCommand({
        name: 'Mouth Clip',
        duration: 1,
        category: 'control',
        params: [],
        channels: [{ property: 'positionX' }],
      }),
    )
    const clipId = clipRes.ok
      ? (clipRes.inverse as unknown as { clipId: string }).clipId
      : engine.clips[0]!.id
    const collection = engine.createClipCollection('Rig', { mouth: clipId })
    let set = createControlSet(host.id, [createControl({ key: 'Open', exposed: true })])
    const { addCollectionBlockToGroup } = await import('../engine/control')
    set = addCollectionBlockToGroup(set, 'Open', set.controls[0]!.groups[0]!.id, {
      collectionId: collection.id,
    })
    host.controlSet = set
    engine.deleteClipCollection(collection.id)

    const user = userEvent.setup()
    renderManager(engine, undo, host.id)
    const modal = await screen.findByTestId('animation-manager-modal')
    await user.click(within(modal).getByTestId('manager-tab-controls'))
    const row = await screen.findByTestId('collection-block-inline-Open-g0-0')
    expect(row.title).toMatch(/missing/)
  })
})
