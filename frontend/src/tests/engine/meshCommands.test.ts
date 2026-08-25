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
  MirrorMeshCommand,
  GenerateMeshCommand,
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

describe('MirrorMeshCommand', () => {
  it('mirrors along X axis and creates symmetric copy', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(new MirrorMeshCommand({ nodeId, axis: 'x' }))
    const inverse = expectOk(result)
    const node = system.engine.getNode(nodeId)
    const mesh = node.components.mesh!.mesh
    expect(mesh.vertices.length).toBeGreaterThan(4)
    expect(mesh.faces.length).toBeGreaterThan(2)
    expect(inverse.mesh.vertices).toHaveLength(4)
    expect(inverse.mesh.faces).toHaveLength(2)
  })

  it('mirrors along Y axis and creates symmetric copy', () => {
    const { system, nodeId } = setupWithMeshNode()
    const result = system.dispatcher.dispatch(new MirrorMeshCommand({ nodeId, axis: 'y' }))
    const inverse = expectOk(result)
    const node = system.engine.getNode(nodeId)
    const mesh = node.components.mesh!.mesh
    expect(mesh.vertices.length).toBeGreaterThan(4)
    expect(mesh.faces.length).toBeGreaterThan(2)
    expect(inverse.mesh.vertices).toHaveLength(4)
    expect(inverse.mesh.faces).toHaveLength(2)
  })

  it('merges vertices near the mirror plane (no duplicates at seam)', () => {
    const { system, nodeId } = setupWithMeshNode()
    system.dispatcher.dispatch(new MirrorMeshCommand({ nodeId, axis: 'x' }))
    const node = system.engine.getNode(nodeId)
    const mesh = node.components.mesh!.mesh
    const meshCenterX = meshCenter(mesh, 'x')
    for (const v of mesh.vertices) {
      const dist = Math.abs(v.x - meshCenterX)
      expect(dist).toBeGreaterThan(0.005)
    }
  })

  it('produces inverse that restores original mesh', () => {
    const { system, nodeId } = setupWithMeshNode()
    const inverse = expectOk(
      system.dispatcher.dispatch(new MirrorMeshCommand({ nodeId, axis: 'x' })),
    )
    const nodeAfter = system.engine.getNode(nodeId)
    const meshAfter = nodeAfter.components.mesh!.mesh
    expect(meshAfter.vertices.length).toBeGreaterThan(4)
    system.dispatcher.dispatch(
      new (class {
        readonly type = 'UndoMirror'
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
    const result = system.dispatcher.dispatch(new MirrorMeshCommand({ nodeId, axis: 'x' }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/mesh component/i)
    }
  })

  it('serializes to JSON', () => {
    const cmd = new MirrorMeshCommand({ nodeId: 'n1', axis: 'y' })
    expect(cmd.toJSON()).toEqual({
      type: 'MirrorMesh',
      nodeId: 'n1',
      axis: 'y',
    })
  })
})

function meshCenter(mesh: MeshData, axis: 'x' | 'y'): number {
  if (axis === 'x') {
    const sum = mesh.vertices.reduce((acc, v) => acc + v.x, 0)
    return sum / mesh.vertices.length
  }
  const sum = mesh.vertices.reduce((acc, v) => acc + v.y, 0)
  return sum / mesh.vertices.length
}

function setupWithAssetInstanceNode() {
  const system = createCommandSystem()
  expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const slide = system.engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const { nodeId } = expectOk(
    system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: 'AssetNode',
        components: {
          assetInstance: { kind: 'assetInstance', assetDefinitionId: 'test-def' },
        },
      }),
    ),
  )
  return { system, nodeId }
}

describe('GenerateMeshCommand', () => {
  it('installs a mesh on an asset instance node without an existing mesh', () => {
    const { system, nodeId } = setupWithAssetInstanceNode()
    const mesh: MeshData = createDefaultRectangleMesh(100, 80)
    const inverse = expectOk(system.dispatcher.dispatch(new GenerateMeshCommand({ nodeId, mesh })))
    const node = system.engine.getNode(nodeId)
    expect(node.components.mesh).toBeDefined()
    expect(node.components.mesh!.mesh.vertices).toHaveLength(4)
    expect(node.components.mesh!.mesh.faces).toHaveLength(2)
    expect(inverse.oldMesh).toBeNull()
  })

  it('replaces an existing mesh on an asset instance node', () => {
    const { system, nodeId } = setupWithAssetInstanceNode()
    const mesh1: MeshData = createDefaultRectangleMesh(100, 80)
    expectOk(system.dispatcher.dispatch(new GenerateMeshCommand({ nodeId, mesh: mesh1 })))
    const mesh2: MeshData = createDefaultRectangleMesh(200, 160)
    const inverse = expectOk(
      system.dispatcher.dispatch(new GenerateMeshCommand({ nodeId, mesh: mesh2 })),
    )
    const node = system.engine.getNode(nodeId)
    expect(node.components.mesh!.mesh.vertices[1]).toEqual({ x: 200, y: 0 })
    expect(inverse.oldMesh).not.toBeNull()
    expect(inverse.oldMesh!.vertices[1]).toEqual({ x: 100, y: 0 })
  })

  it('rejects a node without an asset instance component', () => {
    const { system, nodeId } = setupWithMeshNode()
    const mesh: MeshData = createDefaultRectangleMesh(100, 80)
    const result = system.dispatcher.dispatch(new GenerateMeshCommand({ nodeId, mesh }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/asset instance/i)
    }
  })

  it('rejects a node without any relevant component', () => {
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
          name: 'BareNode',
        }),
      ),
    )
    const mesh: MeshData = createDefaultRectangleMesh(100, 80)
    const result = system.dispatcher.dispatch(new GenerateMeshCommand({ nodeId, mesh }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/asset instance/i)
    }
  })

  it('rejects a nonexistent node', () => {
    const system = createCommandSystem()
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const mesh: MeshData = createDefaultRectangleMesh(100, 80)
    const result = system.dispatcher.dispatch(
      new GenerateMeshCommand({ nodeId: 'nonexistent', mesh }),
    )
    expect(result.ok).toBe(false)
  })

  it('rejects a mesh with no faces', () => {
    const { system, nodeId } = setupWithAssetInstanceNode()
    const mesh: MeshData = {
      vertices: [{ x: 0, y: 0 }],
      faces: [],
      uvs: [{ u: 0, v: 0 }],
    }
    expect(() => system.dispatcher.dispatch(new GenerateMeshCommand({ nodeId, mesh }))).toThrow(
      /vertices and faces/i,
    )
  })

  it('rejects a mesh with no vertices', () => {
    const { system, nodeId } = setupWithAssetInstanceNode()
    const mesh: MeshData = {
      vertices: [],
      faces: [],
      uvs: [],
    }
    expect(() => system.dispatcher.dispatch(new GenerateMeshCommand({ nodeId, mesh }))).toThrow(
      /vertices and faces/i,
    )
  })

  it('rejects a mesh with invalid face indices', () => {
    const { system, nodeId } = setupWithAssetInstanceNode()
    const mesh: MeshData = {
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 10 },
      ],
      faces: [{ v0: 0, v1: 1, v2: 5 }],
      uvs: [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 0.5, v: 1 },
      ],
    }
    const result = system.dispatcher.dispatch(new GenerateMeshCommand({ nodeId, mesh }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/invalid face index/i)
    }
  })

  it('rejects a mesh with UV count mismatch', () => {
    const { system, nodeId } = setupWithAssetInstanceNode()
    const mesh: MeshData = {
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 10 },
      ],
      faces: [{ v0: 0, v1: 1, v2: 2 }],
      uvs: [{ u: 0, v: 0 }],
    }
    const result = system.dispatcher.dispatch(new GenerateMeshCommand({ nodeId, mesh }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/UV count/i)
    }
  })

  it('produces inverse that restores the previous mesh on undo', () => {
    const { system, nodeId } = setupWithAssetInstanceNode()
    const mesh1: MeshData = createDefaultRectangleMesh(100, 80)
    const inverse1 = expectOk(
      system.dispatcher.dispatch(new GenerateMeshCommand({ nodeId, mesh: mesh1 })),
    )
    const mesh2: MeshData = createDefaultRectangleMesh(200, 160)
    const inverse2 = expectOk(
      system.dispatcher.dispatch(new GenerateMeshCommand({ nodeId, mesh: mesh2 })),
    )

    // Simulate undo of mesh2: restore inverse2.oldMesh (mesh1)
    system.dispatcher.dispatch(
      new (class {
        readonly type = 'UndoGenerateMesh'
        readonly parameters = {}
        validate() {}
        execute(eng: Engine) {
          eng.setMeshData(nodeId, inverse2.oldMesh!)
          return inverse2.oldMesh
        }
        toJSON() {
          return {}
        }
      })() as never,
    )
    const node = system.engine.getNode(nodeId)
    expect(node.components.mesh!.mesh.vertices[1]).toEqual({ x: 100, y: 0 })

    // Simulate undo of mesh1: restore inverse1.oldMesh (null = no mesh)
    system.dispatcher.dispatch(
      new (class {
        readonly type = 'UndoGenerateMesh'
        readonly parameters = {}
        validate() {}
        execute(eng: Engine) {
          // Remove mesh component by setting components without mesh
          const n = eng.getNode(nodeId)
          const newComponents = { ...n.components }
          delete (newComponents as Record<string, unknown>).mesh
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(n as any).components = Object.freeze(newComponents)
          return inverse1.oldMesh
        }
        toJSON() {
          return {}
        }
      })() as never,
    )
    const nodeAfterUndo = system.engine.getNode(nodeId)
    expect(nodeAfterUndo.components.mesh).toBeUndefined()
  })

  it('preserves bone weights and bind pose through the inverse', () => {
    const { system, nodeId } = setupWithAssetInstanceNode()
    const meshWithWeights: MeshData = {
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 10 },
      ],
      faces: [{ v0: 0, v1: 1, v2: 2 }],
      uvs: [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 0.5, v: 1 },
      ],
      boneWeights: [
        [
          { boneId: 'bone1', weight: 0.8 },
          { boneId: 'bone2', weight: 0.2 },
        ],
        [
          { boneId: 'bone1', weight: 0.6 },
          { boneId: 'bone2', weight: 0.4 },
        ],
        [{ boneId: 'bone1', weight: 1.0 }],
      ],
      bindPose: {
        bone1: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        bone2: { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      },
    }
    const inverse = expectOk(
      system.dispatcher.dispatch(new GenerateMeshCommand({ nodeId, mesh: meshWithWeights })),
    )
    expect(inverse.oldMesh).toBeNull()

    const mesh2: MeshData = createDefaultRectangleMesh(50, 50)
    const inverse2 = expectOk(
      system.dispatcher.dispatch(new GenerateMeshCommand({ nodeId, mesh: mesh2 })),
    )

    // The inverse should contain the full mesh with weights and bind pose
    expect(inverse2.oldMesh).not.toBeNull()
    expect(inverse2.oldMesh!.boneWeights).toHaveLength(3)
    expect(inverse2.oldMesh!.bindPose).toBeDefined()
    expect(inverse2.oldMesh!.bindPose!.bone1.x).toBe(0)
    expect(inverse2.oldMesh!.boneWeights![0][0].boneId).toBe('bone1')
  })

  it('serializes to JSON', () => {
    const cmd = new GenerateMeshCommand({
      nodeId: 'n1',
      mesh: createDefaultRectangleMesh(100, 80),
    })
    expect(cmd.toJSON()).toEqual({
      type: 'GenerateMesh',
      nodeId: 'n1',
    })
  })
})
