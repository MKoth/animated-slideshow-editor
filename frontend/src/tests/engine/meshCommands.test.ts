import { describe, expect, it } from 'vitest'
import type { CommandResult } from '../../engine/commands'
import type { Engine } from '../../engine/internal'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  MoveVertexCommand,
  DeleteVerticesCommand,
  ExtrudeFacesCommand,
  ExtrudeEdgesCommand,
  SubdivideFacesCommand,
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
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'NoMesh',
        }),
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
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'NoMesh',
        }),
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

describe('ExtrudeFacesCommand', () => {
  it('extrudes a face and creates new geometry', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(
      new ExtrudeFacesCommand({ nodeId, faceIndices: [0], distance: 10 }),
    )
    const inverse = expectOk(result)
    const node = system.engine.getNode(nodeId)
    const mesh = node.components.mesh!.mesh
    expect(mesh.vertices.length).toBeGreaterThan(4)
    expect(mesh.faces.length).toBeGreaterThan(2)
    expect(inverse.mesh.vertices).toHaveLength(4)
    expect(inverse.mesh.faces).toHaveLength(2)
  })

  it('extrudes multiple faces', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(
      new ExtrudeFacesCommand({ nodeId, faceIndices: [0, 1], distance: 10 }),
    )
    expectOk(result)
    const node = system.engine.getNode(nodeId)
    const mesh = node.components.mesh!.mesh
    expect(mesh.vertices.length).toBeGreaterThan(4)
  })

  it('rejects empty face indices', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(
      new ExtrudeFacesCommand({ nodeId, faceIndices: [], distance: 10 }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/at least one/i)
    }
  })

  it('rejects out of bounds face index', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(
      new ExtrudeFacesCommand({ nodeId, faceIndices: [100], distance: 10 }),
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
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'NoMesh',
        }),
      ),
    )
    const result = system.dispatcher.dispatch(
      new ExtrudeFacesCommand({ nodeId, faceIndices: [0], distance: 10 }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/mesh component/i)
    }
  })

  it('rejects non-finite distance', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(
      new ExtrudeFacesCommand({ nodeId, faceIndices: [0], distance: Number.NaN }),
    )
    expect(result.ok).toBe(false)
  })

  it('serializes to JSON', () => {
    const cmd = new ExtrudeFacesCommand({ nodeId: 'n1', faceIndices: [0, 2], distance: 15 })
    expect(cmd.toJSON()).toEqual({
      type: 'ExtrudeFaces',
      nodeId: 'n1',
      faceIndices: [0, 2],
      distance: 15,
    })
  })
})

describe('ExtrudeEdgesCommand', () => {
  it('extrudes an edge and creates new geometry', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(
      new ExtrudeEdgesCommand({
        nodeId,
        edgeIndices: [{ v0: 0, v1: 1 }],
        distance: 10,
      }),
    )
    const inverse = expectOk(result)
    const node = system.engine.getNode(nodeId)
    const mesh = node.components.mesh!.mesh
    expect(mesh.vertices.length).toBeGreaterThan(4)
    expect(mesh.faces.length).toBeGreaterThan(2)
    expect(inverse.mesh.vertices).toHaveLength(4)
    expect(inverse.mesh.faces).toHaveLength(2)
  })

  it('extrudes multiple edges', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(
      new ExtrudeEdgesCommand({
        nodeId,
        edgeIndices: [
          { v0: 0, v1: 1 },
          { v0: 1, v1: 2 },
        ],
        distance: 10,
      }),
    )
    expectOk(result)
    const node = system.engine.getNode(nodeId)
    const mesh = node.components.mesh!.mesh
    expect(mesh.vertices.length).toBeGreaterThan(4)
  })

  it('rejects empty edge indices', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(
      new ExtrudeEdgesCommand({ nodeId, edgeIndices: [], distance: 10 }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/at least one/i)
    }
  })

  it('rejects out of bounds edge vertex index', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(
      new ExtrudeEdgesCommand({
        nodeId,
        edgeIndices: [{ v0: 0, v1: 99 }],
        distance: 10,
      }),
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
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'NoMesh',
        }),
      ),
    )
    const result = system.dispatcher.dispatch(
      new ExtrudeEdgesCommand({
        nodeId,
        edgeIndices: [{ v0: 0, v1: 1 }],
        distance: 10,
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/mesh component/i)
    }
  })

  it('rejects non-finite distance', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(
      new ExtrudeEdgesCommand({
        nodeId,
        edgeIndices: [{ v0: 0, v1: 1 }],
        distance: Number.POSITIVE_INFINITY,
      }),
    )
    expect(result.ok).toBe(false)
  })

  it('serializes to JSON', () => {
    const cmd = new ExtrudeEdgesCommand({
      nodeId: 'n1',
      edgeIndices: [{ v0: 0, v1: 1 }],
      distance: 20,
    })
    expect(cmd.toJSON()).toEqual({
      type: 'ExtrudeEdges',
      nodeId: 'n1',
      edgeIndices: [{ v0: 0, v1: 1 }],
      distance: 20,
    })
  })
})

describe('SubdivideFacesCommand', () => {
  it('subdivides a single face into 4 smaller triangles', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(
      new SubdivideFacesCommand({ nodeId, faceIndices: [0] }),
    )
    const inverse = expectOk(result)
    const node = system.engine.getNode(nodeId)
    const mesh = node.components.mesh!.mesh
    expect(mesh.faces.length).toBe(5)
    expect(mesh.vertices.length).toBe(7)
    expect(mesh.uvs.length).toBe(7)
    expect(inverse.mesh.faces).toHaveLength(2)
    expect(inverse.mesh.vertices).toHaveLength(4)
  })

  it('subdivides both faces of the default rectangle mesh', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(
      new SubdivideFacesCommand({ nodeId, faceIndices: [0, 1] }),
    )
    expectOk(result)
    const node = system.engine.getNode(nodeId)
    const mesh = node.components.mesh!.mesh
    expect(mesh.faces.length).toBe(8)
    expect(mesh.vertices.length).toBe(9)
    expect(mesh.uvs.length).toBe(9)
  })

  it('shares midpoint vertices between adjacent subdivided faces', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(
      new SubdivideFacesCommand({ nodeId, faceIndices: [0, 1] }),
    )
    expectOk(result)
    const node = system.engine.getNode(nodeId)
    const mesh = node.components.mesh!.mesh
    const midpointVerts = mesh.vertices.filter((_, i) => i >= 4)
    expect(midpointVerts.length).toBe(5)
  })

  it('interpolates UVs for new midpoint vertices', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(
      new SubdivideFacesCommand({ nodeId, faceIndices: [0] }),
    )
    expectOk(result)
    const node = system.engine.getNode(nodeId)
    const mesh = node.components.mesh!.mesh
    const uv0 = mesh.uvs[0]
    const uv1 = mesh.uvs[1]
    const midUv = mesh.uvs[4]
    expect(midUv.u).toBeCloseTo((uv0.u + uv1.u) / 2)
    expect(midUv.v).toBeCloseTo((uv0.v + uv1.v) / 2)
  })

  it('preserves unselected faces unchanged', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(
      new SubdivideFacesCommand({ nodeId, faceIndices: [0] }),
    )
    expectOk(result)
    const node = system.engine.getNode(nodeId)
    const mesh = node.components.mesh!.mesh
    const face1 = mesh.faces[4]
    expect(face1).toEqual({ v0: 0, v1: 2, v2: 3 })
  })

  it('produces inverse that restores original mesh', () => {
    const { system, nodeId } = setupWithMeshNode()
    const inverse = expectOk(
      system.dispatcher.dispatch(new SubdivideFacesCommand({ nodeId, faceIndices: [0] })),
    )
    const nodeAfter = system.engine.getNode(nodeId)
    const meshAfter = nodeAfter.components.mesh!.mesh
    expect(meshAfter.faces.length).toBe(5)
    system.dispatcher.dispatch(
      new (class {
        readonly type = 'UndoSubdivide'
        readonly parameters = {}
        validate() {}
        execute(eng: Engine) {
          eng.setMeshData(nodeId, inverse.mesh)
          return inverse.mesh
        }
        toJSON() {
          return {}
        }
      })() as never,
    )
    const nodeRestored = system.engine.getNode(nodeId)
    const meshRestored = nodeRestored.components.mesh!.mesh
    expect(meshRestored.faces.length).toBe(2)
    expect(meshRestored.vertices.length).toBe(4)
  })

  it('rejects empty face indices', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(
      new SubdivideFacesCommand({ nodeId, faceIndices: [] }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/at least one/i)
    }
  })

  it('rejects out of bounds face index', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(
      new SubdivideFacesCommand({ nodeId, faceIndices: [100] }),
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
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'NoMesh',
        }),
      ),
    )
    const result = system.dispatcher.dispatch(
      new SubdivideFacesCommand({ nodeId, faceIndices: [0] }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/mesh component/i)
    }
  })

  it('serializes to JSON', () => {
    const cmd = new SubdivideFacesCommand({ nodeId: 'n1', faceIndices: [0, 2] })
    expect(cmd.toJSON()).toEqual({
      type: 'SubdivideFaces',
      nodeId: 'n1',
      faceIndices: [0, 2],
    })
  })
})
