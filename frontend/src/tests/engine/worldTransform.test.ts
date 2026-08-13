import { describe, expect, it } from 'vitest'
import type { Engine } from '../../engine/internal'
import { createEngine } from '../../engine/internal'
import { identityTransform, type Transform } from '../../engine/transform'
import { relativeTransform, transformsEqual, worldTransformOf } from '../../engine/worldTransform'

function sceneOf(engine: Engine) {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }
  return slide.scene
}

function node(engine: Engine, parentId: string, name: string, transform?: Transform) {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }
  return engine.createNode(slide.scene.id, parentId, name, {
    transform: transform ?? identityTransform(),
  })
}

function expectClose(actual: Transform, expected: Transform): void {
  expect(actual.x).toBeCloseTo(expected.x, 5)
  expect(actual.y).toBeCloseTo(expected.y, 5)
  expect(actual.rotation).toBeCloseTo(expected.rotation, 5)
  expect(actual.scaleX).toBeCloseTo(expected.scaleX, 5)
  expect(actual.scaleY).toBeCloseTo(expected.scaleY, 5)
}

describe('worldTransformOf', () => {
  it('returns the identity for the root', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const scene = sceneOf(engine)
    expect(worldTransformOf(scene, scene.root.id)).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
  })

  it('returns null for an unknown node', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    expect(worldTransformOf(sceneOf(engine), 'ghost')).toBeNull()
  })

  it('accumulates position, rotation and scale through the chain', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const scene = sceneOf(engine)
    const parent = node(engine, scene.root.id, 'Parent', {
      x: 20,
      y: 10,
      rotation: 0,
      scaleX: 2,
      scaleY: 3,
    })
    const child = node(engine, parent.id, 'Child', {
      x: 4,
      y: -2,
      rotation: Math.PI / 2,
      scaleX: 1,
      scaleY: 1.5,
    })
    const world = worldTransformOf(scene, child.id)
    if (!world) {
      throw new Error('expected a world transform')
    }
    expectClose(world, {
      x: 28,
      y: 4,
      rotation: Math.PI / 2,
      scaleX: 2,
      scaleY: 4.5,
    })
  })

  it('rotates the child offset when the chain accumulates rotation', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const scene = sceneOf(engine)
    const parent = node(engine, scene.root.id, 'Parent', {
      x: 0,
      y: 0,
      rotation: Math.PI / 2,
      scaleX: 1,
      scaleY: 1,
    })
    const child = node(engine, parent.id, 'Child', {
      x: 10,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
    const world = worldTransformOf(scene, child.id)
    if (!world) {
      throw new Error('expected a world transform')
    }
    expectClose(world, { x: 0, y: 10, rotation: Math.PI / 2, scaleX: 1, scaleY: 1 })
  })
})

describe('relativeTransform', () => {
  it('round-trips a world transform back into the local transform', () => {
    const parentWorld = { x: 40, y: 30, rotation: 0, scaleX: 1, scaleY: 1 }
    const local: Transform = { x: 10, y: -5, rotation: 0, scaleX: 1, scaleY: 1 }
    const world = { x: 50, y: 25, rotation: 0, scaleX: 1, scaleY: 1 }
    const rel = relativeTransform(world, parentWorld)
    if (!rel) {
      throw new Error('expected a relative transform')
    }
    expectClose(rel, local)
  })

  it('accounts for a scaled parent', () => {
    const parentWorld = { x: 0, y: 0, rotation: 0, scaleX: 2, scaleY: 2 }
    const rel = relativeTransform({ x: 20, y: 10, rotation: 0, scaleX: 2, scaleY: 2 }, parentWorld)
    if (!rel) {
      throw new Error('expected a relative transform')
    }
    expectClose(rel, { x: 10, y: 5, rotation: 0, scaleX: 1, scaleY: 1 })
  })

  it('accounts for a rotated parent', () => {
    const parentWorld = { x: 10, y: 10, rotation: Math.PI / 2, scaleX: 1, scaleY: 1 }
    const rel = relativeTransform(
      { x: 10, y: 20, rotation: Math.PI / 2, scaleX: 1, scaleY: 1 },
      parentWorld,
    )
    if (!rel) {
      throw new Error('expected a relative transform')
    }
    expectClose(rel, { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
  })

  it('returns null when the parent scale is zero', () => {
    expect(
      relativeTransform(
        { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        { x: 0, y: 0, rotation: 0, scaleX: 0, scaleY: 1 },
      ),
    ).toBeNull()
  })
})

describe('transformsEqual', () => {
  it('compares every field', () => {
    expect(transformsEqual(identityTransform(), identityTransform())).toBe(true)
    expect(
      transformsEqual(identityTransform(), { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }),
    ).toBe(true)
    expect(
      transformsEqual(identityTransform(), { x: 1, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }),
    ).toBe(false)
  })
})
