import { describe, expect, it } from 'vitest'
import { createEngine } from '../engine/internal'
import type { Engine } from '../engine/internal'
import { createDefaultRectangleMesh } from '../engine/mesh'
import { collectBones, collectMeshes } from '../engine/riggingQueries'
import { walkPreOrder } from '../engine/sceneNode'

function setup(): Engine {
  const engine = createEngine()
  engine.createProject({ name: 'Test Project' })
  engine.createSlide('Slide 1')
  return engine
}

function createBoneNode(engine: Engine, name: string, parentId: string, x = 0, y = 0) {
  const slide = engine.project?.slides[0]
  if (!slide) throw new Error('No slide')
  return engine.createNode(slide.scene.id, parentId, name, {
    components: { bone: { kind: 'bone', length: 100 } },
    transform: { x, y, rotation: 0, scaleX: 1, scaleY: 1 },
  })
}

function createMeshNode(engine: Engine, name: string, parentId: string) {
  const slide = engine.project?.slides[0]
  if (!slide) throw new Error('No slide')
  const mesh = createDefaultRectangleMesh(100, 100)
  return engine.createNode(slide.scene.id, parentId, name, {
    components: { mesh: { kind: 'mesh', mesh } },
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  })
}

function collectAllConstraints(engine: Engine): { nodeId: string; constraintId: string }[] {
  const slide = engine.getActiveSlide()
  if (!slide) return []
  const results: { nodeId: string; constraintId: string }[] = []
  for (const node of walkPreOrder(slide.scene.root)) {
    const constraints = engine.getConstraintManager().getConstraintsForNode(node.id)
    for (const c of constraints) {
      results.push({ nodeId: node.id, constraintId: c.id })
    }
  }
  return results
}

describe('rigging panel — bone collection', () => {
  it('collects all bone nodes from the scene', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    createBoneNode(engine, 'Root', slide.scene.root.id, 0, 0)
    createBoneNode(engine, 'Child', slide.scene.root.id, 100, 0)
    createBoneNode(engine, 'Grandchild', slide.scene.root.id, 200, 0)

    const bones = collectBones(slide.scene.root)
    expect(bones).toHaveLength(3)
    expect(bones.map((b) => b.name)).toEqual(['Root', 'Child', 'Grandchild'])
  })

  it('returns empty array when no bones exist', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    engine.createNode(slide.scene.id, slide.scene.root.id, 'Regular Node', {
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })

    const bones = collectBones(slide.scene.root)
    expect(bones).toHaveLength(0)
  })

  it('includes bones nested under non-bone parents', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const group = engine.createNode(slide.scene.id, slide.scene.root.id, 'Group', {
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    createBoneNode(engine, 'Bone', group.id, 50, 50)

    const bones = collectBones(slide.scene.root)
    expect(bones).toHaveLength(1)
    expect(bones[0].name).toBe('Bone')
  })

  it('preserves hierarchy order in collected bones', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const root = createBoneNode(engine, 'Root', slide.scene.root.id, 0, 0)
    const child = createBoneNode(engine, 'Child', root.id, 100, 0)
    createBoneNode(engine, 'Grandchild', child.id, 200, 0)

    const bones = collectBones(slide.scene.root)
    expect(bones).toHaveLength(3)
    expect(bones[0].id).toBe(root.id)
    expect(bones[1].id).toBe(child.id)
    expect(bones[2].id).toBe(child.children[0].id)
  })
})

describe('rigging panel — IK chain queries', () => {
  it('lists IK chains for the active slide', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone1 = createBoneNode(engine, 'Bone1', slide.scene.root.id, 0, 0)
    const bone2 = createBoneNode(engine, 'Bone2', bone1.id, 100, 0)

    engine.createIKChain(slide.id, [bone1.id, bone2.id], { position: { x: 200, y: 0 } })

    const chains = engine.getIKManager().getChainsForSlide(slide.id)
    expect(chains).toHaveLength(1)
  })

  it('returns empty when no IK chains exist', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const chains = engine.getIKManager().getChainsForSlide(slide.id)
    expect(chains).toHaveLength(0)
  })

  it('finds IK chains for a specific bone', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone1 = createBoneNode(engine, 'Bone1', slide.scene.root.id, 0, 0)
    const bone2 = createBoneNode(engine, 'Bone2', bone1.id, 100, 0)
    const bone3 = createBoneNode(engine, 'Bone3', bone2.id, 200, 0)

    engine.createIKChain(slide.id, [bone1.id, bone2.id], { position: { x: 200, y: 0 } })
    engine.createIKChain(slide.id, [bone2.id, bone3.id], { position: { x: 300, y: 0 } })

    const chainsForBone2 = engine.getIKManager().getChainsForBone(bone2.id)
    expect(chainsForBone2).toHaveLength(2)
  })
})

describe('rigging panel — constraint queries', () => {
  it('lists constraints for a node', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone = createBoneNode(engine, 'Bone', slide.scene.root.id, 0, 0)

    engine.addConstraint(bone.id, 'rotationLimit', 0, {
      minRotation: -45,
      maxRotation: 45,
    })
    engine.addConstraint(bone.id, 'rotationLimit', 1, {
      minRotation: -30,
      maxRotation: 30,
    })

    const constraints = engine.getConstraintManager().getConstraintsForNode(bone.id)
    expect(constraints).toHaveLength(2)
    expect(constraints[0].type).toBe('rotationLimit')
    expect(constraints[1].type).toBe('rotationLimit')
  })

  it('returns empty when no constraints exist', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone = createBoneNode(engine, 'Bone', slide.scene.root.id, 0, 0)

    const constraints = engine.getConstraintManager().getConstraintsForNode(bone.id)
    expect(constraints).toHaveLength(0)
  })

  it('returns empty for a node with no constraints', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone1 = createBoneNode(engine, 'Bone1', slide.scene.root.id, 0, 0)
    const bone2 = createBoneNode(engine, 'Bone2', slide.scene.root.id, 100, 0)

    engine.addConstraint(bone1.id, 'rotationLimit', 0, {
      minRotation: -45,
      maxRotation: 45,
    })

    const constraints = engine.getConstraintManager().getConstraintsForNode(bone2.id)
    expect(constraints).toHaveLength(0)
  })

  it('collects all constraints across all nodes', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone1 = createBoneNode(engine, 'Bone1', slide.scene.root.id, 0, 0)
    const bone2 = createBoneNode(engine, 'Bone2', slide.scene.root.id, 100, 0)

    engine.addConstraint(bone1.id, 'rotationLimit', 0, {
      minRotation: -45,
      maxRotation: 45,
    })
    engine.addConstraint(bone2.id, 'rotationLimit', 0, {
      minRotation: -30,
      maxRotation: 30,
    })

    const all = collectAllConstraints(engine)
    expect(all).toHaveLength(2)
  })
})

describe('rigging panel — mesh collection', () => {
  it('collects all mesh nodes from the scene', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    createMeshNode(engine, 'Mesh1', slide.scene.root.id)
    createMeshNode(engine, 'Mesh2', slide.scene.root.id)

    const meshes = collectMeshes(slide.scene.root)
    expect(meshes).toHaveLength(2)
    expect(meshes.map((m) => m.name)).toEqual(['Mesh1', 'Mesh2'])
  })

  it('returns empty array when no meshes exist', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    createBoneNode(engine, 'Bone', slide.scene.root.id, 0, 0)

    const meshes = collectMeshes(slide.scene.root)
    expect(meshes).toHaveLength(0)
  })

  it('returns bone weights for a mesh node', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone1 = createBoneNode(engine, 'Bone1', slide.scene.root.id, 0, 0)
    const bone2 = createBoneNode(engine, 'Bone2', slide.scene.root.id, 100, 0)
    const meshNode = createMeshNode(engine, 'Mesh', slide.scene.root.id)

    const meshData = meshNode.components.mesh!.mesh
    const boneWeights: { boneId: string; weight: number }[][] = meshData.vertices.map(() => [
      { boneId: bone1.id, weight: 0.6 },
      { boneId: bone2.id, weight: 0.4 },
    ])

    engine.setMeshData(meshNode.id, {
      ...meshData,
      boneWeights,
    })

    const updated = engine.getNode(meshNode.id)
    const weights = updated.components.mesh!.mesh.boneWeights
    expect(weights).toBeDefined()
    expect(weights).toHaveLength(4)
    expect(weights![0]).toEqual([
      { boneId: bone1.id, weight: 0.6 },
      { boneId: bone2.id, weight: 0.4 },
    ])
  })
})

describe('rigging panel — selection context', () => {
  it('shows IK chains and constraints for a selected bone', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone1 = createBoneNode(engine, 'Bone1', slide.scene.root.id, 0, 0)
    const bone2 = createBoneNode(engine, 'Bone2', bone1.id, 100, 0)

    engine.createIKChain(slide.id, [bone1.id, bone2.id], { position: { x: 200, y: 0 } })
    engine.addConstraint(bone1.id, 'rotationLimit', 0, {
      minRotation: -45,
      maxRotation: 45,
    })

    const ikChains = engine.getIKManager().getChainsForBone(bone1.id)
    const constraints = engine.getConstraintManager().getConstraintsForNode(bone1.id)

    expect(ikChains).toHaveLength(1)
    expect(constraints).toHaveLength(1)
    expect(constraints[0].type).toBe('rotationLimit')
  })

  it('shows assigned bones and weights for a selected mesh', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone = createBoneNode(engine, 'Bone', slide.scene.root.id, 0, 0)
    const meshNode = createMeshNode(engine, 'Mesh', slide.scene.root.id)

    const meshData = meshNode.components.mesh!.mesh
    engine.setMeshData(meshNode.id, {
      ...meshData,
      boneWeights: meshData.vertices.map(() => [{ boneId: bone.id, weight: 1.0 }]),
    })

    const updated = engine.getNode(meshNode.id)
    const weights = updated.components.mesh!.mesh.boneWeights!
    const boneIds = new Set(weights.flat().map((w) => w.boneId))

    expect(boneIds.has(bone.id)).toBe(true)
  })
})
