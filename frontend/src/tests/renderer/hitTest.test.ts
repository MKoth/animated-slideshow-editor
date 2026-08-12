import { describe, expect, it } from 'vitest'
import type { Engine } from '../../engine/internal'
import { createEngine } from '../../engine/internal'
import type { SceneNode } from '../../engine'
import { Scene } from '../../engine/scene'
import { SceneNode as SceneNodeModel } from '../../engine/sceneNode'
import { nodesIntersectingRect, topmostNodeAt, worldAabbOf } from '../../pixi/renderer/hitTest'
import type { NodeSizeSource } from '../../pixi/renderer/hitTest'

interface SceneHarness {
  engine: Engine
  sizes: NodeSizeSource
}

function harness(): SceneHarness {
  const engine = createEngine()
  engine.createProject({ name: 'Demo' })
  engine.createSlide('Slide 1')
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }
  const rootId = slide.scene.root.id
  return {
    engine,
    sizes: (nodeId) => (nodeId === rootId ? null : { width: 100, height: 60 }),
  }
}

function rootChild(engine: Engine, name: string): SceneNode {
  const slide = engine.project?.slides[0]
  const node = slide?.scene.root.children.find((child) => child.name === name)
  if (!node) {
    throw new Error(`Node "${name}" not found`)
  }
  return node
}

function sceneOf(engine: Engine) {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }
  return slide.scene
}

function node(engine: Engine, name: string, transform?: SceneNode['transform']): SceneNode {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }
  return engine.createNode(slide.scene.id, slide.scene.root.id, name, {
    transform: transform ?? { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-1' } },
  })
}

describe('topmostNodeAt', () => {
  it('returns the topmost visible node at the pointer (later draw order wins)', () => {
    const { engine, sizes } = harness()
    node(engine, 'Behind')
    node(engine, 'Front')

    expect(topmostNodeAt(sceneOf(engine), { x: 0, y: 0 }, sizes)).toBe(
      rootChild(engine, 'Front').id,
    )
  })

  it('returns null when the pointer is outside every node', () => {
    const { engine, sizes } = harness()
    node(engine, 'Far')

    expect(topmostNodeAt(sceneOf(engine), { x: 1000, y: 1000 }, sizes)).toBeNull()
  })

  it('returns null on a scene without nodes', () => {
    const { engine, sizes } = harness()

    expect(topmostNodeAt(sceneOf(engine), { x: 0, y: 0 }, sizes)).toBeNull()
  })

  it('skips invisible nodes and hits the one below', () => {
    const { engine, sizes } = harness()
    const hidden = node(engine, 'Hidden')
    engine.setVisibility(hidden.id, false)
    node(engine, 'Visible')

    expect(topmostNodeAt(sceneOf(engine), { x: 0, y: 0 }, sizes)).toBe(
      rootChild(engine, 'Visible').id,
    )
  })

  it('skips a visible node whose ancestor is invisible', () => {
    const { engine, sizes } = harness()
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Hidden Group', {
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    const child = engine.createNode(slide.scene.id, rootChild(engine, 'Hidden Group').id, 'Child', {
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-1' } },
    })
    engine.setVisibility(rootChild(engine, 'Hidden Group').id, false)

    expect(topmostNodeAt(sceneOf(engine), { x: 0, y: 0 }, sizes)).toBeNull()

    engine.setVisibility(rootChild(engine, 'Hidden Group').id, true)
    expect(topmostNodeAt(sceneOf(engine), { x: 0, y: 0 }, sizes)).toBe(child.id)
  })

  it('never selects a camera node even when it has a reported size', () => {
    const identity = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }
    const root = new SceneNodeModel('root', 'Root', identity)
    const rogueCamera = new SceneNodeModel('cam', 'Camera', identity, {
      camera: { kind: 'camera' },
    })
    rogueCamera.parent = root
    root.children.push(rogueCamera)
    const scene = new Scene(
      'scene-1',
      root,
      new SceneNodeModel('real-cam', 'Camera', identity, { camera: { kind: 'camera' } }),
    )
    scene.register(rogueCamera)
    const sizes: NodeSizeSource = (nodeId) => (nodeId === 'cam' ? { width: 100, height: 60 } : null)

    expect(topmostNodeAt(scene, { x: 0, y: 0 }, sizes)).toBeNull()
    expect(
      nodesIntersectingRect(scene, { minX: -50, minY: -50, maxX: 50, maxY: 50 }, sizes),
    ).toEqual([])
  })

  it('tests the point against the rotated rect of the node', () => {
    const { engine, sizes } = harness()
    node(engine, 'Rotated', { x: 0, y: 0, rotation: Math.PI / 2, scaleX: 1, scaleY: 1 })

    expect(topmostNodeAt(sceneOf(engine), { x: 0, y: 40 }, sizes)).toBe(
      rootChild(engine, 'Rotated').id,
    )
    expect(topmostNodeAt(sceneOf(engine), { x: 40, y: 0 }, sizes)).toBeNull()
  })

  it('accounts for the node scale when testing the point', () => {
    const { engine, sizes } = harness()
    node(engine, 'Scaled', { x: 0, y: 0, rotation: 0, scaleX: 2, scaleY: 2 })

    expect(topmostNodeAt(sceneOf(engine), { x: 80, y: 0 }, sizes)).toBe(
      rootChild(engine, 'Scaled').id,
    )
  })

  it('accounts for ancestor transforms when testing the point', () => {
    const { engine, sizes } = harness()
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const group = engine.createNode(slide.scene.id, slide.scene.root.id, 'Group', {
      transform: { x: 100, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    engine.createNode(slide.scene.id, group.id, 'Child', {
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-1' } },
    })

    expect(topmostNodeAt(sceneOf(engine), { x: 100, y: 0 }, sizes)).toBe(
      rootChild(engine, 'Group').children[0].id,
    )
    expect(topmostNodeAt(sceneOf(engine), { x: 0, y: 0 }, sizes)).toBeNull()
  })

  it('never selects a node without a size', () => {
    const { engine } = harness()
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Bare')

    expect(topmostNodeAt(sceneOf(engine), { x: 0, y: 0 }, () => null)).toBeNull()
  })
})

describe('nodesIntersectingRect', () => {
  it('returns all intersecting nodes in insertion order', () => {
    const { engine, sizes } = harness()
    node(engine, 'First', { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
    node(engine, 'Second', { x: 200, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
    node(engine, 'Third', { x: 20, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })

    const ids = nodesIntersectingRect(
      sceneOf(engine),
      { minX: -50, minY: -50, maxX: 150, maxY: 50 },
      sizes,
    )

    expect(ids).toEqual([rootChild(engine, 'First').id, rootChild(engine, 'Third').id])
  })

  it('skips invisible nodes', () => {
    const { engine, sizes } = harness()
    const hidden = node(engine, 'Hidden')
    engine.setVisibility(hidden.id, false)
    node(engine, 'Visible')

    expect(
      nodesIntersectingRect(sceneOf(engine), { minX: -50, minY: -50, maxX: 50, maxY: 50 }, sizes),
    ).toEqual([rootChild(engine, 'Visible').id])
  })

  it('intersects the rotated bounds of a node', () => {
    const { engine, sizes } = harness()
    node(engine, 'Rotated', { x: 0, y: 0, rotation: Math.PI / 2, scaleX: 1, scaleY: 1 })

    expect(
      nodesIntersectingRect(sceneOf(engine), { minX: -10, minY: -60, maxX: 10, maxY: -40 }, sizes),
    ).toEqual([rootChild(engine, 'Rotated').id])
  })

  it('returns an empty list when nothing intersects', () => {
    const { engine, sizes } = harness()
    node(engine, 'Far', { x: 500, y: 500, rotation: 0, scaleX: 1, scaleY: 1 })

    expect(
      nodesIntersectingRect(sceneOf(engine), { minX: -50, minY: -50, maxX: 50, maxY: 50 }, sizes),
    ).toEqual([])
  })
})

describe('worldAabbOf', () => {
  it('returns the world-space axis-aligned bounds of a rotated node', () => {
    const { engine, sizes } = harness()
    node(engine, 'Rotated', { x: 0, y: 0, rotation: Math.PI / 2, scaleX: 1, scaleY: 1 })

    const aabb = worldAabbOf(sceneOf(engine), rootChild(engine, 'Rotated').id, sizes)

    expect(aabb?.minX).toBeCloseTo(-30)
    expect(aabb?.minY).toBe(-50)
    expect(aabb?.maxX).toBeCloseTo(30)
    expect(aabb?.maxY).toBe(50)
  })

  it('accounts for ancestor transforms and scales', () => {
    const { engine, sizes } = harness()
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const group = engine.createNode(slide.scene.id, slide.scene.root.id, 'Group', {
      transform: { x: 100, y: 20, rotation: 0, scaleX: 2, scaleY: 2 },
    })
    const child = engine.createNode(slide.scene.id, group.id, 'Child', {
      components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-1' } },
    })

    const aabb = worldAabbOf(sceneOf(engine), child.id, sizes)

    expect(aabb).toEqual({ minX: 0, minY: -40, maxX: 200, maxY: 80 })
  })

  it('returns null for a node without a size', () => {
    const { engine } = harness()
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const bare = engine.createNode(slide.scene.id, slide.scene.root.id, 'Bare')

    expect(worldAabbOf(sceneOf(engine), bare.id, () => null)).toBeNull()
  })
})
