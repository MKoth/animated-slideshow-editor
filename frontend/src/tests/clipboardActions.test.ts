import { beforeEach, describe, expect, it } from 'vitest'
import type { DispatchCommand } from '../engine/commands'
import {
  CreateAssetInstanceCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  CommandDispatcher,
  UndoStack,
} from '../engine/commands'
import { createEngine } from '../engine/internal'
import {
  copySelection,
  deleteSelection,
  duplicateSelection,
  pasteClipboard,
} from '../app/clipboardActions'
import { useClipboardStore } from '../stores/clipboardStore'
import { useSelectionStore } from '../stores/selectionStore'

interface Harness {
  dispatch: DispatchCommand
  dispatcher: CommandDispatcher
  undoStack: UndoStack
  engine: ReturnType<typeof createEngine>
  sceneId: string
  rootId: string
  definitionId: string
  cameraId: string
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
    dispatcher,
    undoStack,
    engine,
    sceneId: slide.scene.id,
    rootId: slide.scene.root.id,
    definitionId: definition.id,
    cameraId: slide.scene.camera.id,
  }
}

function place(harness: Harness, name: string, x: number, y: number): string {
  const { nodeId } = expectOk(
    harness.dispatch(
      new CreateAssetInstanceCommand({
        sceneId: harness.sceneId,
        parentId: harness.rootId,
        definitionId: harness.definitionId,
        name,
        position: { x, y },
        rotation: 0.25,
        scaleX: 1.5,
        scaleY: 1,
      }),
    ),
  )
  return nodeId
}

function expectOk<T>(result: { ok: boolean; inverse?: T; error?: Error }): T {
  if (!result.ok) {
    throw new Error(`expected success, got: ${result.error?.message ?? 'unknown error'}`)
  }
  return result.inverse as T
}

function walkNames(harness: Harness): string[] {
  if (!harness.engine.project) {
    return []
  }
  return harness.engine.project.slides[0].scene.root.children
    .filter((node) => !node.components.camera && node.components.assetInstance)
    .map((node) => node.name)
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  useClipboardStore.setState({ items: [] })
})

describe('copySelection', () => {
  it('is a no-op with no selection, leaving the clipboard empty', () => {
    const harness = mount()

    copySelection(harness.engine)

    expect(useClipboardStore.getState().items).toEqual([])
  })

  it('snapshots every selected asset instance in selection order with definition, transform, and placement info', () => {
    const harness = mount()
    const a = place(harness, 'Boy', 10, 20)
    const b = place(harness, 'Cat', 30, 40)
    useSelectionStore.getState().selectMany([b, a])

    copySelection(harness.engine)

    expect(useClipboardStore.getState().items).toEqual([
      {
        definitionId: harness.definitionId,
        sceneId: harness.sceneId,
        parentId: harness.rootId,
        name: 'Cat',
        transform: { x: 30, y: 40, rotation: 0.25, scaleX: 1.5, scaleY: 1 },
      },
      {
        definitionId: harness.definitionId,
        sceneId: harness.sceneId,
        parentId: harness.rootId,
        name: 'Boy',
        transform: { x: 10, y: 20, rotation: 0.25, scaleX: 1.5, scaleY: 1 },
      },
    ])
  })

  it('ignores selected nodes that are not asset instances', () => {
    const harness = mount()
    const boy = place(harness, 'Boy', 10, 20)
    const folder = expectOk(
      harness.dispatch(
        new CreateNodeCommand({
          sceneId: harness.sceneId,
          parentId: harness.rootId,
          name: 'Folder',
        }),
      ),
    )
    useSelectionStore.getState().selectMany([folder.nodeId, boy])

    copySelection(harness.engine)

    expect(useClipboardStore.getState().items).toHaveLength(1)
    expect(useClipboardStore.getState().items[0].name).toBe('Boy')
  })
})

describe('pasteClipboard', () => {
  it('is a no-op with an empty clipboard', () => {
    const harness = mount()
    const before = harness.undoStack.entries.length

    pasteClipboard(harness.dispatch)

    expect(harness.undoStack.entries).toHaveLength(before)
    expect(useSelectionStore.getState().selectedIds).toEqual([])
  })

  it('pastes the whole multi-item clipboard with new ids, the same definition and transform, and suffixed names, one command per item', () => {
    const harness = mount()
    const a = place(harness, 'Boy', 10, 20)
    const b = place(harness, 'Cat', 30, 40)
    useSelectionStore.getState().selectMany([a, b])
    copySelection(harness.engine)
    const before = harness.undoStack.entries.length

    pasteClipboard(harness.dispatch)

    const created = useSelectionStore.getState().selectedIds
    expect(created).toHaveLength(2)
    expect(created[0]).not.toBe(a)
    expect(created[1]).not.toBe(b)
    expect(created[0]).not.toBe(created[1])

    const boy = harness.engine.getNode(created[0])
    const cat = harness.engine.getNode(created[1])
    expect(boy.name).toBe('Boy (2)')
    expect(cat.name).toBe('Cat (2)')
    expect(boy.transform).toEqual({ x: 30, y: 40, rotation: 0.25, scaleX: 1.5, scaleY: 1 })
    expect(cat.transform).toEqual({ x: 50, y: 60, rotation: 0.25, scaleX: 1.5, scaleY: 1 })
    expect(boy.components.assetInstance?.assetDefinitionId).toBe(harness.definitionId)
    expect(cat.components.assetInstance?.assetDefinitionId).toBe(harness.definitionId)

    const entries = harness.undoStack.entries.slice(0, harness.undoStack.entries.length - before)
    expect(entries).toHaveLength(2)
    expect(entries.map((entry) => entry.type)).toEqual([
      'CreateAssetInstance',
      'CreateAssetInstance',
    ])
  })

  it('selects the pasted items, replacing the previous selection', () => {
    const harness = mount()
    const a = place(harness, 'Boy', 10, 20)
    useSelectionStore.getState().select(a)
    copySelection(harness.engine)

    pasteClipboard(harness.dispatch)

    expect(useSelectionStore.getState().selectedIds).toHaveLength(1)
    expect(useSelectionStore.getState().selectedIds[0]).not.toBe(a)
  })

  it('keeps naming uniqueness across repeated pastes', () => {
    const harness = mount()
    const a = place(harness, 'Boy', 0, 0)
    const b = place(harness, 'Boy', 100, 100)
    useSelectionStore.getState().selectMany([a, b])
    copySelection(harness.engine)

    pasteClipboard(harness.dispatch)
    expect(walkNames(harness)).toEqual(['Boy', 'Boy (2)', 'Boy (3)', 'Boy (4)'])

    pasteClipboard(harness.dispatch)
    expect(walkNames(harness)).toEqual([
      'Boy',
      'Boy (2)',
      'Boy (3)',
      'Boy (4)',
      'Boy (5)',
      'Boy (6)',
    ])
  })
})

describe('duplicateSelection', () => {
  it('is a no-op with no selection', () => {
    const harness = mount()
    const before = harness.undoStack.entries.length

    duplicateSelection(harness.engine, harness.dispatch)

    expect(harness.undoStack.entries).toHaveLength(before)
    expect(useSelectionStore.getState().selectedIds).toEqual([])
  })

  it('duplicates every selected asset instance with a +20/+20 offset, new ids, and unique names, one command per item', () => {
    const harness = mount()
    const a = place(harness, 'Boy', 10, 20)
    const b = place(harness, 'Cat', 30, 40)
    useSelectionStore.getState().selectMany([a, b])
    const before = harness.undoStack.entries.length

    duplicateSelection(harness.engine, harness.dispatch)

    const created = useSelectionStore.getState().selectedIds
    expect(created).toHaveLength(2)
    expect(created[0]).not.toBe(a)
    expect(created[1]).not.toBe(b)

    expect(harness.engine.getNode(created[0]).name).toBe('Boy (2)')
    expect(harness.engine.getNode(created[0]).transform.x).toBe(30)
    expect(harness.engine.getNode(created[0]).transform.y).toBe(40)
    expect(harness.engine.getNode(created[1]).name).toBe('Cat (2)')
    expect(harness.engine.getNode(created[1]).transform.x).toBe(50)
    expect(harness.engine.getNode(created[1]).transform.y).toBe(60)

    const entries = harness.undoStack.entries.slice(0, harness.undoStack.entries.length - before)
    expect(entries.map((entry) => entry.type)).toEqual(['DuplicateNode', 'DuplicateNode'])
  })

  it('keeps naming uniqueness across repeated duplicates of the same node', () => {
    const harness = mount()
    const a = place(harness, 'Boy', 0, 0)
    useSelectionStore.getState().select(a)

    duplicateSelection(harness.engine, harness.dispatch)
    duplicateSelection(harness.engine, harness.dispatch)
    duplicateSelection(harness.engine, harness.dispatch)

    expect(walkNames(harness)).toEqual(['Boy', 'Boy (2)', 'Boy (3)', 'Boy (4)'])
  })

  it('skips selected nodes that are not asset instances', () => {
    const harness = mount()
    const a = place(harness, 'Boy', 0, 0)
    const folder = expectOk(
      harness.dispatch(
        new CreateNodeCommand({
          sceneId: harness.sceneId,
          parentId: harness.rootId,
          name: 'Folder',
        }),
      ),
    )
    useSelectionStore.getState().selectMany([a, folder.nodeId])
    const before = harness.undoStack.entries.length

    duplicateSelection(harness.engine, harness.dispatch)

    expect(harness.undoStack.entries).toHaveLength(before + 1)
    expect(harness.undoStack.entries[0].type).toBe('DuplicateNode')
    expect(useSelectionStore.getState().selectedIds).toHaveLength(1)
    expect(walkNames(harness)).toEqual(['Boy', 'Boy (2)'])
  })
})

describe('deleteSelection', () => {
  it('is a no-op with no selection', () => {
    const harness = mount()
    const before = harness.undoStack.entries.length

    deleteSelection(harness.engine, harness.dispatch)

    expect(harness.undoStack.entries).toHaveLength(before)
    expect(walkNames(harness)).toEqual([])
  })

  it('deletes every selected node and prunes them from the selection', () => {
    const harness = mount()
    const a = place(harness, 'Boy', 0, 0)
    const b = place(harness, 'Cat', 0, 0)
    useSelectionStore.getState().selectMany([a, b])

    deleteSelection(harness.engine, harness.dispatch)

    expect(walkNames(harness)).toEqual([])
    expect(useSelectionStore.getState().selectedIds).toEqual([])
    expect(harness.undoStack.entries.slice(0, 2).map((entry) => entry.type)).toEqual([
      'DeleteNode',
      'DeleteNode',
    ])
  })

  it('cannot delete the root or the camera, and leaves them in place', () => {
    const harness = mount()
    const boy = place(harness, 'Boy', 0, 0)
    useSelectionStore.getState().selectMany([harness.rootId, harness.cameraId, boy])

    deleteSelection(harness.engine, harness.dispatch)

    expect(harness.engine.getNode(harness.rootId).name).toBe('Root')
    expect(harness.engine.getNode(harness.cameraId).components.camera).toBeDefined()
    expect(harness.engine.project?.slides[0].scene.camera.id).toBe(harness.cameraId)
    expect(walkNames(harness)).toEqual([])
    expect(harness.undoStack.entries[0].type).toBe('DeleteNode')
    expect(harness.undoStack.entries.filter((entry) => entry.type === 'DeleteNode')).toHaveLength(1)
  })
})
