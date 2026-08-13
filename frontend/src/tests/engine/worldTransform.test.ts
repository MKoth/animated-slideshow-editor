import { describe, expect, it } from 'vitest'
import type { Engine } from '../../engine/internal'
import { createEngine } from '../../engine/internal'
import { identityTransform, type Transform } from '../../engine/transform'
import {
  EvaluatedWorldTransformSource,
  evaluatedWorldTransformOf,
  relativeTransform,
  transformsEqual,
  worldTransformOf,
} from '../../engine/worldTransform'

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

describe('EvaluatedWorldTransformSource', () => {
  function source(
    engine: Engine,
    time: number,
    previews: ReadonlyMap<string, { x: number; y: number }> = new Map(),
  ): EvaluatedWorldTransformSource {
    return new EvaluatedWorldTransformSource(engine, () => time, previews)
  }

  function animated(engine: Engine): string {
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const created = engine.createNode(slide.scene.id, slide.scene.root.id, 'Animated', {
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    engine.addKeyframe(created.id, 'positionX', 0, 0)
    engine.addKeyframe(created.id, 'positionX', 10, 100)
    return created.id
  }

  it('matches evaluatedWorldTransformOf at the current time', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const id = animated(engine)

    const transforms = source(engine, 5)
    expect(transforms.transformOf(id)).toEqual(evaluatedWorldTransformOf(engine, id, 5))
    expect(transforms.transformOf(id)).toEqual({ x: 50, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
  })

  it('reflects time changes without re-creation', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const id = animated(engine)
    let time = 0
    const transforms = new EvaluatedWorldTransformSource(engine, () => time)

    expect(transforms.transformOf(id)?.x).toBe(0)
    time = 10
    expect(transforms.transformOf(id)?.x).toBe(100)
  })

  it('composes the evaluated state of animated ancestors', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent', {
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    engine.addKeyframe(parent.id, 'positionX', 0, 0)
    engine.addKeyframe(parent.id, 'positionX', 10, 200)
    const child = engine.createNode(slide.scene.id, parent.id, 'Child', {
      transform: { x: 20, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })

    const transforms = source(engine, 5)
    expect(transforms.transformOf(child.id)).toEqual(evaluatedWorldTransformOf(engine, child.id, 5))
    expect(transforms.transformOf(child.id)).toEqual({
      x: 120,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
  })

  it('overrides only the previewed node local position inside the chain', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent', {
      transform: { x: 0, y: 0, rotation: Math.PI / 2, scaleX: 1, scaleY: 1 },
    })
    engine.addKeyframe(parent.id, 'positionX', 0, 0)
    engine.addKeyframe(parent.id, 'positionX', 10, 100)
    const child = engine.createNode(slide.scene.id, parent.id, 'Child', {
      transform: { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    engine.addKeyframe(child.id, 'positionX', 0, 10)
    engine.addKeyframe(child.id, 'positionX', 10, 110)

    const previews = new Map([[child.id, { x: 30, y: 0 }]])
    const transforms = source(engine, 5, previews)

    expect(transforms.transformOf(child.id)).toEqual({
      x: 50,
      y: 30,
      rotation: Math.PI / 2,
      scaleX: 1,
      scaleY: 1,
    })
  })

  it('leaves the evaluated position when the node is not previewed', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const id = animated(engine)
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const other = engine.createNode(slide.scene.id, slide.scene.root.id, 'Other', {
      transform: { x: 5, y: 6, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    const previews = new Map([[id, { x: 999, y: 999 }]])

    const transforms = source(engine, 2, previews)
    expect(transforms.transformOf(other.id)).toEqual({
      x: 5,
      y: 6,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    })
  })

  it('returns null for an unknown node', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')

    expect(source(engine, 0).transformOf('ghost')).toBeNull()
  })
})
