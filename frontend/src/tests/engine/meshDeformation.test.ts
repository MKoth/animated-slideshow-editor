import { describe, expect, it } from 'vitest'
import type { CommandResult } from '../../engine/commands'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  SetVertexWeightsCommand,
  SmoothWeightsCommand,
  AutoWeightsCommand,
  PaintWeightCommand,
  BlurWeightsCommand,
  FillWeightsCommand,
  createCommandSystem,
} from '../../engine/commands'
import { createDefaultRectangleMesh } from '../../engine/mesh'
import type { MeshData } from '../../engine/mesh'
import { meshDataFromJSON, meshDataToJSON } from '../../engine/mesh'
import { evaluateMeshDeformation } from '../../engine/meshDeformationEvaluator'

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function setupWithMeshAndBoneNodes() {
  const system = createCommandSystem()
  expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const slide = system.engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }

  // Create a bone node
  const { nodeId: boneId } = expectOk(
    system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: 'Bone',
        components: { bone: { kind: 'bone', length: 100 } },
      }),
    ),
  )

  // Create a mesh node
  const mesh: MeshData = createDefaultRectangleMesh(160, 100)
  const { nodeId: meshId } = expectOk(
    system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: 'MeshNode',
        components: { mesh: { kind: 'mesh', mesh } },
      }),
    ),
  )

  return { system, boneId, meshId, slide }
}

describe('SetVertexWeightsCommand', () => {
  it('assigns weights to a vertex', () => {
    const { system, boneId, meshId } = setupWithMeshAndBoneNodes()
    const result = system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 0,
        weights: [{ boneId, weight: 1.0 }],
      }),
    )
    const inverse = expectOk(result)
    const node = system.engine.getNode(meshId)
    const mesh = node.components.mesh!.mesh
    expect(mesh.boneWeights).toBeDefined()
    expect(mesh.boneWeights![0]).toEqual([{ boneId, weight: 1.0 }])
    expect(inverse.nodeId).toBe(meshId)
    expect(inverse.vertexIndex).toBe(0)
    expect(inverse.oldWeights).toEqual([])
  })

  it('assigns weights to multiple vertices', () => {
    const { system, boneId, meshId } = setupWithMeshAndBoneNodes()
    system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 0,
        weights: [{ boneId, weight: 0.5 }],
      }),
    )
    system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 1,
        weights: [{ boneId, weight: 1.0 }],
      }),
    )
    const node = system.engine.getNode(meshId)
    const mesh = node.components.mesh!.mesh
    expect(mesh.boneWeights![0]).toEqual([{ boneId, weight: 0.5 }])
    expect(mesh.boneWeights![1]).toEqual([{ boneId, weight: 1.0 }])
  })

  it('rejects vertex index out of bounds', () => {
    const { system, boneId, meshId } = setupWithMeshAndBoneNodes()
    const result = system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 99,
        weights: [{ boneId, weight: 1.0 }],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/out of bounds/i)
    }
  })

  it('rejects empty weights', () => {
    const { system, meshId } = setupWithMeshAndBoneNodes()
    const result = system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 0,
        weights: [],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/at least one/i)
    }
  })

  it('rejects non-finite weight values', () => {
    const { system, boneId, meshId } = setupWithMeshAndBoneNodes()
    const result = system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 0,
        weights: [{ boneId, weight: Number.NaN }],
      }),
    )
    expect(result.ok).toBe(false)
  })

  it('rejects negative weight values', () => {
    const { system, boneId, meshId } = setupWithMeshAndBoneNodes()
    const result = system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 0,
        weights: [{ boneId, weight: -0.5 }],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/non-negative/i)
    }
  })

  it('rejects weights exceeding 1.0', () => {
    const { system, boneId, meshId } = setupWithMeshAndBoneNodes()
    const result = system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 0,
        weights: [{ boneId, weight: 1.5 }],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/at most 1/i)
    }
  })

  it('rejects node without mesh component', () => {
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
      new SetVertexWeightsCommand({
        nodeId,
        vertexIndex: 0,
        weights: [{ boneId: 'b1', weight: 1.0 }],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/mesh component/i)
    }
  })

  it('rejects unknown bone id', () => {
    const { system, meshId } = setupWithMeshAndBoneNodes()
    const result = system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 0,
        weights: [{ boneId: 'unknown_bone', weight: 1.0 }],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/unknown bone/i)
    }
  })

  it('serializes to JSON', () => {
    const cmd = new SetVertexWeightsCommand({
      nodeId: 'n1',
      vertexIndex: 2,
      weights: [{ boneId: 'b1', weight: 0.7 }],
    })
    expect(cmd.toJSON()).toEqual({
      type: 'SetVertexWeights',
      nodeId: 'n1',
      vertexIndex: 2,
      weights: [{ boneId: 'b1', weight: 0.7 }],
    })
  })
})

describe('SmoothWeightsCommand', () => {
  it('smooths weights for a vertex', () => {
    const { system, boneId, meshId } = setupWithMeshAndBoneNodes()
    // Set weights on all vertices for proper smoothing
    system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 0,
        weights: [{ boneId, weight: 1.0 }],
      }),
    )
    system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 1,
        weights: [{ boneId, weight: 0.0 }],
      }),
    )
    system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 2,
        weights: [{ boneId, weight: 0.5 }],
      }),
    )
    system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 3,
        weights: [{ boneId, weight: 0.5 }],
      }),
    )
    // Smooth vertex 0 - neighbors are 1 (0.0) and 3 (0.5), average = 0.25
    // With single bone, normalized = 1.0 (only bone present)
    const result = system.dispatcher.dispatch(
      new SmoothWeightsCommand({
        nodeId: meshId,
        vertexIndices: [0],
        iterations: 1,
      }),
    )
    expectOk(result)
    const node = system.engine.getNode(meshId)
    const mesh = node.components.mesh!.mesh
    // Single bone: weight is 1.0 (only bone present)
    expect(mesh.boneWeights![0][0].weight).toBe(1.0)
  })

  it('smooths weights for multiple vertices', () => {
    const { system, boneId, meshId } = setupWithMeshAndBoneNodes()
    // Set weights on all vertices for proper smoothing
    system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 0,
        weights: [{ boneId, weight: 1.0 }],
      }),
    )
    system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 1,
        weights: [{ boneId, weight: 0.0 }],
      }),
    )
    system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 2,
        weights: [{ boneId, weight: 0.5 }],
      }),
    )
    system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 3,
        weights: [{ boneId, weight: 0.5 }],
      }),
    )
    const result = system.dispatcher.dispatch(
      new SmoothWeightsCommand({
        nodeId: meshId,
        vertexIndices: [0, 1],
        iterations: 1,
      }),
    )
    expectOk(result)
    const node = system.engine.getNode(meshId)
    const mesh = node.components.mesh!.mesh
    // Both should have averaged values
    expect(mesh.boneWeights![0][0].weight).toBeGreaterThan(0)
    expect(mesh.boneWeights![1][0].weight).toBeGreaterThan(0)
  })

  it('rejects empty vertex indices', () => {
    const { system, meshId } = setupWithMeshAndBoneNodes()
    const result = system.dispatcher.dispatch(
      new SmoothWeightsCommand({
        nodeId: meshId,
        vertexIndices: [],
        iterations: 1,
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/at least one/i)
    }
  })

  it('rejects zero iterations', () => {
    const { system, meshId } = setupWithMeshAndBoneNodes()
    const result = system.dispatcher.dispatch(
      new SmoothWeightsCommand({
        nodeId: meshId,
        vertexIndices: [0],
        iterations: 0,
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/at least 1/i)
    }
  })

  it('rejects node without mesh component', () => {
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
      new SmoothWeightsCommand({
        nodeId,
        vertexIndices: [0],
        iterations: 1,
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/mesh component/i)
    }
  })

  it('serializes to JSON', () => {
    const cmd = new SmoothWeightsCommand({
      nodeId: 'n1',
      vertexIndices: [0, 2],
      iterations: 3,
    })
    expect(cmd.toJSON()).toEqual({
      type: 'SmoothWeights',
      nodeId: 'n1',
      vertexIndices: [0, 2],
      iterations: 3,
    })
  })
})

describe('Mesh Deformation Evaluation', () => {
  it('returns original vertices when no bone weights are set', () => {
    const mesh = createDefaultRectangleMesh(160, 100)
    const result = evaluateMeshDeformation(mesh, new Map())
    expect(result.deformedVertices).toEqual(mesh.vertices)
  })

  it('returns original vertices when bone weights are empty', () => {
    const mesh = createDefaultRectangleMesh(160, 100)
    const meshWithEmptyWeights: MeshData = {
      ...mesh,
      boneWeights: [],
    }
    const result = evaluateMeshDeformation(meshWithEmptyWeights, new Map())
    expect(result.deformedVertices).toEqual(mesh.vertices)
  })

  it('deforms vertices based on bone transforms', () => {
    const mesh = createDefaultRectangleMesh(160, 100)
    // Assign bone weights - all vertices fully influenced by bone1
    const meshWithWeights: MeshData = {
      ...mesh,
      boneWeights: [
        [{ boneId: 'bone1', weight: 1.0 }],
        [{ boneId: 'bone1', weight: 1.0 }],
        [{ boneId: 'bone1', weight: 1.0 }],
        [{ boneId: 'bone1', weight: 1.0 }],
      ],
    }
    // Bone world transform: translated by (50, 30) — position is NOT applied
    const boneTransforms = new Map([['bone1', { x: 50, y: 30, rotation: 0, scaleX: 1, scaleY: 1 }]])
    const result = evaluateMeshDeformation(meshWithWeights, boneTransforms)
    // Only rotation and scale are applied, not bone position
    expect(result.deformedVertices[0].x).toBeCloseTo(0)
    expect(result.deformedVertices[0].y).toBeCloseTo(0)
    expect(result.deformedVertices[1].x).toBeCloseTo(160)
    expect(result.deformedVertices[1].y).toBeCloseTo(0)
    expect(result.deformedVertices[2].x).toBeCloseTo(160)
    expect(result.deformedVertices[2].y).toBeCloseTo(100)
    expect(result.deformedVertices[3].x).toBeCloseTo(0)
    expect(result.deformedVertices[3].y).toBeCloseTo(100)
  })

  it('applies weighted blend of multiple bone transforms', () => {
    const mesh = createDefaultRectangleMesh(100, 100)
    // Vertex 0: 50% bone1, 50% bone2
    const meshWithWeights: MeshData = {
      ...mesh,
      boneWeights: [
        [
          { boneId: 'bone1', weight: 0.5 },
          { boneId: 'bone2', weight: 0.5 },
        ],
        [{ boneId: 'bone1', weight: 1.0 }],
        [{ boneId: 'bone2', weight: 1.0 }],
        [
          { boneId: 'bone1', weight: 0.5 },
          { boneId: 'bone2', weight: 0.5 },
        ],
      ],
    }
    // bone1: scale 2x on X, bone2: scale 2x on Y — position NOT applied
    const boneTransforms = new Map([
      ['bone1', { x: 100, y: 0, rotation: 0, scaleX: 2, scaleY: 1 }],
      ['bone2', { x: 0, y: 100, rotation: 0, scaleX: 1, scaleY: 2 }],
    ])
    const result = evaluateMeshDeformation(meshWithWeights, boneTransforms)
    // Vertex 0: 50% * (0*2, 0*1) + 50% * (0*1, 0*2) = (0, 0)
    expect(result.deformedVertices[0].x).toBeCloseTo(0)
    expect(result.deformedVertices[0].y).toBeCloseTo(0)
    // Vertex 1: fully bone1 → (100*2, 0*1) = (200, 0)
    expect(result.deformedVertices[1].x).toBeCloseTo(200)
    expect(result.deformedVertices[1].y).toBeCloseTo(0)
    // Vertex 2: fully bone2 → (100*1, 100*2) = (100, 200)
    expect(result.deformedVertices[2].x).toBeCloseTo(100)
    expect(result.deformedVertices[2].y).toBeCloseTo(200)
  })

  it('applies bone rotation to deformed vertices', () => {
    // Simple 2-vertex mesh along X axis
    const simpleMesh: MeshData = {
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      faces: [],
      uvs: [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
      ],
      boneWeights: [[{ boneId: 'bone1', weight: 1.0 }], [{ boneId: 'bone1', weight: 1.0 }]],
    }
    // Bone rotated 90 degrees (PI/2 radians)
    const boneTransforms = new Map([
      ['bone1', { x: 0, y: 0, rotation: Math.PI / 2, scaleX: 1, scaleY: 1 }],
    ])
    const result = evaluateMeshDeformation(simpleMesh, boneTransforms)
    // After 90 degree rotation: (100, 0) -> (0, 100)
    expect(result.deformedVertices[0].x).toBeCloseTo(0)
    expect(result.deformedVertices[0].y).toBeCloseTo(0)
    expect(result.deformedVertices[1].x).toBeCloseTo(0)
    expect(result.deformedVertices[1].y).toBeCloseTo(100)
  })

  it('applies bone scale to deformed vertices', () => {
    const simpleMesh: MeshData = {
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      faces: [],
      uvs: [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
      ],
      boneWeights: [[{ boneId: 'bone1', weight: 1.0 }], [{ boneId: 'bone1', weight: 1.0 }]],
    }
    // Bone scaled 2x on X
    const boneTransforms = new Map([['bone1', { x: 0, y: 0, rotation: 0, scaleX: 2, scaleY: 1 }]])
    const result = evaluateMeshDeformation(simpleMesh, boneTransforms)
    expect(result.deformedVertices[1].x).toBeCloseTo(200)
    expect(result.deformedVertices[1].y).toBeCloseTo(0)
  })

  it('is deterministic', () => {
    const mesh = createDefaultRectangleMesh(100, 100)
    const meshWithWeights: MeshData = {
      ...mesh,
      boneWeights: [
        [
          { boneId: 'bone1', weight: 0.7 },
          { boneId: 'bone2', weight: 0.3 },
        ],
        [
          { boneId: 'bone1', weight: 0.5 },
          { boneId: 'bone2', weight: 0.5 },
        ],
        [
          { boneId: 'bone1', weight: 0.3 },
          { boneId: 'bone2', weight: 0.7 },
        ],
        [
          { boneId: 'bone1', weight: 0.7 },
          { boneId: 'bone2', weight: 0.3 },
        ],
      ],
    }
    const boneTransforms = new Map([
      ['bone1', { x: 50, y: 25, rotation: 0.5, scaleX: 1.2, scaleY: 0.8 }],
      ['bone2', { x: -30, y: 40, rotation: -0.3, scaleX: 0.9, scaleY: 1.1 }],
    ])
    const result1 = evaluateMeshDeformation(meshWithWeights, boneTransforms)
    const result2 = evaluateMeshDeformation(meshWithWeights, boneTransforms)
    for (let i = 0; i < result1.deformedVertices.length; i++) {
      expect(result1.deformedVertices[i].x).toBe(result2.deformedVertices[i].x)
      expect(result1.deformedVertices[i].y).toBe(result2.deformedVertices[i].y)
    }
  })
})

describe('Mesh Data Serialization', () => {
  it('serializes and deserializes mesh with bone weights', () => {
    const mesh = createDefaultRectangleMesh(100, 100)
    const meshWithWeights: MeshData = {
      ...mesh,
      boneWeights: [
        [{ boneId: 'b1', weight: 1.0 }],
        [
          { boneId: 'b1', weight: 0.8 },
          { boneId: 'b2', weight: 0.2 },
        ],
        [{ boneId: 'b2', weight: 1.0 }],
        [
          { boneId: 'b1', weight: 0.5 },
          { boneId: 'b2', weight: 0.5 },
        ],
      ],
    }
    // Serialize to JSON via meshDataFromJSON round-trip
    const json = {
      vertices: meshWithWeights.vertices,
      faces: meshWithWeights.faces,
      uvs: meshWithWeights.uvs,
      boneWeights: meshWithWeights.boneWeights,
    }
    const restored = meshDataFromJSON(json)
    expect(restored.boneWeights).toBeDefined()
    expect(restored.boneWeights).toHaveLength(4)
    expect(restored.boneWeights![0]).toEqual([{ boneId: 'b1', weight: 1.0 }])
    expect(restored.boneWeights![1]).toEqual([
      { boneId: 'b1', weight: 0.8 },
      { boneId: 'b2', weight: 0.2 },
    ])
  })

  it('deserializes mesh without bone weights (backward compatibility)', () => {
    const json = {
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      faces: [
        { v0: 0, v1: 1, v2: 2 },
        { v0: 0, v1: 2, v2: 3 },
      ],
      uvs: [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 1, v: 1 },
        { u: 0, v: 1 },
      ],
    }
    const restored = meshDataFromJSON(json)
    expect(restored.boneWeights).toBeUndefined()
  })

  it('rejects boneWeights with mismatched length', () => {
    const json = {
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      faces: [{ v0: 0, v1: 1, v2: 0 }],
      uvs: [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
      ],
      boneWeights: [[{ boneId: 'b1', weight: 1.0 }]],
    }
    expect(() => meshDataFromJSON(json)).toThrow(/boneWeights length must match/)
  })

  it('meshDataToJSON serializes mesh with bone weights', () => {
    const mesh: MeshData = {
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      faces: [{ v0: 0, v1: 1, v2: 0 }],
      uvs: [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
      ],
      boneWeights: [[{ boneId: 'b1', weight: 1.0 }], [{ boneId: 'b1', weight: 0.5 }]],
    }
    const json = meshDataToJSON(mesh)
    expect(json.boneWeights).toBeDefined()
    expect(json.boneWeights).toHaveLength(2)
    expect(json.boneWeights![0]).toEqual([{ boneId: 'b1', weight: 1.0 }])
  })

  it('meshDataToJSON serializes mesh without bone weights', () => {
    const mesh = createDefaultRectangleMesh(100, 100)
    const json = meshDataToJSON(mesh)
    expect(json.boneWeights).toBeUndefined()
  })
})

describe('SmoothWeights normalization', () => {
  it('normalizes weights after smoothing so they sum to 1', () => {
    const { system, boneId, meshId } = setupWithMeshAndBoneNodes()
    // Set up: vertex 0 has bone1=1.0, neighbors have disjoint bone sets
    // vertex 1 has bone2=1.0 (via different bone - use different bone node)
    const slide = system.engine.project!.slides[0]
    const { nodeId: bone2Id } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Bone2',
          components: { bone: { kind: 'bone', length: 100 } },
        }),
      ),
    )
    system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 0,
        weights: [{ boneId, weight: 1.0 }],
      }),
    )
    system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 1,
        weights: [{ boneId: bone2Id, weight: 1.0 }],
      }),
    )
    system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 2,
        weights: [
          { boneId, weight: 0.5 },
          { boneId: bone2Id, weight: 0.5 },
        ],
      }),
    )
    system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 3,
        weights: [
          { boneId, weight: 0.5 },
          { boneId: bone2Id, weight: 0.5 },
        ],
      }),
    )
    system.dispatcher.dispatch(
      new SmoothWeightsCommand({
        nodeId: meshId,
        vertexIndices: [0],
        iterations: 1,
      }),
    )
    const node = system.engine.getNode(meshId)
    const mesh = node.components.mesh!.mesh
    // Vertex 0 neighbors: 1 (bone2=1.0) and 3 (bone1=0.5, bone2=0.5)
    // Averaged: bone1 = 0.5/1 = 0.5, bone2 = (1.0+0.5)/2 = 0.75
    // Normalized: bone1 = 0.5/1.25 = 0.4, bone2 = 0.75/1.25 = 0.6
    const total = mesh.boneWeights![0].reduce((sum, w) => sum + w.weight, 0)
    expect(total).toBeCloseTo(1.0)
  })
})

describe('AutoWeightsCommand', () => {
  it('assigns weights based on bone proximity', () => {
    const { system, boneId, meshId } = setupWithMeshAndBoneNodes()
    const result = system.dispatcher.dispatch(
      new AutoWeightsCommand({
        nodeId: meshId,
        boneIds: [boneId],
        falloff: 2,
      }),
    )
    expectOk(result)
    const node = system.engine.getNode(meshId)
    const mesh = node.components.mesh!.mesh
    expect(mesh.boneWeights).toBeDefined()
    expect(mesh.boneWeights!.length).toBe(mesh.vertices.length)
    // All vertices should have weight 1.0 for the single bone
    for (const vertexWeights of mesh.boneWeights!) {
      expect(vertexWeights.length).toBe(1)
      expect(vertexWeights[0].boneId).toBe(boneId)
      expect(vertexWeights[0].weight).toBeCloseTo(1.0)
    }
  })

  it('rejects empty bone ids', () => {
    const { system, meshId } = setupWithMeshAndBoneNodes()
    const result = system.dispatcher.dispatch(
      new AutoWeightsCommand({
        nodeId: meshId,
        boneIds: [],
        falloff: 2,
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/at least one/i)
    }
  })

  it('rejects unknown bone id', () => {
    const { system, meshId } = setupWithMeshAndBoneNodes()
    const result = system.dispatcher.dispatch(
      new AutoWeightsCommand({
        nodeId: meshId,
        boneIds: ['unknown-bone'],
        falloff: 2,
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/unknown bone/i)
    }
  })
})

describe('PaintWeightCommand', () => {
  it('adds weight to a vertex', () => {
    const { system, boneId, meshId } = setupWithMeshAndBoneNodes()
    const result = system.dispatcher.dispatch(
      new PaintWeightCommand({
        nodeId: meshId,
        vertexIndex: 0,
        boneId,
        strength: 0.5,
        mode: 'add',
      }),
    )
    expectOk(result)
    const node = system.engine.getNode(meshId)
    const mesh = node.components.mesh!.mesh
    expect(mesh.boneWeights).toBeDefined()
    expect(mesh.boneWeights![0].length).toBe(1)
    expect(mesh.boneWeights![0][0].boneId).toBe(boneId)
    expect(mesh.boneWeights![0][0].weight).toBeCloseTo(1.0) // normalized
  })

  it('removes weight from a vertex', () => {
    const { system, boneId, meshId } = setupWithMeshAndBoneNodes()
    // First set weight
    system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 0,
        weights: [{ boneId, weight: 0.8 }],
      }),
    )
    // Remove some weight
    const result = system.dispatcher.dispatch(
      new PaintWeightCommand({
        nodeId: meshId,
        vertexIndex: 0,
        boneId,
        strength: 0.3,
        mode: 'remove',
      }),
    )
    expectOk(result)
    const node = system.engine.getNode(meshId)
    const mesh = node.components.mesh!.mesh
    // Single bone: weight is always 1.0 after normalization
    expect(mesh.boneWeights![0][0].weight).toBeCloseTo(1.0)
  })

  it('sets absolute weight', () => {
    const { system, boneId, meshId } = setupWithMeshAndBoneNodes()
    const result = system.dispatcher.dispatch(
      new PaintWeightCommand({
        nodeId: meshId,
        vertexIndex: 0,
        boneId,
        strength: 0.7,
        mode: 'set',
      }),
    )
    expectOk(result)
    const node = system.engine.getNode(meshId)
    const mesh = node.components.mesh!.mesh
    // Single bone: weight is always 1.0 after normalization
    expect(mesh.boneWeights![0][0].weight).toBeCloseTo(1.0)
  })

  it('rejects unknown bone id', () => {
    const { system, meshId } = setupWithMeshAndBoneNodes()
    const result = system.dispatcher.dispatch(
      new PaintWeightCommand({
        nodeId: meshId,
        vertexIndex: 0,
        boneId: 'unknown-bone',
        strength: 0.5,
        mode: 'add',
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/unknown bone/i)
    }
  })
})

describe('BlurWeightsCommand', () => {
  it('blurs weights across the mesh', () => {
    const { system, boneId, meshId } = setupWithMeshAndBoneNodes()
    // Set different weights on vertices
    system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 0,
        weights: [{ boneId, weight: 1.0 }],
      }),
    )
    system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 1,
        weights: [{ boneId, weight: 0.0 }],
      }),
    )
    system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 2,
        weights: [{ boneId, weight: 0.5 }],
      }),
    )
    system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 3,
        weights: [{ boneId, weight: 0.5 }],
      }),
    )
    const result = system.dispatcher.dispatch(
      new BlurWeightsCommand({
        nodeId: meshId,
        iterations: 1,
        strength: 0.5,
      }),
    )
    expectOk(result)
    const node = system.engine.getNode(meshId)
    const mesh = node.components.mesh!.mesh
    // All vertices should have some weight (blurred)
    for (const vertexWeights of mesh.boneWeights!) {
      expect(vertexWeights.length).toBe(1)
      expect(vertexWeights[0].weight).toBeGreaterThan(0)
      expect(vertexWeights[0].weight).toBeLessThanOrEqual(1)
    }
  })

  it('rejects zero iterations', () => {
    const { system, meshId } = setupWithMeshAndBoneNodes()
    const result = system.dispatcher.dispatch(
      new BlurWeightsCommand({
        nodeId: meshId,
        iterations: 0,
        strength: 0.5,
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/at least 1/i)
    }
  })
})

describe('FillWeightsCommand', () => {
  it('fills selected vertices with uniform weight', () => {
    const { system, boneId, meshId } = setupWithMeshAndBoneNodes()
    const result = system.dispatcher.dispatch(
      new FillWeightsCommand({
        nodeId: meshId,
        vertexIndices: [0, 1],
        boneId,
        weight: 0.6,
      }),
    )
    expectOk(result)
    const node = system.engine.getNode(meshId)
    const mesh = node.components.mesh!.mesh
    // Single bone: weight is always 1.0 after normalization
    expect(mesh.boneWeights![0][0].weight).toBeCloseTo(1.0)
    expect(mesh.boneWeights![1][0].weight).toBeCloseTo(1.0)
  })

  it('rejects empty vertex indices', () => {
    const { system, meshId } = setupWithMeshAndBoneNodes()
    const result = system.dispatcher.dispatch(
      new FillWeightsCommand({
        nodeId: meshId,
        vertexIndices: [],
        boneId: 'bone',
        weight: 0.5,
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/at least one/i)
    }
  })

  it('rejects unknown bone id', () => {
    const { system, meshId } = setupWithMeshAndBoneNodes()
    const result = system.dispatcher.dispatch(
      new FillWeightsCommand({
        nodeId: meshId,
        vertexIndices: [0],
        boneId: 'unknown-bone',
        weight: 0.5,
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/unknown bone/i)
    }
  })
})

describe('Engine.evaluateMeshDeformation', () => {
  it('returns null for node without mesh component', () => {
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
          name: 'BoneNode',
          components: { bone: { kind: 'bone', length: 100 } },
        }),
      ),
    )
    const result = system.engine.evaluateMeshDeformation(nodeId, 0, new Map())
    expect(result).toBeNull()
  })

  it('evaluates mesh deformation through engine', () => {
    const { system, boneId, meshId } = setupWithMeshAndBoneNodes()
    // Assign weights
    system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 0,
        weights: [{ boneId, weight: 1.0 }],
      }),
    )
    system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 1,
        weights: [{ boneId, weight: 1.0 }],
      }),
    )
    system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 2,
        weights: [{ boneId, weight: 1.0 }],
      }),
    )
    system.dispatcher.dispatch(
      new SetVertexWeightsCommand({
        nodeId: meshId,
        vertexIndex: 3,
        weights: [{ boneId, weight: 1.0 }],
      }),
    )

    // Create bone world transforms
    const boneWorldTransforms = new Map([
      [boneId, { x: 50, y: 30, rotation: 0, scaleX: 1, scaleY: 1 }],
    ])

    const result = system.engine.evaluateMeshDeformation(meshId, 0, boneWorldTransforms)
    expect(result).not.toBeNull()
    expect(result!.deformedVertices).toHaveLength(4)
    // With rotation 0 and scale 1, vertices stay at original positions
    // (bone position is not applied — only rotation and scale are)
    expect(result!.deformedVertices[0].x).toBeCloseTo(0)
    expect(result!.deformedVertices[0].y).toBeCloseTo(0)
    expect(result!.deformedVertices[1].x).toBeCloseTo(160)
    expect(result!.deformedVertices[1].y).toBeCloseTo(0)
  })

  it('returns original vertices when no bone weights are set', () => {
    const { system, meshId } = setupWithMeshAndBoneNodes()
    const boneWorldTransforms = new Map()
    const result = system.engine.evaluateMeshDeformation(meshId, 0, boneWorldTransforms)
    expect(result).not.toBeNull()
    // Without bone weights, returns original vertices
    const node = system.engine.getNode(meshId)
    const mesh = node.components.mesh!.mesh
    expect(result!.deformedVertices).toEqual(mesh.vertices)
  })
})
