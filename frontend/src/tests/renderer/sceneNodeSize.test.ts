import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Engine } from '../../engine/internal'
import { createEngine } from '../../engine/internal'
import type { PixiContainer, RendererPixi } from '../../pixi/renderer/pixi'
import { SceneRenderer } from '../../pixi/renderer/sceneRenderer'
import { TextureCache } from '../../pixi/renderer/textureCache'
import {
  FakeContainer,
  FakeTexture,
  createPixiFake,
  deferredTexture,
  pixiRegistry,
  resetTextureRegistries,
  textureDeferreds,
} from './pixiFake'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./pixiFake')
  return createPixiFake()
})

beforeEach(() => {
  pixiRegistry.reset()
  resetTextureRegistries()
})

function setup(
  engine: Engine,
  onNodeSizeChanged: (nodeId: string) => void,
): {
  renderer: SceneRenderer
  nodeId: string
} {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }
  const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Hero', {
    components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-1' } },
  })
  const pixi = createPixiFake() as unknown as RendererPixi
  const world = new FakeContainer() as unknown as PixiContainer
  const renderer = new SceneRenderer(
    engine,
    world,
    pixi,
    new TextureCache(pixi),
    (definitionId) => (definitionId === 'def-1' ? '/api/assets/originals/def-1.png' : null),
    onNodeSizeChanged,
  )
  renderer.bind(slide.scene)
  return { renderer, nodeId: node.id }
}

describe('SceneRenderer nodeSize', () => {
  it('reports the placeholder size of a bound node', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const { renderer, nodeId } = setup(engine, () => undefined)

    expect(renderer.nodeSize(nodeId)).toEqual({ width: 160, height: 100 })
  })

  it('reports null for an unknown node', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const { renderer } = setup(engine, () => undefined)

    expect(renderer.nodeSize('ghost')).toBeNull()
  })

  it('reports null for the scene root (no visual)', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const { renderer } = setup(engine, () => undefined)

    const slide = engine.project?.slides[0]
    expect(renderer.nodeSize(slide?.scene.root.id ?? 'root')).toBeNull()
  })

  it('updates to the real texture size when it resolves and fires the callback', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const deferred = deferredTexture()
    textureDeferreds.set('/api/assets/originals/def-1.png', deferred)
    const changed: string[] = []
    const { renderer, nodeId } = setup(engine, (id) => changed.push(id))
    void deferred.resolve(new FakeTexture('boy.png', { width: 512, height: 300 }))

    await deferred.promise
    await vi.waitFor(() => {
      expect(renderer.nodeSize(nodeId)).toEqual({ width: 512, height: 300 })
    })
    expect(changed).toEqual([nodeId])
  })

  it('forgets sizes when a node is removed', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const { renderer, nodeId } = setup(engine, () => undefined)
    expect(renderer.nodeSize(nodeId)).toEqual({ width: 160, height: 100 })

    renderer.handleNodeRemoved(nodeId)

    expect(renderer.nodeSize(nodeId)).toBeNull()
  })

  it('forgets sizes when the scene is rebound', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const { renderer, nodeId } = setup(engine, () => undefined)

    renderer.bind(null)

    expect(renderer.nodeSize(nodeId)).toBeNull()
  })

  it('loads a texture that was unresolved at bind time once refreshAssetTextures runs', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Hero', {
      components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-1' } },
    })
    let assetUrl: string | null = null
    const pixi = createPixiFake() as unknown as RendererPixi
    const world = new FakeContainer() as unknown as PixiContainer
    const renderer = new SceneRenderer(
      engine,
      world,
      pixi,
      new TextureCache(pixi),
      () => assetUrl,
      () => undefined,
    )
    renderer.bind(slide.scene)
    expect(renderer.nodeSize(node.id)).toEqual({ width: 160, height: 100 })

    const deferred = deferredTexture()
    textureDeferreds.set('/api/assets/originals/def-1.png', deferred)
    assetUrl = '/api/assets/originals/def-1.png'
    renderer.refreshAssetTextures()
    void deferred.resolve(new FakeTexture('boy.png', { width: 512, height: 300 }))

    await deferred.promise
    await vi.waitFor(() => {
      expect(renderer.nodeSize(node.id)).toEqual({ width: 512, height: 300 })
    })
  })
})
