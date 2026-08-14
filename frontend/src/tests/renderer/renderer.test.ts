import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Engine } from '../../engine/internal'
import { createEngine } from '../../engine/internal'
import { Renderer } from '../../pixi/renderer/renderer'
import { pixiRegistry } from './pixiFake'
import { resizeObserverFor } from '../setup'
import { findByLabel, mountRenderer, worldOf } from './testUtils'
import { useSelectionStore } from '../../stores/selectionStore'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./pixiFake')
  return createPixiFake()
})

beforeEach(() => {
  pixiRegistry.reset()
})

function seededEngine(): Engine {
  const engine = createEngine()
  engine.createProject({ name: 'Demo' })
  engine.createSlide('Slide 1')
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }
  engine.createNode(slide.scene.id, slide.scene.root.id, 'Hero', {
    components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-1' } },
  })
  engine.createNode(slide.scene.id, slide.scene.root.id, 'Title', {
    components: { text: { kind: 'text', content: 'Hello', fontSize: 24, alignment: 'center' } },
    transform: { x: 40, y: -30, rotation: 0.5, scaleX: 2, scaleY: 2 },
  })
  return engine
}

describe('Renderer', () => {
  it('initializes a pixi application on start and attaches its canvas to the host', async () => {
    const { host } = await mountRenderer(createEngine())
    const app = pixiRegistry.applications[0]

    expect(app).toBeDefined()
    expect(app.initOptions.resizeTo).toBe(host)
    expect(app.initOptions.autoDensity).toBe(true)
    expect(host.contains(app.canvas)).toBe(true)
  })

  it('resizes the renderer to match the host element when it changes size', async () => {
    const { host, app } = await mountRenderer(createEngine())
    const observer = resizeObserverFor(host)
    expect(observer).toBeDefined()

    const resize = vi.spyOn(app.renderer, 'resize')
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 420 })
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 310 })

    observer?.trigger()

    expect(resize).toHaveBeenCalledWith(420, 310)
  })

  it('displays an empty scene with the grid and axis lines at the origin when no project exists', async () => {
    const { app } = await mountRenderer(createEngine())
    const world = worldOf(app)

    expect(world.children).toHaveLength(4)
    expect(world.children[0].label).toBe('grid')
    const axisLines = world.children[1]
    expect(axisLines.position.x).toBe(0)
    expect(axisLines.position.y).toBe(0)
    const lines = axisLines.children[0]
    expect(lines.ops?.filter((op) => op === 'lineTo')).toHaveLength(2)
    expect(world.children[2].kind).toBe('graphics')
    expect(world.children[3].label).toBe('guides')
  })

  it('renders a placeholder for asset instances and text nodes, and none for the camera', async () => {
    const { app } = await mountRenderer(seededEngine())
    const root = findByLabel(worldOf(app), 'Root')
    if (!root) {
      throw new Error('Root container not found')
    }

    const hero = findByLabel(root, 'Hero')
    expect(hero).toBeDefined()
    expect(hero?.children).toHaveLength(1)
    const heroPlaceholder = hero?.children[0]
    const heroBox = heroPlaceholder?.children.find((child) => child.kind === 'sprite')
    expect(heroBox).toBeDefined()
    expect(
      heroPlaceholder?.children.some((child) => child.kind === 'text' && child.text === 'Hero'),
    ).toBe(true)

    const title = findByLabel(root, 'Title')
    expect(
      title?.children.some((child) =>
        child.children.some((entry) => entry.kind === 'text' && entry.text === 'Title'),
      ),
    ).toBe(true)

    const camera = findByLabel(root, 'Camera')
    expect(camera).toBeDefined()
    expect(camera?.children).toHaveLength(0)
  })

  it('maps transforms directly onto display objects (1 world unit = 1 px at identity)', async () => {
    const { app } = await mountRenderer(seededEngine())
    const root = findByLabel(worldOf(app), 'Root')
    const title = findByLabel(root ?? { children: [] }, 'Title')

    expect(title?.position.x).toBe(40)
    expect(title?.position.y).toBe(-30)
    expect(title?.rotation).toBe(0.5)
    expect(title?.scale.x).toBe(2)
    expect(title?.scale.y).toBe(2)
  })

  it('creates, removes, transforms and hides display objects within the same event turn', async () => {
    const engine = seededEngine()
    const { app } = await mountRenderer(engine)
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const root = findByLabel(worldOf(app), 'Root')
    if (!root) {
      throw new Error('Root container not found')
    }

    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Latecomer')
    const container = findByLabel(root, 'Latecomer')
    expect(container).toBeDefined()

    engine.setTransform(node.id, { x: 77, y: 66, rotation: 0, scaleX: 1, scaleY: 1 })
    expect(container?.position.x).toBe(77)
    expect(container?.position.y).toBe(66)

    engine.setVisibility(node.id, false)
    expect(container?.visible).toBe(false)

    engine.removeNode(node.id)
    expect(findByLabel(root, 'Latecomer')).toBeUndefined()
    expect(container?.destroyed).toBe(true)
  })

  it('removes display objects for the whole subtree when a node with children is removed', async () => {
    const engine = seededEngine()
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const group = engine.createNode(slide.scene.id, slide.scene.root.id, 'Group')
    const child = engine.createNode(slide.scene.id, group.id, 'Child')
    engine.createNode(slide.scene.id, child.id, 'Grandchild')
    const { app } = await mountRenderer(engine)

    const root = findByLabel(worldOf(app), 'Root')
    if (!root) {
      throw new Error('Root container not found')
    }
    const groupContainer = findByLabel(root, 'Group')
    expect(findByLabel(groupContainer ?? { children: [] }, 'Child')).toBeDefined()

    engine.removeNode(group.id)

    expect(findByLabel(root, 'Group')).toBeUndefined()
    expect(groupContainer?.destroyed).toBe(true)

    const reborn = engine.createNode(slide.scene.id, slide.scene.root.id, 'Reborn', {
      id: child.id,
    })
    expect(findByLabel(root, 'Reborn')).toBeDefined()
    expect(reborn.id).toBe(child.id)
  })

  it('places child display objects under their parent display object', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    engine.createSlide('S1')
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Group')
    engine.createNode(slide.scene.id, parent.id, 'Child')
    const { app } = await mountRenderer(engine)

    const root = findByLabel(worldOf(app), 'Root')
    const group = findByLabel(root ?? { children: [] }, 'Group')
    const child = findByLabel(group ?? { children: [] }, 'Child')
    expect(child).toBeDefined()
    expect(group?.children.map((entry) => entry.label)).toContain('Child')
  })

  it('moves a display object and its whole subtree under the new parent on reparent', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    engine.createSlide('S1')
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const group = engine.createNode(slide.scene.id, slide.scene.root.id, 'Group')
    const leaf = engine.createNode(slide.scene.id, slide.scene.root.id, 'Leaf')
    engine.createNode(slide.scene.id, leaf.id, 'Child')
    const { app } = await mountRenderer(engine)

    const root = findByLabel(worldOf(app), 'Root')
    if (!root) {
      throw new Error('Root container not found')
    }
    const groupContainer = findByLabel(root, 'Group')
    const leafContainer = findByLabel(root, 'Leaf')
    if (!groupContainer || !leafContainer) {
      throw new Error('Containers not found')
    }
    expect(findByLabel(leafContainer, 'Child')).toBeDefined()

    engine.reparentNode(leaf.id, group.id)

    expect(root.children.map((entry) => entry.label)).not.toContain('Leaf')
    expect(groupContainer.children.map((entry) => entry.label)).toContain('Leaf')
    expect(findByLabel(leafContainer, 'Child')).toBeDefined()

    engine.reparentNode(leaf.id, slide.scene.root.id)
    expect(root.children.map((entry) => entry.label)).toContain('Leaf')
  })

  it('ignores events for nodes in other scenes', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const first = engine.createSlide('S1')
    engine.createSlide('S2')
    engine.setActiveSlide(first.id)
    const second = engine.project?.slides[1]
    if (!second) {
      throw new Error('Slide was not created')
    }
    const { app } = await mountRenderer(engine)
    const world = worldOf(app)

    const before = world.children.length
    const foreign = engine.createNode(second.scene.id, second.scene.root.id, 'Foreign')
    const sibling = engine.createNode(second.scene.id, second.scene.root.id, 'Sibling')
    engine.setTransform(foreign.id, { x: 1, y: 1, rotation: 0, scaleX: 1, scaleY: 1 })
    engine.setVisibility(foreign.id, false)
    engine.reparentNode(foreign.id, sibling.id)

    expect(world.children).toHaveLength(before)
  })

  it('rebinds to the slide that becomes active when the bound slide is removed', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const first = engine.createSlide('S1')
    engine.createSlide('S2')
    engine.setActiveSlide(first.id)
    const second = engine.project?.slides[1]
    if (!second) {
      throw new Error('Slides were not created')
    }
    engine.createNode(first.scene.id, first.scene.root.id, 'FirstNode')
    engine.createNode(second.scene.id, second.scene.root.id, 'SecondNode')
    const { app } = await mountRenderer(engine)
    const world = worldOf(app)
    const root = findByLabel(world, 'Root')
    if (!root) {
      throw new Error('Root container not found')
    }

    expect(findByLabel(root, 'FirstNode')).toBeDefined()
    engine.removeSlide(first.id)
    expect(findByLabel(world, 'FirstNode')).toBeUndefined()
    const newRoot = findByLabel(world, 'Root')
    expect(findByLabel(newRoot ?? { children: [] }, 'SecondNode')).toBeDefined()
  })

  it('follows the active slide when a new slide is added', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const first = engine.createSlide('S1')
    engine.setActiveSlide(first.id)
    engine.createNode(first.scene.id, first.scene.root.id, 'FirstNode')
    const { app } = await mountRenderer(engine)
    const world = worldOf(app)
    const root = findByLabel(world, 'Root')
    if (!root) {
      throw new Error('Root container not found')
    }

    const second = engine.createSlide('S2')
    const secondNode = engine.createNode(second.scene.id, second.scene.root.id, 'SecondNode')
    engine.setTransform(secondNode.id, { x: 9, y: 9, rotation: 0, scaleX: 1, scaleY: 1 })

    expect(findByLabel(world, 'FirstNode')).toBeUndefined()
    const newRoot = findByLabel(world, 'Root')
    expect(findByLabel(newRoot ?? { children: [] }, 'SecondNode')).toBeDefined()
    expect(findByLabel(newRoot ?? { children: [] }, 'SecondNode')?.position.x).toBe(9)
  })

  it('shows an error overlay and logs details when initialization fails, without crashing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    pixiRegistry.failNextInit = true
    const host = document.createElement('div')
    const renderer = new Renderer(host, createEngine())

    await expect(renderer.start()).resolves.toBeUndefined()

    const overlay = host.querySelector('.canvas-error-overlay')
    expect(overlay).not.toBeNull()
    expect(overlay?.textContent).toContain('WebGL context creation failed')
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('keeps the error overlay visible after a failed initialization when engine events arrive', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    pixiRegistry.failNextInit = true
    const engine = createEngine()
    const host = document.createElement('div')
    const renderer = new Renderer(host, engine)
    await renderer.start()

    engine.createProject({ name: 'P' })
    engine.createSlide('S1')

    expect(host.querySelector('.canvas-error-overlay')).not.toBeNull()
    consoleError.mockRestore()
  })

  it('shows an error overlay when an event update fails, then recovers', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const engine = seededEngine()
    const { host, app } = await mountRenderer(engine)
    const slide = engine.project?.slides[0]
    const root = findByLabel(worldOf(app), 'Root')
    if (!slide || !root) {
      throw new Error('Setup failed')
    }
    const node = slide.scene.root.children[1]
    const getNode = vi.spyOn(engine, 'getNode').mockImplementationOnce(() => {
      throw new Error('broken lookup')
    })

    engine.setTransform(node.id, { x: 1, y: 2, rotation: 0, scaleX: 1, scaleY: 1 })

    const overlay = host.querySelector('.canvas-error-overlay')
    expect(overlay).not.toBeNull()
    expect(overlay?.textContent).toContain('broken lookup')
    expect(consoleError).toHaveBeenCalled()

    engine.setTransform(node.id, { x: 5, y: 6, rotation: 0, scaleX: 1, scaleY: 1 })
    expect(host.querySelector('.canvas-error-overlay')).toBeNull()

    getNode.mockRestore()
    consoleError.mockRestore()
  })

  it('dispose unsubscribes from events and destroys the application', async () => {
    const engine = seededEngine()
    const { host, renderer, app } = await mountRenderer(engine)
    const slide = engine.project?.slides[0]
    const root = findByLabel(worldOf(app), 'Root')
    if (!slide || !root) {
      throw new Error('Setup failed')
    }

    renderer.dispose()

    expect(app.destroyed).toBe(true)
    expect(host.contains(app.canvas)).toBe(false)
    expect(host.querySelector('.canvas-error-overlay')).toBeNull()

    engine.createNode(slide.scene.id, slide.scene.root.id, 'AfterDispose')
    expect(findByLabel(root, 'AfterDispose')).toBeUndefined()
  })

  it('releases every cached placeholder texture on dispose', async () => {
    const { renderer, app } = await mountRenderer(seededEngine())
    const root = findByLabel(worldOf(app), 'Root')
    const hero = findByLabel(root ?? { children: [] }, 'Hero')
    const title = findByLabel(root ?? { children: [] }, 'Title')
    const textures = [hero, title]
      .filter((node) => node !== undefined)
      .flatMap((node) => node?.children ?? [])
      .flatMap((placeholder) => placeholder?.children ?? [])
      .filter((child) => child.kind === 'sprite')
      .map((sprite) => sprite.texture)
    expect(textures.length).toBeGreaterThan(0)

    renderer.dispose()

    for (const texture of textures) {
      expect(texture?.destroyed).toBe(true)
    }
  })

  it('applies node opacity to the display object alpha', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    engine.createSlide('S1')
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const translucent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Faded', {
      opacity: 0.5,
      components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-1' } },
    })
    const { app } = await mountRenderer(engine)
    const root = findByLabel(worldOf(app), 'Root')
    const faded = findByLabel(root ?? { children: [] }, 'Faded')

    expect(faded?.alpha).toBe(0.5)

    engine.setOpacity(translucent.id, 0.25)
    expect(faded?.alpha).toBe(0.25)

    engine.setOpacity(translucent.id, 1)
    expect(faded?.alpha).toBe(1)
  })

  it('updates the container label and placeholder text when a node is renamed', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    engine.createSlide('S1')
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Hero', {
      components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-1' } },
    })
    const { app } = await mountRenderer(engine)
    const root = findByLabel(worldOf(app), 'Root')
    const hero = findByLabel(root ?? { children: [] }, 'Hero')
    if (!hero) {
      throw new Error('Hero container not found')
    }
    const placeholder = hero.children[0]
    const placeholderLabel = placeholder?.children.find((child) => child.kind === 'text')

    engine.renameNode(node.id, 'Fox')

    expect(hero.label).toBe('Fox')
    expect(placeholder?.label).toBe('placeholder:Fox')
    expect(placeholderLabel?.kind === 'text' ? placeholderLabel.text : undefined).toBe('Fox')
    expect(findByLabel(root ?? { children: [] }, 'Hero')).toBeUndefined()
  })

  it('applies opacity and name changes to nodes in the bound scene only', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const first = engine.createSlide('S1')
    engine.createSlide('S2')
    engine.setActiveSlide(first.id)
    const second = engine.project?.slides[1]
    if (!first || !second) {
      throw new Error('Slides were not created')
    }
    const { app } = await mountRenderer(engine)
    const world = worldOf(app)
    const before = world.children.length
    const foreign = engine.createNode(second.scene.id, second.scene.root.id, 'Foreign', {
      opacity: 0.25,
    })

    expect(world.children).toHaveLength(before)
    engine.setOpacity(foreign.id, 0.5)
    engine.renameNode(foreign.id, 'Renamed')
    expect(world.children).toHaveLength(before)
  })

  it('binds the active slide scene and rebinds on SlideActivated', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const first = engine.createSlide('S1')
    const second = engine.createSlide('S2')
    engine.setActiveSlide(first.id)
    engine.createNode(first.scene.id, first.scene.root.id, 'FirstNode')
    engine.createNode(second.scene.id, second.scene.root.id, 'SecondNode')
    const { app } = await mountRenderer(engine)
    const world = worldOf(app)

    const firstRoot = findByLabel(world, 'Root')
    expect(findByLabel(firstRoot ?? { children: [] }, 'FirstNode')).toBeDefined()
    expect(findByLabel(world, 'SecondNode')).toBeUndefined()

    engine.setActiveSlide(second.id)

    const secondRoot = findByLabel(world, 'Root')
    expect(findByLabel(world, 'FirstNode')).toBeUndefined()
    expect(findByLabel(secondRoot ?? { children: [] }, 'SecondNode')).toBeDefined()
    const previous = world.children.find((child) => child.label === 'Root')
    expect(previous === secondRoot || previous?.destroyed).toBe(true)
  })

  it('rebinds to the first slide of the incoming project on openProject', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const first = engine.createSlide('S1')
    engine.createNode(first.scene.id, first.scene.root.id, 'OldNode')
    const { app } = await mountRenderer(engine)
    const world = worldOf(app)
    const initialRoot = findByLabel(world, 'Root')
    expect(findByLabel(initialRoot ?? { children: [] }, 'OldNode')).toBeDefined()

    const incoming = createEngine()
    incoming.createProject({ name: 'Fresh' })
    const freshFirst = incoming.createSlide('F1')
    incoming.createSlide('F2')
    incoming.createNode(freshFirst.scene.id, freshFirst.scene.root.id, 'FreshNode')
    engine.openProject(incoming.project!)

    const root = findByLabel(world, 'Root')
    expect(findByLabel(world, 'OldNode')).toBeUndefined()
    expect(findByLabel(root ?? { children: [] }, 'FreshNode')).toBeDefined()
  })

  it('clears the scene-node selection when the bound scene changes', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const first = engine.createSlide('S1')
    const second = engine.createSlide('S2')
    engine.setActiveSlide(first.id)
    const node = engine.createNode(first.scene.id, first.scene.root.id, 'FirstNode')
    await mountRenderer(engine)
    useSelectionStore.getState().select(node.id)

    engine.setActiveSlide(second.id)

    expect(useSelectionStore.getState().selectedIds).toEqual([])
  })
})
