import { describe, expect, it } from 'vitest'
import type { CommandResult } from '../../engine/commands'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  MoveVertexCommand,
  DeleteVerticesCommand,
  createCommandSystem,
} from '../../engine/commands'
import { createDefaultRectangleMesh } from '../../engine/mesh'
import type { MeshData } from '../../engine/mesh'

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function setupWithMeshNode() {
  const system = createCommandSystem()
  expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const slide = system.engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const mesh: MeshData = createDefaultRectangleMesh(160, 100)
  const { nodeId } = expectOk(
    system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: 'MeshNode',
        components: { mesh: { kind: 'mesh', mesh } },
      }),
    ),
  )
  return { system, nodeId }
}

describe('MoveVertexCommand', () => {
  it('moves a vertex to a new position', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(
      new MoveVertexCommand({ nodeId, vertexIndex: 0, x: 10, y: 20 }),
    )
    const inverse = expectOk(result)
    const node = system.engine.getNode(nodeId)
    const mesh = node.components.mesh!.mesh
    expect(mesh.vertices[0]).toEqual({ x: 10, y: 20 })
    expect(inverse).toEqual({ nodeId, vertexIndex: 0, oldX: 0, oldY: 0 })
  })

  it('rejects a vertex index out of bounds', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(
      new MoveVertexCommand({ nodeId, vertexIndex: 99, x: 10, y: 20 }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/out of bounds/i)
    }
  })

  it('rejects non-finite coordinates', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(
      new MoveVertexCommand({ nodeId, vertexIndex: 0, x: Number.NaN, y: 20 }),
    )
    expect(result.ok).toBe(false)
  })

  it('rejects a node without mesh component', () => {
    const system = createCommandSystem()
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const slide = system.engine.project?.slides[0]
    if (!slide) throw new Error('expected a slide')
    const { nodeId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: slide.scene.root.id, name: 'NoMesh' }),
      ),
    )
    const result = system.dispatcher.dispatch(
      new MoveVertexCommand({ nodeId, vertexIndex: 0, x: 10, y: 20 }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/mesh component/i)
    }
  })

  it('serializes to JSON', () => {
    const cmd = new MoveVertexCommand({ nodeId: 'n1', vertexIndex: 2, x: 5, y: 10 })
    expect(cmd.toJSON()).toEqual({
      type: 'MoveVertex',
      nodeId: 'n1',
      vertexIndex: 2,
      x: 5,
      y: 10,
    })
  })
})

describe('DeleteVerticesCommand', () => {
  it('deletes vertices and removes connected faces', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(
      new DeleteVerticesCommand({ nodeId, vertexIndices: [0] }),
    )
    const inverse = expectOk(result)
    const node = system.engine.getNode(nodeId)
    const mesh = node.components.mesh!.mesh
    expect(mesh.vertices.length).toBe(3)
    expect(mesh.faces.length).toBe(0)
    expect(inverse.deletedVertexIndices).toEqual([0])
  })

  it('deletes multiple vertices', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(
      new DeleteVerticesCommand({ nodeId, vertexIndices: [0, 2] }),
    )
    expectOk(result)
    const node = system.engine.getNode(nodeId)
    const mesh = node.components.mesh!.mesh
    expect(mesh.vertices.length).toBe(2)
    expect(mesh.faces.length).toBe(0)
  })

  it('rejects empty vertex indices', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(
      new DeleteVerticesCommand({ nodeId, vertexIndices: [] }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/at least one/i)
    }
  })

  it('rejects out of bounds vertex index', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(
      new DeleteVerticesCommand({ nodeId, vertexIndices: [100] }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/out of bounds/i)
    }
  })

  it('rejects a node without mesh component', () => {
    const system = createCommandSystem()
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const slide = system.engine.project?.slides[0]
    if (!slide) throw new Error('expected a slide')
    const { nodeId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: slide.scene.root.id, name: 'NoMesh' }),
      ),
    )
    const result = system.dispatcher.dispatch(
      new DeleteVerticesCommand({ nodeId, vertexIndices: [0] }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/mesh component/i)
    }
  })

  it('serializes to JSON', () => {
    const cmd = new DeleteVerticesCommand({ nodeId: 'n1', vertexIndices: [1, 3] })
    expect(cmd.toJSON()).toEqual({
      type: 'DeleteVertices',
      nodeId: 'n1',
      vertexIndices: [1, 3],
    })
  })
})

describe('mesh data', () => {
  it('creates a default rectangle mesh with 4 vertices and 2 faces', () => {
    const mesh = createDefaultRectangleMesh(160, 100)
    expect(mesh.vertices).toHaveLength(4)
    expect(mesh.faces).toHaveLength(2)
    expect(mesh.uvs).toHaveLength(4)
    expect(mesh.vertices[0]).toEqual({ x: 0, y: 0 })
    expect(mesh.vertices[1]).toEqual({ x: 160, y: 0 })
    expect(mesh.vertices[2]).toEqual({ x: 160, y: 100 })
    expect(mesh.vertices[3]).toEqual({ x: 0, y: 100 })
  })
})
