import { describe, expect, it } from 'vitest'
import type { Engine } from '../../engine/internal'
import { createEngine } from '../../engine/internal'
import { collectEvents } from './helpers'

function setupEngine(): Engine {
  const engine = createEngine()
  engine.createProject({ name: 'P' })
  return engine
}

function firstSlide(engine: Engine) {
  return engine.createSlide('S1')
}

describe('scene graph', () => {
  it('creates a node under a parent and looks it up by id', () => {
    const engine = setupEngine()
    const slide = firstSlide(engine)
    const root = slide.scene.root

    const node = engine.createNode(slide.scene.id, root.id, 'Node A')

    expect(root.children).toEqual([slide.scene.camera, node])
    expect(node.parent).toBe(root)
    expect(slide.scene.getNode(node.id)).toBe(node)
    expect(engine.getNode(node.id)).toBe(node)
  })

  it('creates a node with a transform and components', () => {
    const engine = setupEngine()
    const slide = firstSlide(engine)
    const root = slide.scene.root

    const node = engine.createNode(slide.scene.id, root.id, 'Mover', {
      id: 'node-fixed',
      transform: { x: 10, y: 20, rotation: 0.5, scaleX: 2, scaleY: 1.5 },
      visible: false,
      components: { text: { kind: 'text', content: 'Hi', fontSize: 24, alignment: 'center' } },
    })

    expect(node.id).toBe('node-fixed')
    expect(node.transform).toEqual({ x: 10, y: 20, rotation: 0.5, scaleX: 2, scaleY: 1.5 })
    expect(node.visible).toBe(false)
    expect(node.components.text?.content).toBe('Hi')
  })

  it('creates a node with an explicit id', () => {
    const engine = setupEngine()
    const slide = firstSlide(engine)

    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Fixed', { id: 'my-id' })

    expect(node.id).toBe('my-id')
  })

  it('reparents a node: same scene', () => {
    const engine = setupEngine()
    const slide = firstSlide(engine)
    const root = slide.scene.root
    const parent = engine.createNode(slide.scene.id, root.id, 'Parent')
    const child = engine.createNode(slide.scene.id, root.id, 'Child')

    engine.reparentNode(child.id, parent.id)

    expect(child.parent).toBe(parent)
    expect(parent.children).toEqual([child])
    expect(root.children).not.toContain(child)
    expect(root.children).toEqual([slide.scene.camera, parent])
  })

  it('moves a node up the tree without breaking the invariant', () => {
    const engine = setupEngine()
    const slide = firstSlide(engine)
    const root = slide.scene.root
    const a = engine.createNode(slide.scene.id, root.id, 'A')
    const b = engine.createNode(slide.scene.id, a.id, 'B')
    const c = engine.createNode(slide.scene.id, b.id, 'C')

    engine.reparentNode(c.id, root.id)

    expect(c.parent).toBe(root)
    expect(c.children).toEqual([])
    expect(b.children).toEqual([])
  })

  it('removes a node with its entire subtree', () => {
    const engine = setupEngine()
    const slide = firstSlide(engine)
    const root = slide.scene.root
    const a = engine.createNode(slide.scene.id, root.id, 'A')
    const b = engine.createNode(slide.scene.id, a.id, 'B')
    const c = engine.createNode(slide.scene.id, b.id, 'C')

    const events = collectEvents(engine)
    engine.removeNode(b.id)

    expect(root.children).toEqual([slide.scene.camera, a])
    expect(a.children).toEqual([])
    expect(slide.scene.getNode(a.id)).toBe(a)
    expect(slide.scene.getNode(b.id)).toBeUndefined()
    expect(slide.scene.getNode(c.id)).toBeUndefined()
    expect(() => engine.getNode(c.id)).toThrow(/node.*not found/i)
    expect(events).toEqual([{ type: 'NodeRemoved', nodeId: b.id }])
  })

  it('rejects creating a node without a project or scene', () => {
    const engine = setupEngine()
    const slide = firstSlide(engine)

    expect(() => engine.createNode(slide.scene.id + '-nope', slide.scene.root.id, 'X')).toThrow(
      /scene.*not found/i,
    )
  })

  it('rejects null or empty scene ids with meaningful errors', () => {
    const engine = setupEngine()
    const slide = firstSlide(engine)

    expect(() =>
      // @ts-expect-error testing the runtime guard against null
      engine.createNode(null, slide.scene.root.id, 'X'),
    ).toThrow(/scene.*required/i)
    expect(() =>
      // @ts-expect-error testing the runtime guard against undefined
      engine.createNode(undefined, slide.scene.root.id, 'X'),
    ).toThrow(/scene.*required/i)
  })

  it('rejects an unknown parent', () => {
    const engine = setupEngine()
    const slide = firstSlide(engine)

    expect(() => engine.createNode(slide.scene.id, 'no-such-node', 'X')).toThrow(
      /parent.*not found/i,
    )
  })

  it('rejects duplicate node ids', () => {
    const engine = setupEngine()
    const slide = firstSlide(engine)
    const root = slide.scene.root
    engine.createNode(slide.scene.id, root.id, 'First', { id: 'dup-id' })

    expect(() => engine.createNode(slide.scene.id, root.id, 'Second', { id: 'dup-id' })).toThrow(
      /already exists/i,
    )
    expect(() => engine.createNode(slide.scene.id, root.id, 'Third', { id: 'my-id' })).not.toThrow()
  })

  it('rejects a node id that exists in another scene (globally unique ids)', () => {
    const engine = setupEngine()
    const first = firstSlide(engine)
    const second = engine.createSlide('S2')
    const otherRoot = second.scene.root.id

    expect(() =>
      engine.createNode(first.scene.id, first.scene.root.id, 'Usurper', { id: otherRoot }),
    ).toThrow(/already exists/i)
    expect(engine.getNode(otherRoot)).toBe(second.scene.root)
  })

  it('rejects deleting the root node', () => {
    const engine = setupEngine()
    const slide = firstSlide(engine)

    expect(() => engine.removeNode(slide.scene.root.id)).toThrow(/root/i)
    expect(slide.scene.getNode(slide.scene.root.id)).toBe(slide.scene.root)
  })

  it('rejects deleting an unknown node', () => {
    const engine = setupEngine()

    expect(() => engine.removeNode('nope')).toThrow(/node.*not found/i)
  })

  it('rejects reparenting a node into its own descendant (cycle)', () => {
    const engine = setupEngine()
    const slide = firstSlide(engine)
    const root = slide.scene.root
    const a = engine.createNode(slide.scene.id, root.id, 'A')
    const b = engine.createNode(slide.scene.id, a.id, 'B')
    const c = engine.createNode(slide.scene.id, b.id, 'C')

    expect(() => engine.reparentNode(a.id, c.id)).toThrow(/descendant/i)
    expect(a.parent).toBe(root)
  })

  it('rejects reparenting a node to itself', () => {
    const engine = setupEngine()
    const slide = firstSlide(engine)
    const root = slide.scene.root
    const a = engine.createNode(slide.scene.id, root.id, 'A')

    expect(() => engine.reparentNode(a.id, a.id)).toThrow(/itself|descendant/i)
    expect(a.parent).toBe(root)
  })

  it('rejects reparenting the root', () => {
    const engine = setupEngine()
    const slide = firstSlide(engine)

    expect(() => engine.reparentNode(slide.scene.root.id, slide.scene.root.id)).toThrow(/root/i)

    const a = engine.createNode(slide.scene.id, slide.scene.root.id, 'A')
    expect(() => engine.reparentNode(slide.scene.root.id, a.id)).toThrow(/root/i)
  })

  it('rejects reparenting to an unknown parent', () => {
    const engine = setupEngine()
    const slide = firstSlide(engine)
    const a = engine.createNode(slide.scene.id, slide.scene.root.id, 'A')

    expect(() => engine.reparentNode(a.id, 'ghost')).toThrow(/parent.*not found/i)
  })

  it('rejects reparenting an unknown node', () => {
    const engine = setupEngine()
    const slide = firstSlide(engine)

    expect(() => engine.reparentNode('ghost', slide.scene.root.id)).toThrow(/node.*not found/i)
  })
})
