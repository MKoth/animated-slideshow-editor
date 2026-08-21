import { describe, expect, it } from 'vitest'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import { AddConstraintCommand } from '../../engine/commands/addConstraintCommand'
import { RemoveConstraintCommand } from '../../engine/commands/removeConstraintCommand'
import { SetConstraintParamsCommand } from '../../engine/commands/setConstraintParamsCommand'
import { applyConstraints } from '../../engine/constraintEvaluator'
import type { Constraint } from '../../engine/constraint'
import type { WorldTransform } from '../../engine/worldTransform'

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

function expectClose(a: number, b: number, tolerance = 0.0001) {
  expect(Math.abs(a - b)).toBeLessThan(tolerance)
}

describe('ConstraintManager', () => {
  it('adds a rotation limit constraint to a bone node', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone = createBoneNode(engine, 'Bone', slide.scene.root.id)
    const constraint = engine.addConstraint(bone.id, 'rotationLimit', 0, {
      minRotation: -45,
      maxRotation: 45,
    })

    expect(constraint.type).toBe('rotationLimit')
    expect(constraint.priority).toBe(0)
    expect(constraint.params).toEqual({ minRotation: -45, maxRotation: 45 })
  })

  it('adds a second rotation limit constraint to a bone node', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone = createBoneNode(engine, 'Bone', slide.scene.root.id)
    const constraint = engine.addConstraint(bone.id, 'rotationLimit', 1, {
      minRotation: -45,
      maxRotation: 45,
    })

    expect(constraint.type).toBe('rotationLimit')
    expect(constraint.priority).toBe(1)
  })

  it('adds a lookAt constraint to a bone node', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone = createBoneNode(engine, 'Bone', slide.scene.root.id)
    const constraint = engine.addConstraint(bone.id, 'lookAt', 0, {
      targetX: 200,
      targetY: 300,
    })

    expect(constraint.type).toBe('lookAt')
  })

  it('adds a distance constraint to any node', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Node')
    const target = engine.createNode(slide.scene.id, slide.scene.root.id, 'Target')

    const constraint = engine.addConstraint(node.id, 'distance', 0, {
      targetNodeId: target.id,
      minDistance: 50,
      maxDistance: 200,
    })

    expect(constraint.type).toBe('distance')
  })

  it('adds a parent constraint to any node', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Node')
    const target = engine.createNode(slide.scene.id, slide.scene.root.id, 'Target')

    const constraint = engine.addConstraint(node.id, 'parent', 0, {
      targetNodeId: target.id,
      positionInfluence: 0.5,
      rotationInfluence: 1.0,
      scaleInfluence: 0.0,
    })

    expect(constraint.type).toBe('parent')
  })

  it('rejects rotation limit on non-bone node', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Node')

    expect(() => {
      engine.addConstraint(node.id, 'rotationLimit', 0, {
        minRotation: -45,
        maxRotation: 45,
      })
    }).toThrow('requires a bone node')
  })

  it('rejects rotation limit on non-bone node (second constraint)', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Node')

    expect(() => {
      engine.addConstraint(node.id, 'rotationLimit', 0, {
        minRotation: -30,
        maxRotation: 30,
      })
    }).toThrow('requires a bone node')
  })

  it('rejects lookAt on non-bone node', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Node')

    expect(() => {
      engine.addConstraint(node.id, 'lookAt', 0, {
        targetX: 0,
        targetY: 0,
      })
    }).toThrow('requires a bone node')
  })

  it('rejects distance constraint without targetNodeId', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Node')

    expect(() => {
      engine.addConstraint(node.id, 'distance', 0, {
        targetNodeId: '',
        minDistance: 50,
        maxDistance: 200,
      })
    }).toThrow('requires a targetNodeId')
  })

  it('rejects parent constraint without targetNodeId', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Node')

    expect(() => {
      engine.addConstraint(node.id, 'parent', 0, {
        targetNodeId: '',
        positionInfluence: 0.5,
        rotationInfluence: 1.0,
        scaleInfluence: 0.0,
      })
    }).toThrow('requires a targetNodeId')
  })

  it('removes a constraint', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone = createBoneNode(engine, 'Bone', slide.scene.root.id)
    const constraint = engine.addConstraint(bone.id, 'rotationLimit', 0, {
      minRotation: -45,
      maxRotation: 45,
    })

    const removed = engine.removeConstraint(bone.id, constraint.id)
    expect(removed.id).toBe(constraint.id)

    const constraints = engine.getConstraintsForNode(bone.id)
    expect(constraints.length).toBe(0)
  })

  it('returns constraints sorted by priority', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone = createBoneNode(engine, 'Bone', slide.scene.root.id)
    engine.addConstraint(bone.id, 'rotationLimit', 10, {
      minRotation: -45,
      maxRotation: 45,
    })
    engine.addConstraint(bone.id, 'rotationLimit', 5, {
      minRotation: -30,
      maxRotation: 30,
    })
    engine.addConstraint(bone.id, 'lookAt', 0, {
      targetX: 0,
      targetY: 0,
    })

    const constraints = engine.getConstraintsForNode(bone.id)
    expect(constraints.length).toBe(3)
    expect(constraints[0].type).toBe('lookAt')
    expect(constraints[1].type).toBe('rotationLimit')
    expect(constraints[2].type).toBe('rotationLimit')
  })

  it('removes all constraints for a node', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone = createBoneNode(engine, 'Bone', slide.scene.root.id)
    engine.addConstraint(bone.id, 'rotationLimit', 0, {
      minRotation: -45,
      maxRotation: 45,
    })
    engine.addConstraint(bone.id, 'lookAt', 1, {
      targetX: 0,
      targetY: 0,
    })

    const removed = engine.getConstraintManager().removeConstraintsForNode(bone.id)
    expect(removed.length).toBe(2)
    expect(engine.getConstraintsForNode(bone.id).length).toBe(0)
  })
})

describe('Constraint Commands', () => {
  it('AddConstraintCommand adds a constraint', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone = createBoneNode(engine, 'Bone', slide.scene.root.id)
    const cmd = new AddConstraintCommand({
      nodeId: bone.id,
      constraintType: 'rotationLimit',
      priority: 0,
      params: { minRotation: -45, maxRotation: 45 },
    })

    const result = cmd.execute(engine)
    expect(result.nodeId).toBe(bone.id)
    expect(result.constraintId).toBeDefined()

    const constraints = engine.getConstraintsForNode(bone.id)
    expect(constraints.length).toBe(1)
    expect(constraints[0].type).toBe('rotationLimit')
  })

  it('RemoveConstraintCommand removes a constraint', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone = createBoneNode(engine, 'Bone', slide.scene.root.id)
    const constraint = engine.addConstraint(bone.id, 'rotationLimit', 0, {
      minRotation: -45,
      maxRotation: 45,
    })

    const cmd = new RemoveConstraintCommand({
      nodeId: bone.id,
      constraintId: constraint.id,
    })

    const result = cmd.execute(engine)
    expect(result.constraint.id).toBe(constraint.id)
    expect(engine.getConstraintsForNode(bone.id).length).toBe(0)
  })

  it('SetConstraintParamsCommand updates params', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone = createBoneNode(engine, 'Bone', slide.scene.root.id)
    const constraint = engine.addConstraint(bone.id, 'rotationLimit', 0, {
      minRotation: -45,
      maxRotation: 45,
    })

    const cmd = new SetConstraintParamsCommand({
      nodeId: bone.id,
      constraintId: constraint.id,
      params: { minRotation: -30, maxRotation: 30 },
    })

    const result = cmd.execute(engine)
    expect(result.oldParams).toEqual({ minRotation: -45, maxRotation: 45 })

    const updated = engine.getConstraint(constraint.id)
    expect(updated.params).toEqual({ minRotation: -30, maxRotation: 30 })
  })
})

describe('Constraint Evaluation', () => {
  it('rotation limit is a no-op in evaluator (clamped in renderer)', () => {
    const world: WorldTransform = { x: 0, y: 0, rotation: 90, scaleX: 1, scaleY: 1 }
    const constraint: Constraint = {
      id: 'test',
      type: 'rotationLimit',
      priority: 0,
      params: { minRotation: -45, maxRotation: 45 },
    }

    const result = applyConstraints(world, [constraint], {
      nodeLookup: () => null as never,
      worldTransformLookup: () => null,
    })

    expect(result.rotation).toBe(90)
  })

  it('does not clamp rotation within limits', () => {
    const world: WorldTransform = { x: 0, y: 0, rotation: 30, scaleX: 1, scaleY: 1 }
    const constraint: Constraint = {
      id: 'test',
      type: 'rotationLimit',
      priority: 0,
      params: { minRotation: -45, maxRotation: 45 },
    }

    const result = applyConstraints(world, [constraint], {
      nodeLookup: () => null as never,
      worldTransformLookup: () => null,
    })

    expect(result.rotation).toBe(30)
  })

  it('rotation limit passes through in evaluator', () => {
    const world: WorldTransform = { x: 0, y: 0, rotation: -90, scaleX: 1, scaleY: 1 }
    const constraint: Constraint = {
      id: 'test',
      type: 'rotationLimit',
      priority: 0,
      params: { minRotation: -45, maxRotation: 45 },
    }

    const result = applyConstraints(world, [constraint], {
      nodeLookup: () => null as never,
      worldTransformLookup: () => null,
    })

    expect(result.rotation).toBe(-90)
  })

  it('rotation limit passes through in evaluation', () => {
    const world: WorldTransform = { x: 0, y: 0, rotation: 90, scaleX: 1, scaleY: 1 }
    const constraint: Constraint = {
      id: 'test',
      type: 'rotationLimit',
      priority: 0,
      params: { minRotation: -45, maxRotation: 45 },
    }

    const result = applyConstraints(world, [constraint], {
      nodeLookup: () => null as never,
      worldTransformLookup: () => null,
    })

    expect(result.rotation).toBe(90)
  })

  it('applies look-at constraint', () => {
    const world: WorldTransform = { x: 100, y: 100, rotation: 0, scaleX: 1, scaleY: 1 }
    const constraint: Constraint = {
      id: 'test',
      type: 'lookAt',
      priority: 0,
      params: { targetX: 200, targetY: 100 },
    }

    const result = applyConstraints(world, [constraint], {
      nodeLookup: () => null as never,
      worldTransformLookup: () => null,
    })

    expectClose(result.rotation, 0)
  })

  it('applies look-at constraint with vertical offset', () => {
    const world: WorldTransform = { x: 100, y: 100, rotation: 0, scaleX: 1, scaleY: 1 }
    const constraint: Constraint = {
      id: 'test',
      type: 'lookAt',
      priority: 0,
      params: { targetX: 100, targetY: 200 },
    }

    const result = applyConstraints(world, [constraint], {
      nodeLookup: () => null as never,
      worldTransformLookup: () => null,
    })

    expectClose(result.rotation, Math.PI / 2)
  })

  it('applies distance constraint - too close', () => {
    const world: WorldTransform = { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }
    const targetWorld: WorldTransform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }
    const constraint: Constraint = {
      id: 'test',
      type: 'distance',
      priority: 0,
      params: { targetNodeId: 'target', minDistance: 50, maxDistance: 200 },
    }

    const result = applyConstraints(world, [constraint], {
      nodeLookup: () => null as never,
      worldTransformLookup: () => targetWorld,
    })

    expectClose(result.x, 50)
  })

  it('applies distance constraint - too far', () => {
    const world: WorldTransform = { x: 300, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }
    const targetWorld: WorldTransform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }
    const constraint: Constraint = {
      id: 'test',
      type: 'distance',
      priority: 0,
      params: { targetNodeId: 'target', minDistance: 50, maxDistance: 200 },
    }

    const result = applyConstraints(world, [constraint], {
      nodeLookup: () => null as never,
      worldTransformLookup: () => targetWorld,
    })

    expectClose(result.x, 200)
  })

  it('applies parent constraint with full influence', () => {
    const world: WorldTransform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }
    const targetWorld: WorldTransform = { x: 100, y: 50, rotation: 45, scaleX: 2, scaleY: 2 }
    const constraint: Constraint = {
      id: 'test',
      type: 'parent',
      priority: 0,
      params: {
        targetNodeId: 'target',
        positionInfluence: 1.0,
        rotationInfluence: 1.0,
        scaleInfluence: 1.0,
      },
    }

    const result = applyConstraints(world, [constraint], {
      nodeLookup: () => null as never,
      worldTransformLookup: () => targetWorld,
    })

    expect(result.x).toBe(100)
    expect(result.y).toBe(50)
    expect(result.rotation).toBe(45)
    expect(result.scaleX).toBe(2)
    expect(result.scaleY).toBe(2)
  })

  it('applies parent constraint with partial influence', () => {
    const world: WorldTransform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }
    const targetWorld: WorldTransform = { x: 100, y: 50, rotation: 90, scaleX: 2, scaleY: 2 }
    const constraint: Constraint = {
      id: 'test',
      type: 'parent',
      priority: 0,
      params: {
        targetNodeId: 'target',
        positionInfluence: 0.5,
        rotationInfluence: 0.5,
        scaleInfluence: 0.5,
      },
    }

    const result = applyConstraints(world, [constraint], {
      nodeLookup: () => null as never,
      worldTransformLookup: () => targetWorld,
    })

    expect(result.x).toBe(50)
    expect(result.y).toBe(25)
    expect(result.rotation).toBe(45)
    expect(result.scaleX).toBe(1.5)
    expect(result.scaleY).toBe(1.5)
  })

  it('multiple rotation limits pass through in evaluator', () => {
    const world: WorldTransform = { x: 0, y: 0, rotation: 90, scaleX: 1, scaleY: 1 }
    const constraints: Constraint[] = [
      {
        id: 'rot1',
        type: 'rotationLimit',
        priority: 0,
        params: { minRotation: -30, maxRotation: 30 },
      },
      {
        id: 'rot2',
        type: 'rotationLimit',
        priority: 1,
        params: { minRotation: -45, maxRotation: 45 },
      },
    ]

    const result = applyConstraints(world, constraints, {
      nodeLookup: () => null as never,
      worldTransformLookup: () => null,
    })

    expect(result.rotation).toBe(90)
  })
})

describe('Constraint Serialization', () => {
  it('round-trips constraints through toJSON/restoreFromJSON', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone = createBoneNode(engine, 'Bone', slide.scene.root.id)
    engine.addConstraint(bone.id, 'rotationLimit', 0, {
      minRotation: -45,
      maxRotation: 45,
    })
    engine.addConstraint(bone.id, 'lookAt', 1, {
      targetX: 200,
      targetY: 300,
    })

    const json = engine.toJSON()
    expect(json.constraints).toBeDefined()

    const engine2 = createEngine()
    engine2.restoreFromJSON(json)

    const restored = engine2.getConstraintsForNode(bone.id)
    expect(restored.length).toBe(2)
    expect(restored[0].type).toBe('rotationLimit')
    expect(restored[0].params).toEqual({ minRotation: -45, maxRotation: 45 })
    expect(restored[1].type).toBe('lookAt')
    expect(restored[1].params).toEqual({ targetX: 200, targetY: 300 })
  })

  it('removes constraints when node is deleted', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone = createBoneNode(engine, 'Bone', slide.scene.root.id)
    engine.addConstraint(bone.id, 'rotationLimit', 0, {
      minRotation: -45,
      maxRotation: 45,
    })

    engine.removeNode(bone.id)

    // After removal, the node's constraints are cleaned up
    expect(engine.getConstraintsForNode(bone.id).length).toBe(0)
  })

  it('constraint events are emitted', () => {
    const engine = setup()
    const events: unknown[] = []
    engine.subscribe((event) => events.push(event))

    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone = createBoneNode(engine, 'Bone', slide.scene.root.id)
    const constraint = engine.addConstraint(bone.id, 'rotationLimit', 0, {
      minRotation: -45,
      maxRotation: 45,
    })

    expect(events.some((e) => (e as { type: string }).type === 'ConstraintAdded')).toBe(true)

    engine.removeConstraint(bone.id, constraint.id)
    expect(events.some((e) => (e as { type: string }).type === 'ConstraintRemoved')).toBe(true)

    const constraint2 = engine.addConstraint(bone.id, 'rotationLimit', 0, {
      minRotation: -30,
      maxRotation: 30,
    })
    engine.setConstraintParams(bone.id, constraint2.id, {
      minRotation: -10,
      maxRotation: 10,
    })
    expect(events.some((e) => (e as { type: string }).type === 'ConstraintChanged')).toBe(true)
  })
})
