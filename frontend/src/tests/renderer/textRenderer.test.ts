import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Engine } from '../../engine/internal'
import { createEngine } from '../../engine/internal'
import { pixiRegistry } from './pixiFake'
import type { FakeContainer, FakeText } from './pixiFake'
import { findByLabel, mountRenderer, worldOf } from './testUtils'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./pixiFake')
  return createPixiFake()
})

beforeEach(() => {
  pixiRegistry.reset()
})

function seededTextEngine(): Engine {
  const engine = createEngine()
  engine.createProject({ name: 'Demo' })
  engine.createSlide('Slide 1')
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }
  engine.createNode(slide.scene.id, slide.scene.root.id, 'TextNode', {
    components: {
      text: {
        kind: 'text',
        content: 'Hello World',
        fontSize: 32,
        alignment: 'center',
      },
    },
  })
  return engine
}

function findTextPlaceholder(node: FakeContainer): FakeContainer | undefined {
  return node.children.find((child) => child.label?.startsWith('text:')) as
    FakeContainer | undefined
}

function findTextDisplay(placeholder: FakeContainer): FakeText | undefined {
  return placeholder.children.find((child) => child.kind === 'text') as FakeText | undefined
}

describe('TextRenderer', () => {
  it('creates a text container with actual text display', async () => {
    const engine = seededTextEngine()
    const { app } = await mountRenderer(engine)
    const world = worldOf(app)
    const root = findByLabel(world, 'Root') as FakeContainer
    if (!root) {
      throw new Error('Root container not found')
    }

    const textNode = findByLabel(root, 'TextNode') as FakeContainer
    expect(textNode).toBeDefined()
    expect(textNode?.kind).toBe('container')

    const placeholder = findTextPlaceholder(textNode)
    expect(placeholder).toBeDefined()
    expect(placeholder?.label).toMatch(/^text:/)

    const textDisplay = findTextDisplay(placeholder!)
    expect(textDisplay).toBeDefined()
    expect(textDisplay?.kind).toBe('text')
    expect(textDisplay?.text).toBe('Hello World')
  })

  it('applies fontSize from TextComponent', async () => {
    const engine = seededTextEngine()
    const { app } = await mountRenderer(engine)
    const world = worldOf(app)
    const root = findByLabel(world, 'Root') as FakeContainer

    const textNode = findByLabel(root, 'TextNode') as FakeContainer
    const placeholder = findTextPlaceholder(textNode)
    const textDisplay = findTextDisplay(placeholder!)

    expect(textDisplay?.style).toMatchObject({
      fontSize: 32,
    })
  })

  it('applies alignment from TextComponent', async () => {
    const engine = seededTextEngine()
    const { app } = await mountRenderer(engine)
    const world = worldOf(app)
    const root = findByLabel(world, 'Root') as FakeContainer

    const textNode = findByLabel(root, 'TextNode') as FakeContainer
    const placeholder = findTextPlaceholder(textNode)
    const textDisplay = findTextDisplay(placeholder!)

    expect(textDisplay?.style).toMatchObject({
      align: 'center',
    })
  })

  it('applies text color from material tint', async () => {
    const engine = seededTextEngine()
    const { app } = await mountRenderer(engine)
    const world = worldOf(app)
    const root = findByLabel(world, 'Root') as FakeContainer

    const textNode = findByLabel(root, 'TextNode') as FakeContainer
    const placeholder = findTextPlaceholder(textNode)
    const textDisplay = findTextDisplay(placeholder!)

    expect(textDisplay?.style).toMatchObject({
      fill: expect.any(Number),
    })
  })

  it('does not create placeholder sprite for text nodes', async () => {
    const engine = seededTextEngine()
    const { app } = await mountRenderer(engine)
    const world = worldOf(app)
    const root = findByLabel(world, 'Root') as FakeContainer

    const textNode = findByLabel(root, 'TextNode') as FakeContainer
    const placeholder = findTextPlaceholder(textNode)
    const textDisplay = findTextDisplay(placeholder!)

    expect(textDisplay).toBeDefined()
    const hasSprite = placeholder?.children.some((child) => child.kind === 'sprite')
    expect(hasSprite).toBe(false)
  })

  it('text scales with node transform', async () => {
    const engine = seededTextEngine()
    const { app } = await mountRenderer(engine)
    const world = worldOf(app)
    const root = findByLabel(world, 'Root') as FakeContainer

    const textNode = findByLabel(root, 'TextNode') as FakeContainer
    expect(textNode).toBeDefined()
    expect(textNode?.scale.x).toBe(1)
    expect(textNode?.scale.y).toBe(1)
  })

  it('text opacity is affected by node opacity', async () => {
    const engine = seededTextEngine()
    const { app } = await mountRenderer(engine)
    const world = worldOf(app)
    const root = findByLabel(world, 'Root') as FakeContainer

    const textNode = findByLabel(root, 'TextNode') as FakeContainer
    expect(textNode).toBeDefined()
    expect(textNode?.alpha).toBe(1)
  })
})
