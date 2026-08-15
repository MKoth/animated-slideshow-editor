import { describe, expect, it, vi } from 'vitest'
import type { EngineEvent } from '../../engine/events'
import type { CommandLogger, CommandResult } from '../../engine/commands'
import {
  AssignMaterialCommand,
  CommandDispatcher,
  CreateAssetInstanceCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  DuplicateNodeCommand,
  OverrideMaterialParameterCommand,
  UndoStack,
} from '../../engine/commands'
import { createEngine } from '../../engine/internal'

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function setup(log?: CommandLogger) {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, log)
  expectOk(dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const definition = engine.defineAsset('Boy')
  const { nodeId } = expectOk(
    dispatcher.dispatch(
      new CreateAssetInstanceCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        definitionId: definition.id,
        name: 'Boy',
        position: { x: 12, y: 34 },
        rotation: 0.5,
        scaleX: 2,
        scaleY: 3,
      }),
    ),
  )
  return { engine, undoStack, dispatcher, slide, definition, nodeId }
}

function collectEvents(engine: ReturnType<typeof createEngine>): EngineEvent[] {
  const events: EngineEvent[] = []
  engine.subscribe((event) => events.push(event))
  return events
}

describe('DuplicateNodeCommand', () => {
  it('duplicates an asset instance with a new id, the same definition, an offset transform, a unique name, and the same parent', () => {
    const log = vi.fn()
    const { engine, undoStack, dispatcher, slide, definition, nodeId } = setup(log)
    const events = collectEvents(engine)
    const before = undoStack.entries.length

    const inverse = expectOk(dispatcher.dispatch(new DuplicateNodeCommand({ nodeId })))

    const copy = engine.getNode(inverse.nodeId)
    expect(inverse).toEqual({ nodeId: expect.any(String) })
    expect(copy.id).not.toBe(nodeId)
    expect(copy.components.assetInstance).toEqual({
      kind: 'assetInstance',
      assetDefinitionId: definition.id,
    })
    expect(copy.transform).toEqual({ x: 32, y: 54, rotation: 0.5, scaleX: 2, scaleY: 3 })
    expect(copy.name).toBe('Boy (2)')
    expect(copy.parent?.id).toBe(slide.scene.root.id)
    expect(slide.scene.root.children).toContain(engine.getNode(copy.id))
    expect(events).toEqual([{ type: 'NodeCreated', nodeId: copy.id }])
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0]).toMatchObject({
      type: 'DuplicateNode',
      parameters: { nodeId },
      inverse,
    })
    expect(log).toHaveBeenCalledWith(`DuplicateNode nodeId=${nodeId}`)
  })

  it('keeps suffixing names on repeated duplicates: Boy (2), Boy (3), ...', () => {
    const { engine, dispatcher, nodeId } = setup()

    const two = expectOk(dispatcher.dispatch(new DuplicateNodeCommand({ nodeId })))
    const three = expectOk(dispatcher.dispatch(new DuplicateNodeCommand({ nodeId })))
    const four = expectOk(dispatcher.dispatch(new DuplicateNodeCommand({ nodeId })))

    expect(engine.getNode(two.nodeId).name).toBe('Boy (2)')
    expect(engine.getNode(three.nodeId).name).toBe('Boy (3)')
    expect(engine.getNode(four.nodeId).name).toBe('Boy (4)')
  })

  it('offsets every duplicate by +20/+20 from its source', () => {
    const { engine, dispatcher, nodeId } = setup()
    const source = engine.getNode(nodeId)

    const two = expectOk(dispatcher.dispatch(new DuplicateNodeCommand({ nodeId })))
    const three = expectOk(dispatcher.dispatch(new DuplicateNodeCommand({ nodeId })))

    expect(engine.getNode(two.nodeId).transform.x).toBe(source.transform.x + 20)
    expect(engine.getNode(two.nodeId).transform.y).toBe(source.transform.y + 20)
    expect(engine.getNode(three.nodeId).transform.x).toBe(source.transform.x + 20)
    expect(engine.getNode(three.nodeId).transform.y).toBe(source.transform.y + 20)
  })

  it('copies the material instance with its overrides', () => {
    const { engine, undoStack, dispatcher, nodeId } = setup()
    engine.registerMaterialDefinition('mat-1', 'Warm')
    expectOk(
      dispatcher.dispatch(new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-1' })),
    )
    expectOk(
      dispatcher.dispatch(
        new OverrideMaterialParameterCommand({ nodeId, parameter: 'tint', value: '#00ff00' }),
      ),
    )
    const before = undoStack.entries.length

    const inverse = expectOk(dispatcher.dispatch(new DuplicateNodeCommand({ nodeId })))

    const source = engine.getNode(nodeId)
    const copy = engine.getNode(inverse.nodeId)
    expect(copy.material).toEqual({ materialDefinitionId: 'mat-1', overrides: { tint: '#00ff00' } })
    expect(copy.material).not.toBe(source.material)
    expect(copy.material.overrides).not.toBe(source.material.overrides)
    expect(undoStack.entries).toHaveLength(before + 1)
  })

  it('rejects a node without an asset instance, leaving the engine unchanged', () => {
    const { engine, undoStack, dispatcher, slide } = setup()
    const { nodeId } = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Folder',
        }),
      ),
    )
    const events = collectEvents(engine)
    const before = undoStack.entries.length

    const result = dispatcher.dispatch(new DuplicateNodeCommand({ nodeId }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/asset instance/i)
    }
    expect(undoStack.entries).toHaveLength(before)
    expect(events).toEqual([])
  })

  it('rejects the root node, leaving the engine unchanged', () => {
    const { engine, undoStack, dispatcher, slide } = setup()
    const events = collectEvents(engine)
    const before = undoStack.entries.length

    const result = dispatcher.dispatch(new DuplicateNodeCommand({ nodeId: slide.scene.root.id }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/asset instance/i)
    }
    expect(undoStack.entries).toHaveLength(before)
    expect(events).toEqual([])
  })

  it('rejects the camera node, leaving the engine unchanged', () => {
    const { engine, undoStack, dispatcher, slide } = setup()
    const events = collectEvents(engine)
    const before = undoStack.entries.length

    const result = dispatcher.dispatch(new DuplicateNodeCommand({ nodeId: slide.scene.camera.id }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/asset instance/i)
    }
    expect(engine.getSlide(slide.id).scene.camera.id).toBe(slide.scene.camera.id)
    expect(undoStack.entries).toHaveLength(before)
    expect(events).toEqual([])
  })

  it('rejects a nonexistent node with a descriptive error', () => {
    const { engine, undoStack, dispatcher } = setup()
    const events = collectEvents(engine)
    const before = undoStack.entries.length

    const result = dispatcher.dispatch(new DuplicateNodeCommand({ nodeId: 'ghost' }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/node.*not found/i)
    }
    expect(undoStack.entries).toHaveLength(before)
    expect(events).toEqual([])
  })

  it('serializes to JSON with its type and parameters', () => {
    expect(new DuplicateNodeCommand({ nodeId: 'n1' }).toJSON()).toEqual({
      type: 'DuplicateNode',
      nodeId: 'n1',
    })
  })
})
