import { describe, expect, it } from 'vitest'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import { deserialize, serialize } from '../../engine/lessonSerializer'
import type { MeshData } from '../../engine/mesh'
import { createDefaultRectangleMesh } from '../../engine/mesh'
import type { LessonJSON } from '../../engine/json'
import { createCommandSystem } from '../../engine/commands'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  GenerateMeshCommand,
} from '../../engine/commands'

function createGeneratedMesh(): MeshData {
  return {
    vertices: [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 80 },
      { x: 0, y: 80 },
      { x: 25, y: 40 },
    ],
    faces: [
      { v0: 0, v1: 1, v2: 4 },
      { v0: 1, v1: 2, v2: 4 },
      { v0: 2, v1: 3, v2: 4 },
      { v0: 3, v1: 0, v2: 4 },
    ],
    uvs: [
      { u: 0, v: 0 },
      { u: 0.5, v: 0 },
      { u: 0.5, v: 0.8 },
      { u: 0, v: 0.8 },
      { u: 0.25, v: 0.4 },
    ],
  }
}

function createMeshWithBoneWeights(): MeshData {
  const base = createGeneratedMesh()
  return {
    ...base,
    boneWeights: [
      [
        { boneId: 'spine', weight: 0.9 },
        { boneId: 'left-arm', weight: 0.1 },
      ],
      [
        { boneId: 'spine', weight: 0.5 },
        { boneId: 'right-arm', weight: 0.5 },
      ],
      [
        { boneId: 'right-arm', weight: 0.8 },
        { boneId: 'spine', weight: 0.2 },
      ],
      [
        { boneId: 'left-arm', weight: 0.8 },
        { boneId: 'spine', weight: 0.2 },
      ],
      [{ boneId: 'spine', weight: 1.0 }],
    ],
    bindPose: {
      spine: { x: 25, y: 40, rotation: 0, scaleX: 1, scaleY: 1 },
      'left-arm': { x: 0, y: 20, rotation: -0.3, scaleX: 1, scaleY: 1 },
      'right-arm': { x: 50, y: 20, rotation: 0.3, scaleX: 1, scaleY: 1 },
    },
  }
}

function setupWithAssetNode(
  engine: Engine,
  name = 'AssetNode',
  definitionId = 'test-asset',
): string {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const node = engine.createNode(slide.scene.id, slide.scene.root.id, name, {
    components: {
      assetInstance: { kind: 'assetInstance', assetDefinitionId: definitionId },
    },
  })
  return node.id
}

describe('generated mesh persistence through .lesson serialization', () => {
  it('round-trips vertices, faces, and UVs exactly', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Generated Mesh Test' })
    engine.createSlide('Slide 1')
    const nodeId = setupWithAssetNode(engine)
    const mesh = createGeneratedMesh()
    engine.setMeshData(nodeId, mesh)

    const json = engine.toJSON()
    const restored = createEngine()
    restored.restoreFromJSON(json)

    const restoredNode = restored.getNode(nodeId)
    expect(restoredNode.components.mesh).toBeDefined()
    expect(restoredNode.components.mesh!.mesh.vertices).toEqual(mesh.vertices)
    expect(restoredNode.components.mesh!.mesh.faces).toEqual(mesh.faces)
    expect(restoredNode.components.mesh!.mesh.uvs).toEqual(mesh.uvs)
  })

  it('round-trips bone weights and bind pose', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Bone Mesh Test' })
    engine.createSlide('Slide 1')
    const nodeId = setupWithAssetNode(engine)
    const mesh = createMeshWithBoneWeights()
    engine.setMeshData(nodeId, mesh)

    const json = engine.toJSON()
    const restored = createEngine()
    restored.restoreFromJSON(json)

    const restoredNode = restored.getNode(nodeId)
    const restoredMesh = restoredNode.components.mesh!.mesh
    expect(restoredMesh.boneWeights).toEqual(mesh.boneWeights)
    expect(restoredMesh.bindPose).toEqual(mesh.bindPose)
    expect(restoredMesh.boneWeights).toHaveLength(5)
    expect(restoredMesh.boneWeights![0]).toHaveLength(2)
    expect(restoredMesh.boneWeights![0][0].boneId).toBe('spine')
    expect(restoredMesh.boneWeights![0][0].weight).toBe(0.9)
    expect(restoredMesh.bindPose!.spine.x).toBe(25)
    expect(restoredMesh.bindPose!['left-arm'].rotation).toBe(-0.3)
  })

  it('round-trips through serialize/deserialize (string format)', () => {
    const engine = createEngine()
    engine.createProject({ name: 'String Round Trip' })
    engine.createSlide('Slide 1')
    const nodeId = setupWithAssetNode(engine)
    const mesh = createMeshWithBoneWeights()
    engine.setMeshData(nodeId, mesh)

    const text = serialize(engine.project!)
    const restored = deserialize(text)

    const restoredNode = restored.slides[0]?.scene.getNode(nodeId)
    expect(restoredNode?.components.mesh).toBeDefined()
    expect(restoredNode?.components.mesh!.mesh.vertices).toEqual(mesh.vertices)
    expect(restoredNode?.components.mesh!.mesh.boneWeights).toEqual(mesh.boneWeights)
    expect(restoredNode?.components.mesh!.mesh.bindPose).toEqual(mesh.bindPose)
  })

  it('preserves mesh data alongside asset instance component', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Asset + Mesh' })
    engine.createSlide('Slide 1')
    const nodeId = setupWithAssetNode(engine, 'Character', 'char-def')
    const mesh = createGeneratedMesh()
    engine.setMeshData(nodeId, mesh)

    const json = engine.toJSON()
    const restored = createEngine()
    restored.restoreFromJSON(json)

    const restoredNode = restored.getNode(nodeId)
    expect(restoredNode.components.assetInstance).toBeDefined()
    expect(restoredNode.components.assetInstance!.assetDefinitionId).toBe('char-def')
    expect(restoredNode.components.mesh).toBeDefined()
    expect(restoredNode.components.mesh!.mesh.vertices).toEqual(mesh.vertices)
  })

  it('serializes mesh data into the JSON structure correctly', () => {
    const engine = createEngine()
    engine.createProject({ name: 'JSON Structure' })
    engine.createSlide('Slide 1')
    const nodeId = setupWithAssetNode(engine)
    const mesh = createMeshWithBoneWeights()
    engine.setMeshData(nodeId, mesh)

    const json = JSON.parse(serialize(engine.project!)) as LessonJSON
    const nodeJson = json.slides[0]?.scene.nodes.find((n) => n.id === nodeId)
    expect(nodeJson).toBeDefined()
    const meshJson = nodeJson!.components.mesh
    expect(meshJson).toBeDefined()
    expect(meshJson!.kind).toBe('mesh')
    expect(meshJson!.mesh.vertices).toEqual(mesh.vertices)
    expect(meshJson!.mesh.faces).toEqual(mesh.faces)
    expect(meshJson!.mesh.uvs).toEqual(mesh.uvs)
    expect(meshJson!.mesh.boneWeights).toEqual(mesh.boneWeights)
    expect(meshJson!.mesh.bindPose).toEqual(mesh.bindPose)
  })

  it('density is not serialized in the mesh data', () => {
    const engine = createEngine()
    engine.createProject({ name: 'No Density' })
    engine.createSlide('Slide 1')
    const nodeId = setupWithAssetNode(engine)
    const mesh = createGeneratedMesh()
    engine.setMeshData(nodeId, mesh)

    const json = JSON.parse(serialize(engine.project!)) as LessonJSON
    const nodeJson = json.slides[0]?.scene.nodes.find((n) => n.id === nodeId)
    const meshJson = nodeJson!.components.mesh!.mesh
    expect(meshJson).not.toHaveProperty('density')
    expect(meshJson).not.toHaveProperty('generationRecipe')
    expect(meshJson).not.toHaveProperty('maxEdgeLength')
  })

  it('does not serialize generation metadata beyond mesh data fields', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Clean Mesh' })
    engine.createSlide('Slide 1')
    const nodeId = setupWithAssetNode(engine)
    const mesh = createGeneratedMesh()
    engine.setMeshData(nodeId, mesh)

    const json = JSON.parse(serialize(engine.project!)) as LessonJSON
    const nodeJson = json.slides[0]?.scene.nodes.find((n) => n.id === nodeId)
    const meshJson = nodeJson!.components.mesh!.mesh
    const allowedKeys = new Set(['vertices', 'faces', 'uvs', 'boneWeights', 'bindPose'])
    for (const key of Object.keys(meshJson)) {
      expect(allowedKeys.has(key)).toBe(true)
    }
  })
})

describe('legacy project compatibility', () => {
  it('reads a project without any mesh components', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Legacy' })
    engine.createSlide('Slide 1')
    engine.createNode(
      engine.project!.slides[0].scene.id,
      engine.project!.slides[0].scene.root.id,
      'PlainNode',
    )

    const json = engine.toJSON()
    const restored = createEngine()
    restored.restoreFromJSON(json)

    const node = restored.project!.slides[0].scene.root.children[0]
    expect(node).toBeDefined()
    expect(node!.components.mesh).toBeUndefined()
  })

  it('reads a project with mesh but no bone weights or bind pose', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Legacy Mesh' })
    engine.createSlide('Slide 1')
    const slide = engine.project!.slides[0]
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'MeshNode', {
      components: { mesh: { kind: 'mesh', mesh: createDefaultRectangleMesh(100, 100) } },
    })

    const json = engine.toJSON()
    const restored = createEngine()
    restored.restoreFromJSON(json)

    const restoredNode = restored.getNode(node.id)
    expect(restoredNode.components.mesh).toBeDefined()
    expect(restoredNode.components.mesh!.mesh.vertices).toHaveLength(4)
    expect(restoredNode.components.mesh!.mesh.boneWeights).toBeUndefined()
    expect(restoredNode.components.mesh!.mesh.bindPose).toBeUndefined()
  })

  it('reads a project with mesh and bone weights but no bind pose', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Weights Only' })
    engine.createSlide('Slide 1')
    const slide = engine.project!.slides[0]
    const mesh: MeshData = {
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
        [{ boneId: 'b1', weight: 1.0 }],
        [
          { boneId: 'b1', weight: 0.5 },
          { boneId: 'b2', weight: 0.5 },
        ],
        [{ boneId: 'b2', weight: 1.0 }],
      ],
    }
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'WeightedNode', {
      components: { mesh: { kind: 'mesh', mesh } },
    })

    const json = engine.toJSON()
    const restored = createEngine()
    restored.restoreFromJSON(json)

    const restoredNode = restored.getNode(node.id)
    expect(restoredNode.components.mesh!.mesh.boneWeights).toEqual(mesh.boneWeights)
    expect(restoredNode.components.mesh!.mesh.bindPose).toBeUndefined()
  })

  it('skips mesh data with invalid structure gracefully', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Corrupt Mesh' })
    engine.createSlide('Slide 1')
    const slide = engine.project!.slides[0]
    const rootId = slide.scene.root.id

    const json = engine.toJSON()
    const corrupt: LessonJSON = {
      ...json,
      slides: [
        {
          id: slide.id,
          name: slide.name,
          duration: slide.duration,
          scene: {
            id: slide.scene.id,
            nodes: [
              ...json.slides[0]!.scene.nodes,
              {
                id: 'bad-mesh',
                name: 'BadMesh',
                parentId: rootId,
                transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
                visible: true,
                components: {
                  mesh: {
                    kind: 'mesh',
                    mesh: { vertices: 'not-an-array', faces: [], uvs: [] },
                  },
                },
              } as unknown as LessonJSON['slides'][0]['scene']['nodes'][0],
            ],
          },
        },
      ],
    }

    expect(() => deserialize(serialize(corrupt as never))).toThrow()
  })
})

describe('embedded asset snapshot with generated MeshComponent', () => {
  it('restores embedded asset alongside node mesh after round-trip', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Snapshot + Mesh' })
    engine.createSlide('Slide 1')
    engine.embedAsset({
      id: 'char-def',
      name: 'Character',
      data: 'iVBORw0KGgoAAAANSUhEUg==',
      mimeType: 'image/png',
      metadata: { category: 'Character' },
    })
    const nodeId = setupWithAssetNode(engine, 'Hero', 'char-def')
    const mesh = createMeshWithBoneWeights()
    engine.setMeshData(nodeId, mesh)

    const text = serialize(engine.project!)
    const restored = deserialize(text)

    expect(restored.embeddedAssets).toHaveLength(1)
    expect(restored.embeddedAssets[0].id).toBe('char-def')
    expect(restored.embeddedAssets[0].metadata).toEqual({ category: 'Character' })
    const restoredNode = restored.slides[0]?.scene.getNode(nodeId)
    expect(restoredNode?.components.assetInstance?.assetDefinitionId).toBe('char-def')
    expect(restoredNode?.components.mesh).toBeDefined()
    expect(restoredNode?.components.mesh!.mesh.vertices).toEqual(mesh.vertices)
    expect(restoredNode?.components.mesh!.mesh.boneWeights).toEqual(mesh.boneWeights)
  })

  it('restores asset snapshot and mesh through engine restoreFromJSON', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Engine Restore' })
    engine.createSlide('Slide 1')
    engine.embedAsset({
      id: 'hero',
      name: 'Hero',
      data: 'QUJD',
      mimeType: 'image/png',
    })
    const nodeId = setupWithAssetNode(engine, 'Hero Node', 'hero')
    const mesh = createGeneratedMesh()
    engine.setMeshData(nodeId, mesh)

    const json = engine.toJSON()
    const target = createEngine()
    target.restoreFromJSON(json)

    expect(target.embeddedAssets.map((a) => a.id)).toEqual(['hero'])
    expect(target.getEmbeddedAsset('hero')?.data).toBe('QUJD')
    expect(target.getEmbeddedAsset('hero')?.mimeType).toBe('image/png')
    const node = target.getNode(nodeId)
    expect(node.components.assetInstance?.assetDefinitionId).toBe('hero')
    expect(node.components.mesh?.mesh.vertices).toEqual(mesh.vertices)
    expect(node.components.mesh?.mesh.uvs).toEqual(mesh.uvs)
  })

  it('works with openProject on the target engine', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Open Project' })
    engine.createSlide('Slide 1')
    engine.embedAsset({
      id: 'asset-1',
      name: 'Asset',
      data: 'QUJDREU=',
      mimeType: 'image/png',
    })
    const nodeId = setupWithAssetNode(engine, 'Asset Node', 'asset-1')
    engine.setMeshData(nodeId, createGeneratedMesh())

    const project = engine.project!
    const target = createEngine()
    target.openProject(project)

    expect(target.embeddedAssets.map((a) => a.id)).toEqual(['asset-1'])
    const node = target.getNode(nodeId)
    expect(node.components.mesh?.mesh.vertices).toHaveLength(5)
  })
})

describe('GenerateMeshCommand persistence through serialization', () => {
  it('round-trips a generated mesh created via command system', () => {
    const system = createCommandSystem()
    system.dispatcher.dispatch(new CreateProjectCommand({ name: 'Command Test' }))
    system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' }))
    const slide = system.engine.project?.slides[0]
    if (!slide) throw new Error('expected a slide')

    const createResult = system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: 'Asset',
        components: {
          assetInstance: { kind: 'assetInstance', assetDefinitionId: 'test' },
        },
      }),
    )
    if (!createResult.ok) throw new Error('expected successful create')
    const nodeId = createResult.inverse.nodeId

    const mesh = createMeshWithBoneWeights()
    system.dispatcher.dispatch(new GenerateMeshCommand({ nodeId, mesh }))

    const json = system.engine.toJSON()
    const restored = createEngine()
    restored.restoreFromJSON(json)

    const restoredNode = restored.getNode(nodeId)
    expect(restoredNode.components.mesh).toBeDefined()
    expect(restoredNode.components.mesh!.mesh.vertices).toEqual(mesh.vertices)
    expect(restoredNode.components.mesh!.mesh.boneWeights).toEqual(mesh.boneWeights)
    expect(restoredNode.components.mesh!.mesh.bindPose).toEqual(mesh.bindPose)
  })

  it('preserves mesh through engine toJSON/restoreFromJSON cycle', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Engine Cycle' })
    engine.createSlide('Slide 1')
    const nodeId = setupWithAssetNode(engine)
    const mesh = createMeshWithBoneWeights()
    engine.setMeshData(nodeId, mesh)

    const json1 = engine.toJSON()
    const engine2 = createEngine()
    engine2.restoreFromJSON(json1)

    const json2 = engine2.toJSON()
    expect(json1).toEqual(json2)
  })
})
