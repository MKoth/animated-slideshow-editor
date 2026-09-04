import { describe, it, expect } from 'vitest'
import { createEngine } from '../../engine/internal'
import { createDefaultRectangleMesh } from '../../engine/mesh'
import { CommandDispatcher } from '../../engine/commands/dispatcher'
import { UndoStack } from '../../engine/commands/undoStack'
import { MoveShapeVertexCommand, TransactionCommand } from '../../engine/commands'

function setup() {
  const engine = createEngine()
  engine.createProject({ name: 'P' })
  engine.createSlide('S1')
  const slide = engine.getActiveSlide()!
  const mesh = createDefaultRectangleMesh(10, 10)
  const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'MeshNode', {
    components: { mesh: { kind: 'mesh', mesh } },
  })
  const shape = engine.createShape(node.id, 'Base')
  engine.createShape(node.id, 'Target')
  return { engine, nodeId: node.id, shapeId: shape.id }
}

describe('Sculpt shape stroke (Seam 1 & Seam 2)', () => {
  it('MoveShapeVertexCommand moves a single vertex of active Shape', () => {
    const { engine, nodeId, shapeId } = setup()
    const before = engine.getShapes(nodeId).find((s) => s.id === shapeId)!.vertices[0]!
    const cmd = new MoveShapeVertexCommand({ nodeId, shapeId, vertexIndex: 0, x: 999, y: 888 })
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, () => {})
    const result = dispatcher.dispatch(cmd)
    expect(result.ok).toBe(true)
    const after = engine.getShapes(nodeId).find((s) => s.id === shapeId)!.vertices[0]!
    expect(after.x).toBe(999)
    expect(after.y).toBe(888)
    // original not modified
    expect(before.x).not.toBe(999)
  })

  it('per-stroke Transaction groups per-vertex moves; Undo reverts whole gesture', () => {
    const { engine, nodeId, shapeId } = setup()
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, () => {})
    const origVerts = engine
      .getShapes(nodeId)
      .find((s) => s.id === shapeId)!
      .vertices.map((v) => ({ ...v }))

    // Simulate a stroke that moves vertex 0 and 1 (two dabs accumulated into one Transaction)
    const cmd0 = new MoveShapeVertexCommand({
      nodeId,
      shapeId,
      vertexIndex: 0,
      x: origVerts[0]!.x + 5,
      y: origVerts[0]!.y,
    })
    const cmd1 = new MoveShapeVertexCommand({
      nodeId,
      shapeId,
      vertexIndex: 1,
      x: origVerts[1]!.x + 5,
      y: origVerts[1]!.y,
    })
    const tx = new TransactionCommand([cmd0, cmd1])
    const res = dispatcher.dispatch(tx)
    expect(res.ok).toBe(true)
    const after = engine.getShapes(nodeId).find((s) => s.id === shapeId)!.vertices
    expect(after[0]!.x).toBeCloseTo(origVerts[0]!.x + 5)
    expect(after[1]!.x).toBeCloseTo(origVerts[1]!.x + 5)

    // Undo should revert both vertices in one step (per-stroke, not per-dab)
    expect(dispatcher.undo()).toBe(true)
    const undone = engine.getShapes(nodeId).find((s) => s.id === shapeId)!.vertices
    expect(undone[0]!.x).toBeCloseTo(origVerts[0]!.x)
    expect(undone[1]!.x).toBeCloseTo(origVerts[1]!.x)

    // Redo should reapply both
    expect(dispatcher.redo()).toBe(true)
    const redone = engine.getShapes(nodeId).find((s) => s.id === shapeId)!.vertices
    expect(redone[0]!.x).toBeCloseTo(origVerts[0]!.x + 5)
  })

  it('rest vertices committed to active Shape are persisted and survives round-trip', () => {
    const { engine, nodeId, shapeId } = setup()
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, () => {})
    const before = engine.getShapes(nodeId).find((s) => s.id === shapeId)!.vertices[0]!
    dispatcher.dispatch(
      new MoveShapeVertexCommand({
        nodeId,
        shapeId,
        vertexIndex: 0,
        x: before.x + 10,
        y: before.y + 20,
      }),
    )
    const after = engine.getShapes(nodeId).find((s) => s.id === shapeId)!.vertices[0]!
    expect(after.x).toBeCloseTo(before.x + 10)
    // Simulate save/load via JSON round-trip
    const json = engine.toJSON()
    const engine2 = createEngine()
    engine2.restoreFromJSON(json as unknown as import('../../engine/json').LessonJSON)
    const restored = engine2.getShapes(nodeId).find((s) => s.id === shapeId)!.vertices[0]!
    expect(restored.x).toBeCloseTo(after.x)
    expect(restored.y).toBeCloseTo(after.y)
  })
})
