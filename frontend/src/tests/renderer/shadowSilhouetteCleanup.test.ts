import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEngine } from '../../engine/internal'
import { createDefaultRectangleMesh } from '../../engine/mesh'
import { DEFAULT_SHADOW_EFFECT } from '../../engine/shadowEffect'
import type { PixiContainer, RendererPixi } from '../../pixi/renderer/pixi'
import { ShaderProgramCache } from '../../pixi/renderer/programCache'
import { SceneRenderer } from '../../pixi/renderer/sceneRenderer'
import { TextureCache } from '../../pixi/renderer/textureCache'
import { FakeContainer, createPixiFake, pixiRegistry } from './pixiFake'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./pixiFake')
  return createPixiFake()
})

beforeEach(() => {
  pixiRegistry.reset()
})

describe('SceneRenderer shadow silhouette lifecycle', () => {
  it('destroys every silhouette Graphics context on initial and per-tick rebuilds', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Shadow cleanup' })
    const slide = engine.createSlide('Slide 1')
    const group = engine.createNode(slide.scene.id, slide.scene.root.id, 'Host')
    const caster = engine.createNode(slide.scene.id, group.id, 'Caster', {
      components: { mesh: { kind: 'mesh', mesh: createDefaultRectangleMesh(100, 100) } },
    })
    engine.setShadowEffect(group.id, DEFAULT_SHADOW_EFFECT)

    const pixi = createPixiFake() as unknown as RendererPixi
    const world = new FakeContainer() as unknown as PixiContainer
    const renderer = new SceneRenderer(
      engine,
      world,
      pixi,
      new TextureCache(pixi),
      () => null,
      new ShaderProgramCache(pixi),
    )
    renderer.bind(slide.scene, slide.id)
    const graphicsAfterBind = pixiRegistry.graphics.length
    expect(graphicsAfterBind).toBeGreaterThan(0)

    engine.setTransform(caster.id, { ...caster.transform, x: 40 })
    renderer.handleTimeChanged()
    expect(pixiRegistry.graphics.length).toBeGreaterThan(graphicsAfterBind)

    for (const graphics of pixiRegistry.graphics) {
      expect(graphics.destroyed).toBe(true)
      expect(graphics.contextDestroyed).toBe(true)
    }
  })
})
