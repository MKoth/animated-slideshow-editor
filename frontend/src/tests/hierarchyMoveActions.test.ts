import { beforeEach, describe, expect, it } from 'vitest'
import type { DispatchCommand } from '../engine/commands'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  CommandDispatcher,
  UndoStack,
} from '../engine/commands'
import { createEngine } from '../engine/internal'
import type { EngineEvent } from '../engine/events'
import { identityTransform } from '../engine/transform'
import { applyHierarchyMove } from '../app/hierarchyMoveActions'
import { useSelectionStore } from '../stores/selectionStore'

interface Mounted {
  dispatch: DispatchCommand
  undoStack: UndoStack
  engine: ReturnType<typeof createEngine>
  sceneId: string
  rootId: string
}

function mount(): Mounted {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack)
  dispatcher.dispatch(new CreateProjectCommand({ name: 'P' }))
  dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' }))
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  return {
    dispatch: (command) => dispatcher.dispatch(command),
    undoStack,
    engine,
    sceneId: slide.scene.id,
    rootId: slide.scene.root.id,
  }
}

function place(harness: Mounted, parentId: string, name: string): string {
  const result = harness.dispatch(
    new CreateNodeCommand({ sceneId: harness.sceneId, parentId, name }),
  )
  if (!result.ok) {
    throw new Error(`place failed: ${result.error.message}`)
  }
  return result.inverse.nodeId
}

function siblingNames(engine: ReturnType<typeof createEngine>, parentId: string): string[] {
  return engine.getNode(parentId).children.map((node) => node.name)
}

function transactionEntries(harness: Mounted) {
  return harness.undoStack.entries
    .filter((entry) => entry.type === 'Transaction')
    .reverse() // undo stack is newest-first
    .map((entry) => ({ type: entry.type, parameters: entry.parameters, inverse: entry.inverse }))
}

function collectEvents(harness: Mounted): EngineEvent[] {
  const events: EngineEvent[] = []
  harness.engine.subscribe((event) => events.push(event))
  return events
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
})

describe('applyHierarchyMove', () => {
  it('reorders a single node before a sibling as one transaction with inverse data', () => {
    const harness = mount()
    const a = place(harness, harness.rootId, 'A')
    const b = place(harness, harness.rootId, 'B')
    const c = place(harness, harness.rootId, 'C')
    const d = place(harness, harness.rootId, 'D')
    const events = collectEvents(harness)

    applyHierarchyMove(harness.engine, harness.dispatch, {
      targets: [c],
      parentId: harness.rootId,
      index: 1,
    })

    expect(siblingNames(harness.engine, harness.rootId)).toEqual(['Camera', 'C', 'A', 'B', 'D'])
    const entries = transactionEntries(harness)
    expect(entries).toHaveLength(1)
    expect(entries[0].parameters).toEqual({
      commands: [{ type: 'ReorderNode', nodeId: c, index: 1 }],
    })
    const child = (entries[0].inverse as { children: unknown[] }).children
    expect(child).toEqual([
      {
        type: 'ReorderNode',
        parameters: { nodeId: c, index: 1 },
        inverse: { nodeId: c, parentId: harness.rootId, oldIndex: 3 },
      },
    ])
    expect(events).toEqual([{ type: 'NodeOrderChanged', nodeId: c }])
    expect(harness.undoStack.entries.filter((entry) => entry.type === 'Transaction')).toHaveLength(
      1,
    )
    expect([a, b, d].map((id) => harness.engine.getNode(id).parent?.id)).toEqual([
      harness.rootId,
      harness.rootId,
      harness.rootId,
    ])
  })

  it('moves a multi-selection to a sibling slot preserving relative order in one transaction', () => {
    const harness = mount()
    const a = place(harness, harness.rootId, 'A')
    place(harness, harness.rootId, 'B')
    const c = place(harness, harness.rootId, 'C')
    place(harness, harness.rootId, 'D')
    const events = collectEvents(harness)

    applyHierarchyMove(harness.engine, harness.dispatch, {
      targets: [c, a],
      parentId: harness.rootId,
      // drop before D: D's reduced slot is 2
      index: 2,
    })

    expect(siblingNames(harness.engine, harness.rootId)).toEqual(['Camera', 'B', 'A', 'C', 'D'])
    const entries = transactionEntries(harness)
    expect(entries).toHaveLength(1)
    expect(entries[0].parameters).toEqual({
      commands: [{ type: 'ReorderNode', nodeId: a, index: 2 }],
    })
    expect(events).toEqual([{ type: 'NodeOrderChanged', nodeId: a }])
    expect(harness.undoStack.entries.filter((entry) => entry.type === 'Transaction')).toHaveLength(
      1,
    )
  })

  it('moves a multi-selection into a parent at an exact slot as one transaction', () => {
    const harness = mount()
    const a = place(harness, harness.rootId, 'A')
    const b = place(harness, harness.rootId, 'B')
    const p = place(harness, harness.rootId, 'P')
    place(harness, p, 'X')
    place(harness, p, 'Y')
    const events = collectEvents(harness)

    applyHierarchyMove(harness.engine, harness.dispatch, {
      targets: [a, b],
      parentId: p,
      index: 1,
    })

    expect(siblingNames(harness.engine, p)).toEqual(['X', 'A', 'B', 'Y'])
    expect(siblingNames(harness.engine, harness.rootId)).toEqual(['Camera', 'P'])
    const entries = transactionEntries(harness)
    expect(entries).toHaveLength(1)
    expect(entries[0].parameters).toEqual({
      commands: [
        { type: 'ReparentNode', nodeId: b, parentId: p, index: 1 },
        { type: 'ReparentNode', nodeId: a, parentId: p, index: 1 },
      ],
    })
    expect(events).toEqual([
      { type: 'NodeReparented', nodeId: b },
      { type: 'NodeOrderChanged', nodeId: b },
      { type: 'NodeReparented', nodeId: a },
      { type: 'NodeOrderChanged', nodeId: a },
    ])
    expect(harness.undoStack.entries.filter((entry) => entry.type === 'Transaction')).toHaveLength(
      1,
    )
  })

  it('combines same-parent reorders and cross-parent reparents in one drag', () => {
    const harness = mount()
    const a = place(harness, harness.rootId, 'A')
    place(harness, harness.rootId, 'B')
    const c = place(harness, harness.rootId, 'C')
    const p = place(harness, harness.rootId, 'P')
    place(harness, p, 'X')
    place(harness, p, 'Y')

    // select A (root child) and C (root child), drop into P before Y
    applyHierarchyMove(harness.engine, harness.dispatch, {
      targets: [a, c],
      parentId: p,
      index: 1,
    })

    expect(siblingNames(harness.engine, p)).toEqual(['X', 'A', 'C', 'Y'])
    expect(siblingNames(harness.engine, harness.rootId)).toEqual(['Camera', 'B', 'P'])
    expect(harness.undoStack.entries.filter((entry) => entry.type === 'Transaction')).toHaveLength(
      1,
    )
  })

  it('reparents a single node into an exact slot and records inverse data', () => {
    const harness = mount()
    const a = place(harness, harness.rootId, 'A')
    place(harness, harness.rootId, 'B')
    const p = place(harness, harness.rootId, 'P')
    place(harness, p, 'X')
    place(harness, p, 'Y')
    const events = collectEvents(harness)

    applyHierarchyMove(harness.engine, harness.dispatch, {
      targets: [a],
      parentId: p,
      index: 1,
    })

    expect(siblingNames(harness.engine, p)).toEqual(['X', 'A', 'Y'])
    const entries = transactionEntries(harness)
    expect(entries).toHaveLength(1)
    const child = (entries[0].inverse as { children: unknown[] }).children
    expect(child).toEqual([
      {
        type: 'ReparentNode',
        parameters: { nodeId: a, parentId: p, index: 1 },
        inverse: {
          nodeId: a,
          oldParentId: harness.rootId,
          oldTransform: identityTransform(),
        },
      },
    ])
    expect(events).toEqual([
      { type: 'NodeReparented', nodeId: a },
      { type: 'NodeOrderChanged', nodeId: a },
    ])
  })

  it('records nothing when the drop is a no-op', () => {
    const harness = mount()
    const a = place(harness, harness.rootId, 'A')
    const b = place(harness, harness.rootId, 'B')
    const c = place(harness, harness.rootId, 'C')
    const d = place(harness, harness.rootId, 'D')
    const events = collectEvents(harness)
    const undoCount = harness.undoStack.entries.length

    // B is already right after A: dropping B on the bottom half of A changes nothing
    applyHierarchyMove(harness.engine, harness.dispatch, {
      targets: [b],
      parentId: harness.rootId,
      index: 2,
    })

    expect(siblingNames(harness.engine, harness.rootId)).toEqual(['Camera', 'A', 'B', 'C', 'D'])
    expect(harness.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
    expect([a, c, d].map((id) => harness.engine.getNode(id).name)).toEqual(['A', 'C', 'D'])
  })

  it('keeps the remaining same-parent members while moving a single selection row', () => {
    const harness = mount()
    place(harness, harness.rootId, 'A')
    const b = place(harness, harness.rootId, 'B')
    place(harness, harness.rootId, 'C')
    place(harness, harness.rootId, 'D')

    // drop B onto the bottom half of D (append after D)
    applyHierarchyMove(harness.engine, harness.dispatch, {
      targets: [b],
      parentId: harness.rootId,
      index: 4,
    })

    expect(siblingNames(harness.engine, harness.rootId)).toEqual(['Camera', 'A', 'C', 'D', 'B'])
  })

  it('moves a whole subtree when a parent is dragged', () => {
    const harness = mount()
    const a = place(harness, harness.rootId, 'A')
    const a1 = place(harness, a, 'A1')
    const a2 = place(harness, a, 'A2')
    const b = place(harness, harness.rootId, 'B')

    applyHierarchyMove(harness.engine, harness.dispatch, {
      targets: [a, a1, a2],
      parentId: b,
      index: 0,
    })

    expect(siblingNames(harness.engine, b)).toEqual(['A'])
    expect(siblingNames(harness.engine, a)).toEqual(['A1', 'A2'])
    expect(siblingNames(harness.engine, harness.rootId)).toEqual(['Camera', 'B'])
    expect(harness.undoStack.entries.filter((entry) => entry.type === 'Transaction')).toHaveLength(
      1,
    )
  })

  it('rejects a drop into a descendant of the dragged node without changing anything', () => {
    const harness = mount()
    const a = place(harness, harness.rootId, 'A')
    const a1 = place(harness, a, 'A1')
    const a2 = place(harness, a1, 'A2')
    const undoCount = harness.undoStack.entries.length

    applyHierarchyMove(harness.engine, harness.dispatch, {
      targets: [a],
      parentId: a2,
      index: 0,
    })

    expect(siblingNames(harness.engine, harness.rootId)).toEqual(['Camera', 'A'])
    expect(siblingNames(harness.engine, a)).toEqual(['A1'])
    expect(harness.undoStack.entries).toHaveLength(undoCount)
  })

  it('ignores targets from other slides and moves only same-scene nodes', () => {
    const harness = mount()
    const a = place(harness, harness.rootId, 'A')
    place(harness, harness.rootId, 'B')
    const second = harness.engine.createSlide('S2')
    const x = harness.engine.createNode(second.scene.id, second.scene.root.id, 'X')

    applyHierarchyMove(harness.engine, harness.dispatch, {
      targets: [a, x.id],
      parentId: harness.rootId,
      index: 2,
    })

    expect(siblingNames(harness.engine, harness.rootId)).toEqual(['Camera', 'B', 'A'])
    expect(siblingNames(harness.engine, second.scene.root.id)).toEqual(['Camera', 'X'])
    expect(harness.undoStack.entries.filter((entry) => entry.type === 'Transaction')).toHaveLength(
      1,
    )
  })

  it('ignores the root and camera in the selection and moves the rest', () => {
    const harness = mount()
    place(harness, harness.rootId, 'A')
    const b = place(harness, harness.rootId, 'B')
    const c = place(harness, harness.rootId, 'C')

    applyHierarchyMove(harness.engine, harness.dispatch, {
      targets: [harness.rootId, b, c],
      parentId: harness.rootId,
      index: 1,
    })

    expect(siblingNames(harness.engine, harness.rootId)).toEqual(['Camera', 'B', 'C', 'A'])
    expect(harness.undoStack.entries.filter((entry) => entry.type === 'Transaction')).toHaveLength(
      1,
    )
  })

  it('appends above-level nodes after the camera when dropping onto the root', () => {
    const harness = mount()
    place(harness, harness.rootId, 'A')
    const p = place(harness, harness.rootId, 'P')
    const x = place(harness, p, 'X')

    applyHierarchyMove(harness.engine, harness.dispatch, {
      targets: [x],
      parentId: harness.rootId,
      index: 3,
    })

    expect(siblingNames(harness.engine, harness.rootId)).toEqual(['Camera', 'A', 'P', 'X'])
    expect(siblingNames(harness.engine, p)).toEqual([])
  })

  it('never lets a reorder displace the camera', () => {
    const harness = mount()
    place(harness, harness.rootId, 'A')
    const b = place(harness, harness.rootId, 'B')

    applyHierarchyMove(harness.engine, harness.dispatch, {
      targets: [b],
      parentId: harness.rootId,
      index: 1,
    })

    expect(siblingNames(harness.engine, harness.rootId)).toEqual(['Camera', 'B', 'A'])
    const entries = transactionEntries(harness)
    expect(entries[0].parameters).toEqual({
      commands: [{ type: 'ReorderNode', nodeId: b, index: 1 }],
    })
  })
})
