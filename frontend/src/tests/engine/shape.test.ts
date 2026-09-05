import { describe, it, expect, vi } from 'vitest'
import { createEngine } from '../../engine/internal'
import { createDefaultRectangleMesh } from '../../engine/mesh'
import { copyComponents } from '../../engine/components'
import { deserialize, serialize, validate } from '../../engine/lessonSerializer'
import type { LessonJSON } from '../../engine/json'
import { shapeFromJSON } from '../../engine/shape'
import { createEngine as createEngineInternal } from '../../engine/internal'
import { UndoStack } from '../../engine/commands/undoStack'
import { CommandDispatcher } from '../../engine/commands/dispatcher'
import {
  CreateShapeCommand,
  DuplicateShapeCommand,
  RenameShapeCommand,
  DeleteShapeCommand,
} from '../../engine/commands'

function setupEngineWithMesh() {
  const engine = createEngine()
  engine.createProject({ name: 'P' })
  engine.createSlide('S1')
  const slide = engine.getActiveSlide()!
  const mesh = createDefaultRectangleMesh(10, 10)
  const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'MeshNode', {
    components: { mesh: { kind: 'mesh', mesh } },
  })
  return { engine, nodeId: node.id, slide }
}

describe('Shape storage & JSON round-trip (foundation)', () => {
  it('Creating a Shape snapshots current rest vertices as named Shape', () => {
    const { engine, nodeId } = setupEngineWithMesh()
    const before = engine.getNode(nodeId).components.mesh!.mesh.vertices
    const shape = engine.createShape(nodeId, 'Base')
    expect(shape.name).toBe('Base')
    expect(shape.vertices).toEqual(before.map((v) => ({ x: v.x, y: v.y })))
    expect(shape.vertices).not.toBe(before) // deep clone
    const shapes = engine.getShapes(nodeId)
    expect(shapes).toHaveLength(1)
    expect(shapes[0]!.id).toBe(shape.id)
  })

  it('duplicate creates a new Shape with unique name and same vertices', () => {
    const { engine, nodeId } = setupEngineWithMesh()
    const a = engine.createShape(nodeId, 'Smile')
    const dup = engine.duplicateShape(nodeId, a.id)
    expect(dup.id).not.toBe(a.id)
    expect(dup.vertices).toEqual(a.vertices)
    expect(dup.name).toBe('Smile 2')
    // second duplicate should be Smile 3
    const dup2 = engine.duplicateShape(nodeId, a.id)
    expect(dup2.name).toBe('Smile 3')
    const shapes = engine.getShapes(nodeId)
    expect(shapes.map((s) => s.name)).toEqual(['Smile', 'Smile 2', 'Smile 3'])
  })

  it('storage order equals array order', () => {
    const { engine, nodeId } = setupEngineWithMesh()
    const s1 = engine.createShape(nodeId, 'A')
    const s2 = engine.createShape(nodeId, 'B')
    const s3 = engine.createShape(nodeId, 'C')
    const shapes = engine.getShapes(nodeId)
    expect(shapes.map((s) => s.id)).toEqual([s1.id, s2.id, s3.id])
    expect(shapes.map((s) => s.name)).toEqual(['A', 'B', 'C'])
  })

  it('Rename validates per-mesh unique name with block-on-duplicate inline error', () => {
    const { engine, nodeId } = setupEngineWithMesh()
    const s1 = engine.createShape(nodeId, 'Smile')
    const s2 = engine.createShape(nodeId, 'Frown')
    // rename to duplicate should throw
    expect(() => engine.renameShape(nodeId, s2.id, 'Smile')).toThrow(/already exists/i)
    // rename to same name (self) should be allowed (no-op)
    expect(() => engine.renameShape(nodeId, s2.id, 'Frown')).not.toThrow()
    // rename to unique should succeed
    engine.renameShape(nodeId, s2.id, 'Grin')
    expect(engine.getShapes(nodeId).find((s) => s.id === s2.id)!.name).toBe('Grin')
    expect(engine.getShapes(nodeId).find((s) => s.id === s1.id)!.name).toBe('Smile')
  })

  it('Rename trims and rejects empty name', () => {
    const { engine, nodeId } = setupEngineWithMesh()
    const s = engine.createShape(nodeId, 'Foo')
    expect(() => engine.renameShape(nodeId, s.id, '   ')).toThrow(/non-empty/)
    expect(() => engine.renameShape(nodeId, s.id, '')).toThrow(/non-empty/)
  })

  it('delete removes the Shape keeping remaining intact', () => {
    const { engine, nodeId } = setupEngineWithMesh()
    const s1 = engine.createShape(nodeId, 'A')
    const s2 = engine.createShape(nodeId, 'B')
    const s3 = engine.createShape(nodeId, 'C')
    engine.deleteShape(nodeId, s2.id)
    const shapes = engine.getShapes(nodeId)
    expect(shapes.map((s) => s.id)).toEqual([s1.id, s3.id])
    expect(shapes.map((s) => s.name)).toEqual(['A', 'C'])
  })

  it('shapes persist inline on mesh component JSON and round-trip through lesson save/load', () => {
    const { engine, nodeId } = setupEngineWithMesh()
    engine.createShape(nodeId, 'Snap1')
    engine.createShape(nodeId, 'Snap2')
    const json = engine.toJSON() as LessonJSON
    // shapes should be inline on mesh component JSON
    const nodeJson = json.slides[0]!.scene.nodes.find((n) => n.id === nodeId)!
    expect(nodeJson.components.mesh).toBeDefined()
    expect(nodeJson.components.mesh!.shapes).toHaveLength(2)
    expect(nodeJson.components.mesh!.shapes![0]!.name).toBe('Snap1')
    expect(nodeJson.components.mesh!.shapes![1]!.name).toBe('Snap2')
    // vertices per shape should match base
    const baseLen = nodeJson.components.mesh!.mesh.vertices.length
    for (const s of nodeJson.components.mesh!.shapes!) {
      expect(s.vertices).toHaveLength(baseLen)
    }
    // round-trip via serialize/deserialize
    const text = serialize(engine.project!)
    const restored = deserialize(text)
    const engine2 = createEngine()
    engine2.openProject(restored)
    // Need to find same slide/node id? Project was recreated, ids preserved via serialize includes? Actually engine.toJSON uses project slides, ids are preserved.
    // Use LessonJSON round-trip to check shapes preserved via fromJSON
    const json2 = JSON.parse(text) as LessonJSON
    const nodeJson2 = json2.slides[0]!.scene.nodes.find((n) => n.id === nodeId)!
    expect(nodeJson2.components.mesh!.shapes).toHaveLength(2)
    // Also via engine restore check
    const engine3 = createEngine()
    engine3.restoreFromJSON(json)
    const shapes3 = engine3.getShapes(nodeId)
    expect(shapes3.map((s) => s.name)).toEqual(['Snap1', 'Snap2'])
    // Ensure ids preserved
    const originalIds = engine.getShapes(nodeId).map((s) => s.id)
    expect(shapes3.map((s) => s.id)).toEqual(originalIds)
  })

  it('old .lesson files without shapes load with empty Shape list and no migration prompt', () => {
    const { engine, nodeId } = setupEngineWithMesh()
    const json = engine.toJSON() as LessonJSON
    // Simulate old file by deleting shapes field if present
    for (const slide of json.slides) {
      for (const node of slide.scene.nodes as unknown as {
        components: { mesh?: { shapes?: unknown } }
      }[]) {
        if (node.components.mesh?.shapes) delete node.components.mesh.shapes
      }
    }
    const text = JSON.stringify(json)
    const restored = deserialize(text)
    void restored
    const engine2 = createEngine()
    // Should not throw, and shapes should be empty
    expect(() => engine2.restoreFromJSON(JSON.parse(text) as LessonJSON)).not.toThrow()
    // nodeId is preserved via JSON, shapes should be empty list
    expect(engine2.getShapes(nodeId)).toEqual([])
    // validate should have no errors for missing shapes
    expect(validate(JSON.parse(text))).toEqual([])
  })

  it('Validation drops shapes with mismatched vertex length with soft warning, file still loads', () => {
    const { engine, nodeId } = setupEngineWithMesh()
    // Create a valid shape first
    engine.createShape(nodeId, 'Good')
    const json = engine.toJSON() as LessonJSON
    // Inject a mismatched shape manually: 1 vertex instead of base.length
    const nodeJson = json.slides[0]!.scene.nodes.find((n) => n.id === nodeId)!
    const mismatched = {
      id: 'shape-bad-1',
      name: 'Bad',
      vertices: [{ x: 0, y: 0 }], // mismatched length
    }
    ;(nodeJson.components.mesh as unknown as Record<string, unknown>).shapes = [
      ...((nodeJson.components.mesh!.shapes as unknown as unknown[]) ?? []),
      mismatched,
    ]
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const text = JSON.stringify(json)
    // deserialize should not throw
    deserialize(text)
    const engine2 = createEngine()
    expect(() => engine2.restoreFromJSON(JSON.parse(text) as LessonJSON)).not.toThrow()
    const shapes = engine2.getShapes(nodeId)
    // Bad shape should be dropped, only Good remains
    expect(shapes).toHaveLength(1)
    expect(shapes[0]!.name).toBe('Good')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Dropping mismatched'))
    warnSpy.mockRestore()
  })

  it('shapeFromJSON validates id/name/vertices and throws on bad shape (dropped with warn)', () => {
    // shapeFromJSON is used internally; ensure invalid shape json is dropped with warn not crash
    const badJson = { id: 123, name: 'X', vertices: [{ x: 0, y: 0 }] }
    expect(() => shapeFromJSON(badJson)).toThrow(/Shape JSON/)
  })

  it('Component copy deep-clones shapes (ids preserved, deep vertices)', () => {
    const mesh = createDefaultRectangleMesh(10, 10)
    const shape = {
      id: 'shape-1',
      name: 'S',
      vertices: mesh.vertices.map((v) => ({ x: v.x, y: v.y })),
    } as import('../../engine/shape').Shape
    const original = {
      mesh: { kind: 'mesh' as const, mesh, shapes: [shape] },
    }
    const copied = copyComponents({
      mesh: original.mesh,
    } as unknown as import('../../engine/components').NodeComponents)
    expect(copied.mesh?.shapes).toBeDefined()
    expect(copied.mesh?.shapes![0]!.id).toBe(shape.id)
    expect(copied.mesh?.shapes![0]!.vertices).toEqual(shape.vertices)
    expect(copied.mesh?.shapes![0]!.vertices).not.toBe(shape.vertices)
    expect(copied.mesh?.shapes![0]!.vertices[0]).not.toBe(shape.vertices[0])
    // Mutate original vertices should not affect copy
    ;(shape.vertices as unknown as { x: number; y: number }[])[0]!.x = 999
    expect(copied.mesh?.shapes![0]!.vertices[0]!.x).not.toBe(999)
  })

  it('Creating duplicate names is blocked on create', () => {
    const { engine, nodeId } = setupEngineWithMesh()
    engine.createShape(nodeId, 'Dup')
    expect(() => engine.createShape(nodeId, 'Dup')).toThrow(/already exists/i)
    expect(() => engine.createShape(nodeId, ' Dup ')).toThrow(/already exists/i) // trimmed
  })

  it('faces/uvs/boneWeights/bindPose are NOT duplicated per Shape', () => {
    const { engine, nodeId } = setupEngineWithMesh()
    engine.createShape(nodeId, 'Test')
    const json = engine.toJSON() as LessonJSON
    const nodeJson = json.slides[0]!.scene.nodes.find((n) => n.id === nodeId)!
    const shapeJson = nodeJson.components.mesh!.shapes![0]!
    expect(shapeJson).toHaveProperty('id')
    expect(shapeJson).toHaveProperty('name')
    expect(shapeJson).toHaveProperty('vertices')
    expect(shapeJson).not.toHaveProperty('faces')
    expect(shapeJson).not.toHaveProperty('uvs')
    expect(shapeJson).not.toHaveProperty('boneWeights')
    expect(shapeJson).not.toHaveProperty('bindPose')
  })

  it('shapes array order is preserved through JSON round-trip', () => {
    const { engine, nodeId } = setupEngineWithMesh()
    const ids: string[] = []
    for (const name of ['First', 'Second', 'Third']) {
      ids.push(engine.createShape(nodeId, name).id)
    }
    const json = engine.toJSON() as LessonJSON
    const nodeJson = json.slides[0]!.scene.nodes.find((n) => n.id === nodeId)!
    expect(nodeJson.components.mesh!.shapes!.map((s) => s.id)).toEqual(ids)
    // restore
    const engine2 = createEngine()
    engine2.restoreFromJSON(json)
    expect(engine2.getShapes(nodeId).map((s) => s.id)).toEqual(ids)
  })

  it('empty shapes are omitted from JSON (additive optional inline)', () => {
    const { engine, nodeId } = setupEngineWithMesh()
    const json = engine.toJSON() as LessonJSON
    const nodeJson = json.slides[0]!.scene.nodes.find((n) => n.id === nodeId)!
    expect(nodeJson.components.mesh!.shapes).toBeUndefined()
  })

  it('commands create/duplicate/rename/delete work via dispatcher and support undo/redo', () => {
    const engine = createEngineInternal()
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, () => {})
    engine.createProject({ name: 'P2' })
    engine.createSlide('S1')
    const slide = engine.getActiveSlide()!
    const mesh = createDefaultRectangleMesh(10, 10)
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'MeshNode', {
      components: { mesh: { kind: 'mesh', mesh } },
    })
    const nodeId = node.id
    const e = engine
    // Create
    const createRes = dispatcher.dispatch(new CreateShapeCommand({ nodeId, name: 'Base' }))
    expect(createRes.ok).toBe(true)
    if (!createRes.ok) throw new Error('create failed')
    const shapeId = createRes.inverse.shapeId
    expect(e.getShapes(nodeId)).toHaveLength(1)
    // Duplicate (should be Base 2)
    const dupRes = dispatcher.dispatch(new DuplicateShapeCommand({ nodeId, shapeId }))
    expect(dupRes.ok).toBe(true)
    if (!dupRes.ok) throw new Error('dup failed')
    expect(e.getShapes(nodeId)).toHaveLength(2)
    expect(e.getShapes(nodeId)[1]!.name).toBe('Base 2')
    // Rename duplicate to unique name
    const renameRes = dispatcher.dispatch(
      new RenameShapeCommand({ nodeId, shapeId: dupRes.inverse.shapeId, newName: 'Variant' }),
    )
    expect(renameRes.ok).toBe(true)
    expect(e.getShapes(nodeId).find((s) => s.id === dupRes.inverse.shapeId)!.name).toBe('Variant')
    // Rename to duplicate should block
    const badRename = dispatcher.dispatch(
      new RenameShapeCommand({ nodeId, shapeId: dupRes.inverse.shapeId, newName: 'Base' }),
    )
    expect(badRename.ok).toBe(false)
    // Delete
    const delRes = dispatcher.dispatch(new DeleteShapeCommand({ nodeId, shapeId }))
    expect(delRes.ok).toBe(true)
    expect(e.getShapes(nodeId)).toHaveLength(1)
    // Undo delete should restore
    expect(dispatcher.undo()).toBe(true)
    expect(e.getShapes(nodeId)).toHaveLength(2)
    // Undo rename
    expect(dispatcher.undo()).toBe(true)
    expect(e.getShapes(nodeId).find((s) => s.id === dupRes.inverse.shapeId)!.name).toBe('Base 2')
    // Undo duplicate
    expect(dispatcher.undo()).toBe(true)
    expect(e.getShapes(nodeId)).toHaveLength(1)
    // Undo create
    expect(dispatcher.undo()).toBe(true)
    expect(e.getShapes(nodeId)).toHaveLength(0)
    // Redo create
    expect(dispatcher.redo()).toBe(true)
    expect(e.getShapes(nodeId)).toHaveLength(1)
  })
})
