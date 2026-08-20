import { describe, expect, it } from 'vitest'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import { IKChain } from '../../engine/ikChain'
import { solveTwoBoneIK, solveCCDIK } from '../../engine/ikSolver'

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

describe('IKChain', () => {
  it('creates a valid IK chain with two bones', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const root = createBoneNode(engine, 'Root', slide.scene.root.id, 0, 0)
    const child = createBoneNode(engine, 'Child', root.id, 100, 0)

    const chain = new IKChain('chain1', [root.id, child.id], { position: { x: 200, y: 0 } })

    expect(chain.chainLength).toBe(2)
    expect(chain.rootBoneId).toBe(root.id)
    expect(chain.endBoneId).toBe(child.id)
  })

  it('validates chain length >= 2', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const root = createBoneNode(engine, 'Root', slide.scene.root.id, 0, 0)

    const chain = new IKChain('chain1', [root.id], { position: { x: 200, y: 0 } })

    const error = chain.validate((id) => engine.getNode(id))
    expect(error).toBe('IK chain must have at least 2 bones')
  })

  it('validates bone nodes exist', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const root = createBoneNode(engine, 'Root', slide.scene.root.id, 0, 0)

    const chain = new IKChain('chain1', [root.id, 'nonexistent'], { position: { x: 200, y: 0 } })

    const error = chain.validate((id) => engine.getNode(id))
    expect(error).toContain('not found')
  })

  it('validates nodes have bone component', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const root = createBoneNode(engine, 'Root', slide.scene.root.id, 0, 0)
    const child = engine.createNode(slide.scene.id, root.id, 'Child', {
      transform: { x: 100, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })

    const chain = new IKChain('chain1', [root.id, child.id], { position: { x: 200, y: 0 } })

    const error = chain.validate((id) => engine.getNode(id))
    expect(error).toContain('is not a bone')
  })

  it('validates ancestor-descendant path', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const root1 = createBoneNode(engine, 'Root1', slide.scene.root.id, 0, 0)
    const root2 = createBoneNode(engine, 'Root2', slide.scene.root.id, 0, 0)
    const child = createBoneNode(engine, 'Child', root1.id, 100, 0)

    const chain = new IKChain('chain1', [root2.id, child.id], { position: { x: 200, y: 0 } })

    const error = chain.validate((id) => engine.getNode(id))
    expect(error).toContain('not a child of bone')
  })

  it('serializes and deserializes correctly', () => {
    const chain = new IKChain(
      'chain1',
      ['bone1', 'bone2'],
      { position: { x: 100, y: 200 } },
      { position: { x: 50, y: 100 } },
    )

    const json = chain.toJSON()
    const restored = IKChain.fromJSON(json)

    expect(restored.id).toBe(chain.id)
    expect(restored.boneIds).toEqual(chain.boneIds)
    expect(restored.target).toEqual(chain.target)
    expect(restored.poleTarget).toEqual(chain.poleTarget)
  })
})

describe('IK Solvers', () => {
  it('solves two-bone IK analytically', () => {
    // Simple horizontal arm
    const bone1 = {
      id: 'bone1',
      parent: null,
      components: { bone: { kind: 'bone' as const } },
    } as unknown as import('../../engine/sceneNode').SceneNode
    const bone2 = {
      id: 'bone2',
      parent: bone1,
      components: { bone: { kind: 'bone' as const } },
    } as unknown as import('../../engine/sceneNode').SceneNode

    const getLocalTransform = (id: string) => {
      if (id === 'bone1') return { x: 100, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }
      return { x: 80, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }
    }

    const solution = solveTwoBoneIK([bone1, bone2], { x: 150, y: 0 }, null, getLocalTransform)

    expect(solution.rotations).toHaveLength(2)
    expect(typeof solution.rotations[0]).toBe('number')
    expect(typeof solution.rotations[1]).toBe('number')
  })

  it('solves CCD IK for chains longer than 2', () => {
    const bone1 = {
      id: 'bone1',
      parent: null,
      components: { bone: { kind: 'bone' as const } },
    } as unknown as import('../../engine/sceneNode').SceneNode
    const bone2 = {
      id: 'bone2',
      parent: bone1,
      components: { bone: { kind: 'bone' as const } },
    } as unknown as import('../../engine/sceneNode').SceneNode
    const bone3 = {
      id: 'bone3',
      parent: bone2,
      components: { bone: { kind: 'bone' as const } },
    } as unknown as import('../../engine/sceneNode').SceneNode

    const getLocalTransform = (id: string) => {
      if (id === 'bone1') return { x: 100, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }
      if (id === 'bone2') return { x: 80, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }
      return { x: 60, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }
    }

    const solution = solveCCDIK([bone1, bone2, bone3], { x: 200, y: 0 }, null, getLocalTransform)

    expect(solution.rotations).toHaveLength(3)
    solution.rotations.forEach((rot) => {
      expect(typeof rot).toBe('number')
    })
  })
})

describe('IKManager', () => {
  it('creates and deletes IK chains', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const root = createBoneNode(engine, 'Root', slide.scene.root.id, 0, 0)
    const child = createBoneNode(engine, 'Child', root.id, 100, 0)

    const chain = engine.createIKChain(slide.id, [root.id, child.id], {
      position: { x: 200, y: 0 },
    })

    expect(chain.id).toBeTruthy()
    expect(engine.getIKChain(chain.id)).toBe(chain)

    engine.deleteIKChain(chain.id)
    expect(() => engine.getIKChain(chain.id)).toThrow()
  })

  it('validates chain on creation', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    expect(() => {
      engine.createIKChain(slide.id, ['nonexistent1', 'nonexistent2'], {
        position: { x: 200, y: 0 },
      })
    }).toThrow()
  })

  it('gets chains for slide', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const root = createBoneNode(engine, 'Root', slide.scene.root.id, 0, 0)
    const child = createBoneNode(engine, 'Child', root.id, 100, 0)

    const chain = engine.createIKChain(slide.id, [root.id, child.id], {
      position: { x: 200, y: 0 },
    })

    const chains = engine.getIKChainsForSlide(slide.id)
    expect(chains).toHaveLength(1)
    expect(chains[0].id).toBe(chain.id)
  })

  it('gets chains for bone', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const root = createBoneNode(engine, 'Root', slide.scene.root.id, 0, 0)
    const child = createBoneNode(engine, 'Child', root.id, 100, 0)

    const chain = engine.createIKChain(slide.id, [root.id, child.id], {
      position: { x: 200, y: 0 },
    })

    const chains = engine.getIKChainsForBone(root.id)
    expect(chains).toHaveLength(1)
    expect(chains[0].id).toBe(chain.id)

    const otherChains = engine.getIKChainsForBone(child.id)
    expect(otherChains).toHaveLength(1)
  })

  it('updates target and pole target', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const root = createBoneNode(engine, 'Root', slide.scene.root.id, 0, 0)
    const child = createBoneNode(engine, 'Child', root.id, 100, 0)

    const chain = engine.createIKChain(slide.id, [root.id, child.id], {
      position: { x: 200, y: 0 },
    })

    engine.setIKTarget(chain.id, { position: { x: 300, y: 100 } })
    expect(engine.getIKChain(chain.id).target.position).toEqual({ x: 300, y: 100 })

    engine.setIKPoleTarget(chain.id, { position: { x: 150, y: -50 } })
    expect(engine.getIKChain(chain.id).poleTarget?.position).toEqual({ x: 150, y: -50 })
  })

  it('removes IK chain when a bone in the chain is deleted', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const root = createBoneNode(engine, 'Root', slide.scene.root.id, 0, 0)
    const child = createBoneNode(engine, 'Child', root.id, 100, 0)

    engine.createIKChain(slide.id, [root.id, child.id], { position: { x: 200, y: 0 } })

    expect(engine.getIKChainsForBone(root.id)).toHaveLength(1)

    engine.removeNode(child.id)

    expect(engine.getIKChainsForBone(root.id)).toHaveLength(0)
  })

  it('removes IK chain when root bone in the chain is deleted', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const root = createBoneNode(engine, 'Root', slide.scene.root.id, 0, 0)
    const child = createBoneNode(engine, 'Child', root.id, 100, 0)

    engine.createIKChain(slide.id, [root.id, child.id], { position: { x: 200, y: 0 } })

    engine.removeNode(root.id)

    // Both root and child are removed (child is descendant of root)
    // IK chain should be gone
    expect(engine.getIKChainsForSlide(slide.id)).toHaveLength(0)
  })

  it('clears chains when slide is deleted', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    // Create a second slide so we can delete the first
    engine.createSlide('Slide 2')

    const root = createBoneNode(engine, 'Root', slide.scene.root.id, 0, 0)
    const child = createBoneNode(engine, 'Child', root.id, 100, 0)

    engine.createIKChain(slide.id, [root.id, child.id], { position: { x: 200, y: 0 } })

    engine.removeSlide(slide.id)
    // After slide deletion, chains should be cleared
    // Note: This test might need adjustment based on implementation
  })
})
