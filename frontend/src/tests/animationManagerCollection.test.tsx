import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { AnimationManagerModal } from '../components/panels/AnimationManagerModal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import type { Engine } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import {
  AddKeyframeCommand,
  CreateClipCommand,
  AssignClipCommand,
  ApplyClipCollectionCommand,
  SetSemanticNameCommand,
} from '../engine/commands'
import { useSelectionStore } from '../stores/selectionStore'
import { useMissingAssetsStore } from '../stores/missingAssetsStore'
import { useParentingModeStore } from '../stores/parentingModeStore'
import { noopPersistence } from './contextHarness'

function renderManager(
  engine: Engine,
  undo: UndoStack,
  parentNodeId: string | null,
  onClose = () => {},
) {
  const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack: undo,
    dispatch: (c) => dispatcher.dispatch(c),
    persistence: noopPersistence,
  }
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
})

describe('Animation Manager 15-05 – Clip Collection grouping', () => {
  it('multi-select Clip Lanes → Create Collection yields subset-pointed ClipCollection with sourceNodeId', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'RigRoot')
    engine.setSemanticName(parent.id, 'rig_root')
    const child1 = engine.createNode(slide.scene.id, parent.id, 'LeftHand')
    engine.setSemanticName(child1.id, 'left_hand')
    const child2 = engine.createNode(slide.scene.id, parent.id, 'RightHand')
    engine.setSemanticName(child2.id, 'right_hand')
    const child3 = engine.createNode(slide.scene.id, parent.id, 'Foot')
    engine.setSemanticName(child3.id, 'foot')
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    const clip1Res = dispatcher.dispatch(
      new CreateClipCommand({
        name: 'Wave',
        duration: 7,
        category: '',
        params: [],
        channels: [{ property: 'positionX' }],
      }),
    )
    const clip2Res = dispatcher.dispatch(
      new CreateClipCommand({
        name: 'Shake',
        duration: 7,
        category: '',
        params: [],
        channels: [{ property: 'positionX' }],
      }),
    )
    const clip3Res = dispatcher.dispatch(
      new CreateClipCommand({
        name: 'Kick',
        duration: 7,
        category: '',
        params: [],
        channels: [{ property: 'positionX' }],
      }),
    )
    const clip1Id = (clip1Res as { ok: true; inverse: { clipId: string } }).inverse.clipId
    const clip2Id = (clip2Res as { ok: true; inverse: { clipId: string } }).inverse.clipId
    const clip3Id = (clip3Res as { ok: true; inverse: { clipId: string } }).inverse.clipId
    dispatcher.dispatch(new AssignClipCommand({ nodeId: child1.id, clipId: clip1Id }))
    dispatcher.dispatch(new AssignClipCommand({ nodeId: child2.id, clipId: clip2Id }))
    dispatcher.dispatch(new AssignClipCommand({ nodeId: child3.id, clipId: clip3Id }))
    // Ensure no orphans – no keyframes at node level
    const user = userEvent.setup()
    renderManager(engine, undo, parent.id)
    const modal = await screen.findByTestId('animation-manager-modal')
    // Should be on Clips tab default
    expect(await screen.findByTestId('manager-tab-clips')).toHaveAttribute('aria-selected', 'true')
    // Find lanes
    const lane1 = within(modal).getByTestId(`clip-lane-${child1.id}-${child1.clipInstances[0]!.id}`)
    const lane2 = within(modal).getByTestId(`clip-lane-${child2.id}-${child2.clipInstances[0]!.id}`)
    const lane3 = within(modal).getByTestId(`clip-lane-${child3.id}-${child3.clipInstances[0]!.id}`)
    // Ctrl+click lane1 and lane2 (multi-select)
    fireEvent.click(lane1, { ctrlKey: true })
    fireEvent.click(lane2, { ctrlKey: true })
    expect(await screen.findByTestId('clip-selected-count')).toHaveTextContent('2 selected')
    // lane1 and lane2 should be data-multiselected true
    expect(lane1).toHaveAttribute('data-multiselected', 'true')
    expect(lane2).toHaveAttribute('data-multiselected', 'true')
    expect(lane3).toHaveAttribute('data-multiselected', 'false')
    // Create Collection button should be enabled (no orphans, semantics present)
    const createBtn = within(modal).getByTestId('manager-create-collection')
    expect(createBtn).toBeEnabled()
    await user.click(createBtn)
    const createModal = await screen.findByTestId('create-collection-modal')
    expect(createModal).toBeInTheDocument()
    // Preview should show 2 bindings (left_hand, right_hand) not foot
    expect(
      within(createModal).getByTestId('create-collection-bindings-preview'),
    ).toBeInTheDocument()
    expect(within(createModal).getByText('left_hand')).toBeInTheDocument()
    expect(within(createModal).getByText('right_hand')).toBeInTheDocument()
    expect(within(createModal).queryByText('foot')).not.toBeInTheDocument()
    const nameInput = within(createModal).getByTestId(
      'create-collection-name-input',
    ) as HTMLInputElement
    // name auto-filled
    expect(nameInput.value).toContain('RigRoot')
    await user.clear(nameInput)
    await user.type(nameInput, 'MySubset')
    const confirm = within(createModal).getByTestId('create-collection-confirm')
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    // Modal should close
    expect(screen.queryByTestId('create-collection-modal')).not.toBeInTheDocument()
    // Verify collection created with sourceNodeId and subset bindings
    const collections = engine.clipCollections.filter((c) => c.sourceNodeId === parent.id)
    expect(collections).toHaveLength(1)
    const col = collections[0]!
    expect(col.name).toBe('MySubset')
    expect(col.sourceNodeId).toBe(parent.id)
    expect(col.getBinding('left_hand')).toBe(clip1Id)
    expect(col.getBinding('right_hand')).toBe(clip2Id)
    expect(col.hasBinding('foot')).toBe(false)
  })

  it('shared clipIds across collections are allowed', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    const childA = engine.createNode(slide.scene.id, parent.id, 'A')
    engine.setSemanticName(childA.id, 'left_hand')
    const childB = engine.createNode(slide.scene.id, parent.id, 'B')
    engine.setSemanticName(childB.id, 'right_hand')
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    const clipRes = dispatcher.dispatch(
      new CreateClipCommand({
        name: 'SharedClip',
        duration: 5,
        category: '',
        params: [],
        channels: [{ property: 'positionX' }],
      }),
    )
    const clipId = (clipRes as { ok: true; inverse: { clipId: string } }).inverse.clipId
    dispatcher.dispatch(new AssignClipCommand({ nodeId: childA.id, clipId }))
    dispatcher.dispatch(new AssignClipCommand({ nodeId: childB.id, clipId }))
    const user = userEvent.setup()
    renderManager(engine, undo, parent.id)
    const modal = await screen.findByTestId('animation-manager-modal')
    const laneA = within(modal).getByTestId(`clip-lane-${childA.id}-${childA.clipInstances[0]!.id}`)
    const laneB = within(modal).getByTestId(`clip-lane-${childB.id}-${childB.clipInstances[0]!.id}`)
    // First collection: select both
    fireEvent.click(laneA, { ctrlKey: true })
    fireEvent.click(laneB, { ctrlKey: true })
    await user.click(within(modal).getByTestId('manager-create-collection'))
    let createModal = await screen.findByTestId('create-collection-modal')
    let input = within(createModal).getByTestId('create-collection-name-input')
    await user.clear(input)
    await user.type(input, 'Col1')
    await user.click(within(createModal).getByTestId('create-collection-confirm'))
    expect(screen.queryByTestId('create-collection-modal')).not.toBeInTheDocument()
    // Second collection: same selection, different name, same shared clipId
    await user.click(within(modal).getByTestId('manager-create-collection'))
    createModal = await screen.findByTestId('create-collection-modal')
    input = within(createModal).getByTestId('create-collection-name-input')
    await user.clear(input)
    await user.type(input, 'Col2')
    await user.click(within(createModal).getByTestId('create-collection-confirm'))
    const cols = engine.clipCollections.filter((c) => c.sourceNodeId === parent.id)
    expect(cols).toHaveLength(2)
    expect(cols[0]!.getBinding('left_hand')).toBe(clipId)
    expect(cols[0]!.getBinding('right_hand')).toBe(clipId)
    expect(cols[1]!.getBinding('left_hand')).toBe(clipId)
    expect(cols[1]!.getBinding('right_hand')).toBe(clipId)
  })

  it('continuous validation banners: orphan blocks Create and is clickable', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    const child = engine.createNode(slide.scene.id, parent.id, 'Child')
    engine.setSemanticName(child.id, 'hand')
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    const clipRes = dispatcher.dispatch(
      new CreateClipCommand({
        name: 'C',
        duration: 7,
        category: '',
        params: [],
        channels: [{ property: 'positionX' }],
      }),
    )
    const clipId = (clipRes as { ok: true; inverse: { clipId: string } }).inverse.clipId
    dispatcher.dispatch(new AssignClipCommand({ nodeId: child.id, clipId }))
    // Add orphan keyframe on child (visible track, not clipped)
    dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'visible', nodeId: child.id },
        time: 1,
        value: false,
      }),
    )
    renderManager(engine, undo, parent.id)
    const modal = await screen.findByTestId('animation-manager-modal')
    // Orphan banner should be visible continuously (even on clips tab)
    const orphanBanner = await screen.findByTestId('collection-orphan-error')
    expect(orphanBanner).toBeInTheDocument()
    expect(orphanBanner).toHaveTextContent('orphan')
    // Clip lane should be visible but Create should be blocked
    const lane = within(modal).getByTestId(`clip-lane-${child.id}-${child.clipInstances[0]!.id}`)
    fireEvent.click(lane, { ctrlKey: true })
    const createBtn = within(modal).getByTestId('manager-create-collection')
    // Create button disabled due to orphan
    expect(createBtn).toBeDisabled()
    // Clicking the orphan node button should navigate to orphans tab and select node
    const orphanBtn = within(orphanBanner).getByTestId(`orphan-node-${child.id}`)
    await userEvent.setup().click(orphanBtn)
    expect(within(modal).getByTestId('manager-tab-orphans')).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(useSelectionStore.getState().selectedIds).toContain(child.id)
  })

  it('missing semanticName blocks Create and clickable navigates to node', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    const childNoSem = engine.createNode(slide.scene.id, parent.id, 'NoSem')
    // deliberately leave semanticName empty
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    const clipRes = dispatcher.dispatch(
      new CreateClipCommand({
        name: 'C',
        duration: 7,
        category: '',
        params: [],
        channels: [{ property: 'positionX' }],
      }),
    )
    const clipId = (clipRes as { ok: true; inverse: { clipId: string } }).inverse.clipId
    dispatcher.dispatch(new AssignClipCommand({ nodeId: childNoSem.id, clipId }))
    renderManager(engine, undo, parent.id)
    const modal = await screen.findByTestId('animation-manager-modal')
    const lane = within(modal).getByTestId(
      `clip-lane-${childNoSem.id}-${childNoSem.clipInstances[0]!.id}`,
    )
    fireEvent.click(lane, { ctrlKey: true })
    // Missing semantic banner should appear after selection
    const missingBanner = await screen.findByTestId('collection-missing-semantic')
    expect(missingBanner).toBeInTheDocument()
    expect(missingBanner).toHaveTextContent('Semantic Name')
    const createBtn = within(modal).getByTestId('manager-create-collection')
    expect(createBtn).toBeDisabled()
    // Clicking fix navigates
    const fixBtn = within(missingBanner).getByTestId(`missing-semantic-${childNoSem.id}`)
    await userEvent.setup().click(fixBtn)
    expect(useSelectionStore.getState().selectedIds).toContain(childNoSem.id)
    // Create modal also should block when opened via direct click? Try to open create (should still show blocking)
    // The manager create button is disabled, but we can attempt to call handleCreateCollection via button disabled prevents opening.
    // Ensure create modal if forced open via click on disabled should not open; we simulate opening via direct state? Instead verify banner in create modal blocks too
    // Select valid node after fixing semanticName then try again
    dispatcher.dispatch(
      new SetSemanticNameCommand({ nodeId: childNoSem.id, semanticName: 'hand_fixed' }),
    )
    // Wait for rerender (engine event triggers tick)
    await waitFor(() =>
      expect(screen.queryByTestId('collection-missing-semantic')).not.toBeInTheDocument(),
    )
    // need to refetch create button after rerender
    expect(await screen.findByTestId('manager-create-collection')).toBeEnabled()
  })

  it('editable in place: add/remove bindings updates collection definition', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    const child1 = engine.createNode(slide.scene.id, parent.id, 'A')
    engine.setSemanticName(child1.id, 'a_sem')
    const child2 = engine.createNode(slide.scene.id, parent.id, 'B')
    engine.setSemanticName(child2.id, 'b_sem')
    const child3 = engine.createNode(slide.scene.id, parent.id, 'C')
    engine.setSemanticName(child3.id, 'c_sem')
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    const clip1 = (
      dispatcher.dispatch(
        new CreateClipCommand({
          name: 'C1',
          duration: 7,
          category: '',
          params: [],
          channels: [{ property: 'positionX' }],
        }),
      ) as { ok: true; inverse: { clipId: string } }
    ).inverse.clipId
    const clip2 = (
      dispatcher.dispatch(
        new CreateClipCommand({
          name: 'C2',
          duration: 7,
          category: '',
          params: [],
          channels: [{ property: 'positionX' }],
        }),
      ) as { ok: true; inverse: { clipId: string } }
    ).inverse.clipId
    const clip3 = (
      dispatcher.dispatch(
        new CreateClipCommand({
          name: 'C3',
          duration: 7,
          category: '',
          params: [],
          channels: [{ property: 'positionX' }],
        }),
      ) as { ok: true; inverse: { clipId: string } }
    ).inverse.clipId
    dispatcher.dispatch(new AssignClipCommand({ nodeId: child1.id, clipId: clip1 }))
    dispatcher.dispatch(new AssignClipCommand({ nodeId: child2.id, clipId: clip2 }))
    dispatcher.dispatch(new AssignClipCommand({ nodeId: child3.id, clipId: clip3 }))
    renderManager(engine, undo, parent.id)
    const modal = await screen.findByTestId('animation-manager-modal')
    const lane1 = within(modal).getByTestId(`clip-lane-${child1.id}-${child1.clipInstances[0]!.id}`)
    const lane2 = within(modal).getByTestId(`clip-lane-${child2.id}-${child2.clipInstances[0]!.id}`)
    const user = userEvent.setup()
    // Create collection with A and B
    fireEvent.click(lane1, { ctrlKey: true })
    fireEvent.click(lane2, { ctrlKey: true })
    await user.click(within(modal).getByTestId('manager-create-collection'))
    const createModal = await screen.findByTestId('create-collection-modal')
    const input = within(createModal).getByTestId('create-collection-name-input')
    await user.clear(input)
    await user.type(input, 'EditableCol')
    await user.click(within(createModal).getByTestId('create-collection-confirm'))
    expect(screen.queryByTestId('create-collection-modal')).not.toBeInTheDocument()
    let col = engine.clipCollections.find((c) => c.name === 'EditableCol')!
    expect(col).toBeDefined()
    expect(col.getBinding('a_sem')).toBe(clip1)
    expect(col.getBinding('b_sem')).toBe(clip2)
    expect(col.hasBinding('c_sem')).toBe(false)
    // Switch to Collections tab
    await user.click(within(modal).getByTestId('manager-tab-collections'))
    const colEl = await screen.findByTestId(`manager-collection-${col.id}`)
    expect(colEl).toBeInTheDocument()
    expect(within(colEl).getByTestId(`collection-binding-${col.id}-a_sem`)).toBeInTheDocument()
    // Edit: add c_sem, remove a_sem
    await user.click(within(colEl).getByTestId(`collection-edit-${col.id}`))
    const editModal = await screen.findByTestId('edit-collection-modal')
    expect(editModal).toBeInTheDocument()
    // Remove a_sem
    await user.click(within(editModal).getByTestId('edit-binding-remove-a_sem'))
    // Add c_sem via AddBindingRow
    const semInput = within(editModal).getByTestId('add-binding-semantic-input')
    const clipSelect = within(editModal).getByTestId('add-binding-clip-select')
    await user.type(semInput, 'c_sem')
    await user.selectOptions(clipSelect, clip3)
    await user.click(within(editModal).getByTestId('add-binding-confirm'))
    // Save
    await user.click(within(editModal).getByTestId('edit-collection-confirm'))
    expect(screen.queryByTestId('edit-collection-modal')).not.toBeInTheDocument()
    col = engine.getClipCollection(col.id)
    expect(col.hasBinding('a_sem')).toBe(false)
    expect(col.getBinding('b_sem')).toBe(clip2)
    expect(col.getBinding('c_sem')).toBe(clip3)
  })

  it('delete removes only collection definition; already-placed Collection Lanes remain as plain ClipInstances', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    const child1 = engine.createNode(slide.scene.id, parent.id, 'Child1')
    engine.setSemanticName(child1.id, 'hand')
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    const clipId = (
      dispatcher.dispatch(
        new CreateClipCommand({
          name: 'C',
          duration: 7,
          category: '',
          params: [],
          channels: [{ property: 'positionX' }],
        }),
      ) as { ok: true; inverse: { clipId: string } }
    ).inverse.clipId
    dispatcher.dispatch(new AssignClipCommand({ nodeId: child1.id, clipId: clipId }))
    // Create collection via dispatch directly (subset)
    const collection = engine.createClipCollection('ToDelete', { hand: clipId }, parent.id)
    const colId = collection.id
    // Apply collection to a new target hierarchy (creates ClipInstances)
    const targetParent = engine.createNode(slide.scene.id, slide.scene.root.id, 'TargetParent')
    const targetChild = engine.createNode(slide.scene.id, targetParent.id, 'TargetHand')
    engine.setSemanticName(targetChild.id, 'hand')
    dispatcher.dispatch(
      new ApplyClipCollectionCommand({ collectionId: colId, targetNodeId: targetParent.id }),
    )
    expect(targetChild.clipInstances).toHaveLength(1)
    expect(targetChild.clipInstances[0]!.clipId).toBe(clipId)
    // Render manager and delete via UI
    const user = userEvent.setup()
    renderManager(engine, undo, parent.id)
    const modal = await screen.findByTestId('animation-manager-modal')
    await user.click(within(modal).getByTestId('manager-tab-collections'))
    const colEl = await screen.findByTestId(`manager-collection-${colId}`)
    await user.click(within(colEl).getByTestId(`collection-delete-${colId}`))
    const confirmModal = await screen.findByTestId('delete-collection-modal')
    await user.click(within(confirmModal).getByTestId('delete-collection-confirm'))
    // Collection should be gone
    expect(() => engine.getClipCollection(colId)).toThrow()
    // But placed lane remains as plain ClipInstance
    expect(targetChild.clipInstances).toHaveLength(1)
    expect(targetChild.clipInstances[0]!.clipId).toBe(clipId)
    // Manager still shows child1 lane (since clipInstances still there)
    await user.click(within(modal).getByTestId('manager-tab-clips'))
    expect(
      within(modal).getByTestId(`clip-lane-${child1.id}-${child1.clipInstances[0]!.id}`),
    ).toBeInTheDocument()
    // Also collections empty
    await user.click(within(modal).getByTestId('manager-tab-collections'))
    expect(screen.queryByTestId(`manager-collection-${colId}`)).not.toBeInTheDocument()
  })

  it('no second-level nesting: creating collection from collection-derived clips does not create nested collections', async () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent')
    const child = engine.createNode(slide.scene.id, parent.id, 'Child')
    engine.setSemanticName(child.id, 'hand')
    const dispatcher = new CommandDispatcher(engine, undo, () => undefined)
    const clipId = (
      dispatcher.dispatch(
        new CreateClipCommand({
          name: 'C',
          duration: 7,
          category: '',
          params: [],
          channels: [{ property: 'positionX' }],
        }),
      ) as { ok: true; inverse: { clipId: string } }
    ).inverse.clipId
    dispatcher.dispatch(new AssignClipCommand({ nodeId: child.id, clipId }))
    // Create first collection
    const col1 = engine.createClipCollection('Col1', { hand: clipId }, parent.id)
    // Apply it somewhere, then try to create second collection that references same clip – should succeed and not nest
    const targetParent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Target')
    const targetChild = engine.createNode(slide.scene.id, targetParent.id, 'Thand')
    engine.setSemanticName(targetChild.id, 'hand')
    dispatcher.dispatch(
      new ApplyClipCollectionCommand({ collectionId: col1.id, targetNodeId: targetParent.id }),
    )
    // Now targetChild has clip instance same clipId
    renderManager(engine, undo, parent.id)
    const modal = await screen.findByTestId('animation-manager-modal')
    const lane = within(modal).getByTestId(`clip-lane-${child.id}-${child.clipInstances[0]!.id}`)
    fireEvent.click(lane, { ctrlKey: true })
    const user = userEvent.setup()
    await user.click(within(modal).getByTestId('manager-create-collection'))
    const createModal = await screen.findByTestId('create-collection-modal')
    const input = within(createModal).getByTestId('create-collection-name-input')
    await user.clear(input)
    await user.type(input, 'Col2')
    await user.click(within(createModal).getByTestId('create-collection-confirm'))
    const cols = engine.clipCollections
    expect(cols).toHaveLength(2)
    // Both are flat, no nesting reference
    expect(cols[0]!.bindings.size).toBe(1)
    expect(cols[1]!.bindings.size).toBe(1)
    // Ensure no collection references another collectionId
    for (const c of cols) {
      for (const v of c.bindings.values()) {
        expect(() => engine.getClip(v)).not.toThrow()
      }
    }
  })
})
