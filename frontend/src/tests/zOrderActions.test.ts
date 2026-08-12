import { beforeEach, describe, expect, it } from 'vitest'
import type { DispatchCommand } from '../engine/commands'
import {
  CreateAssetInstanceCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  CommandDispatcher,
  UndoStack,
} from '../engine/commands'
import { createEngine } from '../engine/internal'
import { applyZOrder, canApplyZOrder } from '../app/zOrderActions'
import { useSelectionStore } from '../stores/selectionStore'

interface Harness {
  dispatch: DispatchCommand
  undoStack: UndoStack
  engine: ReturnType<typeof createEngine>
  sceneId: string
  rootId: string
  cameraId: string
  definitionId: string
}

function mount(): Harness {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack)
  dispatcher.dispatch(new CreateProjectCommand({ name: 'P' }))
  dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' }))
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const definition = engine.defineAsset('Boy')
  return {
    dispatch: (command) => dispatcher.dispatch(command),
    undoStack,
    engine,
    sceneId: slide.scene.id,
    rootId: slide.scene.root.id,
    cameraId: slide.scene.camera.id,
    definitionId: definition.id,
  }
}

function place(harness: Harness, name: string): string {
  const result = harness.dispatch(
    new CreateAssetInstanceCommand({
      sceneId: harness.sceneId,
      parentId: harness.rootId,
      definitionId: harness.definitionId,
      name,
      position: { x: 0, y: 0 },
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    }),
  )
  if (!result.ok) {
    throw new Error(`place failed: ${result.error.message}`)
  }
  return result.inverse.nodeId
}

function placeFour(harness: Harness): Record<'A' | 'B' | 'C' | 'D', string> {
  return {
    A: place(harness, 'A'),
    B: place(harness, 'B'),
    C: place(harness, 'C'),
    D: place(harness, 'D'),
  }
}

function siblingNames(harness: Harness): string[] {
  const slide = harness.engine.project?.slides[0]
  if (!slide) {
    return []
  }
  return slide.scene.root.children
    .filter((node) => !node.components.camera)
    .map((node) => node.name)
}

function select(...ids: string[]): void {
  useSelectionStore.getState().selectMany(ids)
}

function zOrderEntries(harness: Harness): { type: string; parameters: Record<string, unknown> }[] {
  return harness.undoStack.entries
    .filter((entry) => entry.type === 'ChangeZOrder')
    .reverse() // undo stack is newest-first
    .map((entry) => ({ type: entry.type, parameters: { ...entry.parameters } }))
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
})

describe('applyZOrder', () => {
  it('is a no-op with no selection', () => {
    const harness = mount()
    const before = harness.undoStack.entries.length

    applyZOrder(harness.engine, harness.dispatch, 'bringForward')

    expect(harness.undoStack.entries).toHaveLength(before)
  })

  it.each([
    ['bringForward', 'A', ['B', 'A', 'C', 'D']],
    ['sendBackward', 'D', ['A', 'B', 'D', 'C']],
    ['bringToFront', 'A', ['B', 'C', 'D', 'A']],
    ['sendToBack', 'D', ['D', 'A', 'B', 'C']],
  ])('%s reorders a single selected node and records one command', (mode, nodeName, expected) => {
    const harness = mount()
    const ids = Object.fromEntries(['A', 'B', 'C', 'D'].map((name) => [name, place(harness, name)]))
    select(ids[nodeName])

    applyZOrder(harness.engine, harness.dispatch, mode as 'bringForward')

    expect(siblingNames(harness)).toEqual(expected)
    expect(zOrderEntries(harness)).toEqual([
      {
        type: 'ChangeZOrder',
        parameters: { nodeId: ids[nodeName], mode },
      },
    ])
  })

  it('brings a multi-selection to the front preserving relative order, one command per node', () => {
    const harness = mount()
    const { A, C } = placeFour(harness)
    select(A, C)

    applyZOrder(harness.engine, harness.dispatch, 'bringToFront')

    expect(siblingNames(harness)).toEqual(['B', 'D', 'A', 'C'])
    const entries = zOrderEntries(harness)
    expect(entries).toHaveLength(2)
    expect(entries.map((entry) => entry.parameters.nodeId)).toEqual([A, C])
    expect(harness.engine.getNode(C).parent?.children.map((node) => node.name)).toEqual([
      'Camera',
      'B',
      'D',
      'A',
      'C',
    ])
  })

  it('sends a multi-selection to the back preserving relative order, one command per node', () => {
    const harness = mount()
    const { A, C } = placeFour(harness)
    select(A, C)

    applyZOrder(harness.engine, harness.dispatch, 'sendToBack')

    expect(siblingNames(harness)).toEqual(['A', 'C', 'B', 'D'])
    const entries = zOrderEntries(harness)
    expect(entries.map((entry) => entry.parameters.nodeId)).toEqual([C, A])
  })

  it('ignores the selection order and processes extremes in scene order', () => {
    const harness = mount()
    const { A, C } = placeFour(harness)
    select(C, A)

    applyZOrder(harness.engine, harness.dispatch, 'bringToFront')

    expect(siblingNames(harness)).toEqual(['B', 'D', 'A', 'C'])
    expect(zOrderEntries(harness).map((entry) => entry.parameters.nodeId)).toEqual([A, C])
    expect(harness.engine.getNode(A).parent?.children.map((node) => node.name)).toEqual([
      'Camera',
      'B',
      'D',
      'A',
      'C',
    ])
  })

  it('brings adjacent selected nodes forward without undoing each other', () => {
    const harness = mount()
    const { A, B } = placeFour(harness)
    select(A, B)

    applyZOrder(harness.engine, harness.dispatch, 'bringForward')

    expect(siblingNames(harness)).toEqual(['C', 'A', 'B', 'D'])
    expect(zOrderEntries(harness).map((entry) => entry.parameters.nodeId)).toEqual([B, A])
  })

  it('sends adjacent selected nodes backward without undoing each other', () => {
    const harness = mount()
    const { C, D } = placeFour(harness)
    select(C, D)

    applyZOrder(harness.engine, harness.dispatch, 'sendBackward')

    expect(siblingNames(harness)).toEqual(['A', 'C', 'D', 'B'])
    expect(zOrderEntries(harness).map((entry) => entry.parameters.nodeId)).toEqual([C, D])
  })

  it('skips selected nodes that cannot move and records nothing for them', () => {
    const harness = mount()
    const { D } = placeFour(harness)
    select(D)

    applyZOrder(harness.engine, harness.dispatch, 'bringToFront')

    expect(siblingNames(harness)).toEqual(['A', 'B', 'C', 'D'])
    expect(zOrderEntries(harness)).toEqual([])
  })

  it('ignores non-reorderable selected nodes like the root and keeps moving the rest', () => {
    const harness = mount()
    const { A } = placeFour(harness)
    select(harness.rootId, A)

    applyZOrder(harness.engine, harness.dispatch, 'bringToFront')

    expect(siblingNames(harness)).toEqual(['B', 'C', 'D', 'A'])
    expect(zOrderEntries(harness)).toHaveLength(1)
    expect(zOrderEntries(harness)[0].parameters.nodeId).toBe(A)
  })
})

describe('canApplyZOrder', () => {
  it('is false with no selection', () => {
    const harness = mount()

    expect(canApplyZOrder(harness.engine, 'bringForward')).toBe(false)
  })

  it('is true when any selected node can move and false when none can', () => {
    const harness = mount()
    const { A, B, D } = placeFour(harness)

    select(D)
    expect(canApplyZOrder(harness.engine, 'bringForward')).toBe(false)
    expect(canApplyZOrder(harness.engine, 'bringToFront')).toBe(false)
    expect(canApplyZOrder(harness.engine, 'sendBackward')).toBe(true)
    expect(canApplyZOrder(harness.engine, 'sendToBack')).toBe(true)

    select(A)
    expect(canApplyZOrder(harness.engine, 'sendToBack')).toBe(false)
    expect(canApplyZOrder(harness.engine, 'bringForward')).toBe(true)

    select(B, D)
    expect(canApplyZOrder(harness.engine, 'bringToFront')).toBe(true)
    expect(canApplyZOrder(harness.engine, 'sendToBack')).toBe(true)

    select(A)
    expect(canApplyZOrder(harness.engine, 'sendBackward')).toBe(false)
    expect(canApplyZOrder(harness.engine, 'bringToFront')).toBe(true)
  })

  it('is false when only the root or a camera is selected', () => {
    const harness = mount()
    const a = place(harness, 'A')
    const b = place(harness, 'B')

    select(harness.rootId)
    expect(canApplyZOrder(harness.engine, 'bringToFront')).toBe(false)

    select(harness.cameraId, a)
    expect(canApplyZOrder(harness.engine, 'bringToFront')).toBe(true)

    select(harness.cameraId, b)
    expect(canApplyZOrder(harness.engine, 'sendToBack')).toBe(true)
    expect(canApplyZOrder(harness.engine, 'bringToFront')).toBe(false)
  })
})
