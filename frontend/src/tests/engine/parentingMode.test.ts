import { beforeEach, describe, expect, it } from 'vitest'
import {
  CommandDispatcher,
  CreateProjectCommand,
  CreateSlideCommand,
  ReparentNodeCommand,
  UndoStack,
} from '../../engine/commands'
import { createEngineInternal, toReadOnly } from '../../engine/internal'
import { worldTransformOf } from '../../engine/worldTransform'
import { useParentingModeStore } from '../../stores/parentingModeStore'
import { applyHierarchyMove } from '../../app/hierarchyMoveActions'

function setup() {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack)
  const dispatch = (c: never) => dispatcher.dispatch(c as never)
  dispatcher.dispatch(new CreateProjectCommand({ name: 'P' }))
  dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' }))
  const slide = engine.project!.slides[0]
  return {
    engine: toReadOnly(engine) as unknown as ReturnType<typeof createEngineInternal>,
    raw: engine,
    slide,
    undoStack,
    dispatch,
    dispatcher,
  }
}

beforeEach(() => {
  useParentingModeStore.getState().reset()
})

describe('ParentingMode Store', () => {
  it('defaults to keepWorld without remember', () => {
    const s = useParentingModeStore.getState()
    expect(s.mode).toBe('keepWorld')
    expect(s.rememberChoice).toBe(false)
  })
  it('persists choice for session and is resettable', () => {
    const store = useParentingModeStore.getState()
    store.setMode('snapToTail')
    store.setRememberChoice(true)
    expect(useParentingModeStore.getState().mode).toBe('snapToTail')
    expect(useParentingModeStore.getState().rememberChoice).toBe(true)
    useParentingModeStore.getState().reset()
    expect(useParentingModeStore.getState().mode).toBe('keepWorld')
    expect(useParentingModeStore.getState().rememberChoice).toBe(false)
  })
})

describe('ReparentNodeCommand parenting modes', () => {
  it('Keep World recomputes local to preserve world position of dragged root + chain', () => {
    const { raw, slide, dispatcher } = setup()
    const parent = raw.createNode(slide.scene.id, slide.scene.root.id, 'Parent', {
      transform: { x: 50, y: 50, rotation: 0, scaleX: 1, scaleY: 1 },
      components: { bone: { kind: 'bone', length: 100 } },
    })
    const child = raw.createNode(slide.scene.id, slide.scene.root.id, 'Child', {
      transform: { x: 10, y: 20, rotation: 0.2, scaleX: 1, scaleY: 1 },
      components: { bone: { kind: 'bone', length: 80 } },
    })
    const grandchild = raw.createNode(slide.scene.id, child.id, 'Grandchild', {
      transform: { x: 5, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    const childWorldBefore = worldTransformOf(slide.scene, child.id)!
    const grandchildWorldBefore = worldTransformOf(slide.scene, grandchild.id)!
    // reparent child under parent with Keep World (default)
    const result = dispatcher.dispatch(
      new ReparentNodeCommand({ nodeId: child.id, parentId: parent.id }),
    )
    expect(result.ok).toBe(true)
    const childWorldAfter = worldTransformOf(slide.scene, child.id)!
    const grandchildWorldAfter = worldTransformOf(slide.scene, grandchild.id)!
    expect(childWorldAfter.x).toBeCloseTo(childWorldBefore.x, 5)
    expect(childWorldAfter.y).toBeCloseTo(childWorldBefore.y, 5)
    expect(childWorldAfter.rotation).toBeCloseTo(childWorldBefore.rotation, 5)
    // grandchild follows rigidly: its world should be offset by same amount as child's world delta (which is zero)
    expect(grandchildWorldAfter.x).toBeCloseTo(grandchildWorldBefore.x, 5)
    expect(grandchildWorldAfter.y).toBeCloseTo(grandchildWorldBefore.y, 5)
    // local of child should have been recomputed, not snapped to parent tail
    expect(raw.getNode(child.id).transform.x).not.toBeCloseTo(100, 5)
  })

  it('Snap to Tail resets child local to parent tail', () => {
    const { raw, slide, dispatcher } = setup()
    const parent = raw.createNode(slide.scene.id, slide.scene.root.id, 'ParentBone', {
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      components: { bone: { kind: 'bone', length: 120 } },
    })
    const child = raw.createNode(slide.scene.id, slide.scene.root.id, 'ChildBone', {
      transform: { x: 50, y: 50, rotation: 0.5, scaleX: 2, scaleY: 2 },
      components: { bone: { kind: 'bone', length: 50 } },
    })
    const grandchild = raw.createNode(slide.scene.id, child.id, 'Grandchild', {
      transform: { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    dispatcher.dispatch(
      new ReparentNodeCommand({
        nodeId: child.id,
        parentId: parent.id,
        parentingMode: 'snapToTail',
      }),
    )
    const childNode = raw.getNode(child.id)
    expect(childNode.transform.x).toBeCloseTo(120, 5)
    expect(childNode.transform.y).toBeCloseTo(0, 5)
    expect(childNode.transform.rotation).toBeCloseTo(0, 5)
    expect(childNode.transform.scaleX).toBeCloseTo(1, 5)
    // grandchild follows rigidly: its local unchanged, world moves with child
    const grandchildNode = raw.getNode(grandchild.id)
    expect(grandchildNode.transform.x).toBe(10)
    expect(grandchildNode.transform.y).toBe(0)
    // world of grandchild should be child world + grandchild local (since no rotation)
    const childWorld = worldTransformOf(slide.scene, child.id)!
    const grandchildWorld = worldTransformOf(slide.scene, grandchild.id)!
    expect(grandchildWorld.x).toBeCloseTo(childWorld.x + 10, 5)
  })

  it('Snap to Tail for non-bone parent resets to 0,0', () => {
    const { raw, slide, dispatcher } = setup()
    const parent = raw.createNode(slide.scene.id, slide.scene.root.id, 'ParentGroup', {
      transform: { x: 30, y: 40, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    const child = raw.createNode(slide.scene.id, slide.scene.root.id, 'Child', {
      transform: { x: 100, y: 100, rotation: 1, scaleX: 2, scaleY: 2 },
    })
    dispatcher.dispatch(
      new ReparentNodeCommand({
        nodeId: child.id,
        parentId: parent.id,
        parentingMode: 'snapToTail',
      }),
    )
    const t = raw.getNode(child.id).transform
    expect(t.x).toBe(0)
    expect(t.y).toBe(0)
    expect(t.rotation).toBe(0)
    expect(t.scaleX).toBe(1)
    expect(t.scaleY).toBe(1)
  })

  it('undo groups whole reparent as one Transaction via applyHierarchyMove', () => {
    const { raw, slide, undoStack, dispatch } = setup()
    const parent = raw.createNode(slide.scene.id, slide.scene.root.id, 'Parent', {
      components: { bone: { kind: 'bone', length: 100 } },
    })
    const a = raw.createNode(slide.scene.id, slide.scene.root.id, 'A', {
      transform: { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    const b = raw.createNode(slide.scene.id, slide.scene.root.id, 'B', {
      transform: { x: 20, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    const aWorldBefore = worldTransformOf(slide.scene, a.id)!
    // dispatcher for hierarchyMove
    const enginePublic = toReadOnly(raw)
    // use keepWorld
    applyHierarchyMove(
      enginePublic,
      dispatch as never,
      { targets: [a.id, b.id], parentId: parent.id, index: 0 },
      'keepWorld',
    )
    // should be one Transaction entry
    const txEntries = undoStack.entries.filter((e) => e.type === 'Transaction')
    expect(txEntries).toHaveLength(1)
    expect(txEntries[0].parameters).toMatchObject({ commands: expect.any(Array) })
    // world of A should be preserved (keepWorld)
    const aWorldAfter = worldTransformOf(slide.scene, a.id)!
    expect(aWorldAfter.x).toBeCloseTo(aWorldBefore.x, 5)
    // undo should revert both
    const dispatcher = new CommandDispatcher(raw, undoStack)
    dispatcher.undo()
    expect(raw.getNode(a.id).parent?.id).toBe(slide.scene.root.id)
    expect(raw.getNode(b.id).parent?.id).toBe(slide.scene.root.id)
    // redo should reapply with keepWorld preserved
    dispatcher.redo()
    expect(raw.getNode(a.id).parent?.id).toBe(parent.id)
    const aWorldRedo = worldTransformOf(slide.scene, a.id)!
    expect(aWorldRedo.x).toBeCloseTo(aWorldBefore.x, 5)
  })

  it('snap mode via hierarchyMove applies snap to each dragged root', () => {
    const { raw, slide, dispatch } = setup()
    const parent = raw.createNode(slide.scene.id, slide.scene.root.id, 'ParentBone', {
      components: { bone: { kind: 'bone', length: 90 } },
    })
    const a = raw.createNode(slide.scene.id, slide.scene.root.id, 'A', {
      transform: { x: 5, y: 5, rotation: 0, scaleX: 1, scaleY: 1 },
      components: { bone: { kind: 'bone', length: 30 } },
    })
    const childOfA = raw.createNode(slide.scene.id, a.id, 'A_child', {
      transform: { x: 7, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    const enginePublic = toReadOnly(raw)
    applyHierarchyMove(
      enginePublic,
      dispatch as never,
      { targets: [a.id], parentId: parent.id, index: 0 },
      'snapToTail',
    )
    expect(raw.getNode(a.id).transform.x).toBeCloseTo(90, 5)
    // descendant local unchanged
    expect(raw.getNode(childOfA.id).transform.x).toBe(7)
    // world of descendant should be parent tail + child snap + descendant offset
    const aWorld = worldTransformOf(slide.scene, a.id)!
    const childWorld = worldTransformOf(slide.scene, childOfA.id)!
    expect(childWorld.x).toBeCloseTo(aWorld.x + 7, 5)
  })
})
