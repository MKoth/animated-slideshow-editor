import { describe, expect, it, vi } from 'vitest'
import type { Scene } from '../../engine'
import type { SceneEffect } from '../../engine/sceneEffect'
import { RevealEffectRenderer } from '../../pixi/renderer/revealEffectRenderer'
import { realPixi } from '../../pixi/renderer/pixi'
import type { TextureCache } from '../../pixi/renderer/textureCache'
import { FakeTexture } from './pixiFake'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./pixiFake')
  return createPixiFake()
})

describe('RevealEffectRenderer', () => {
  it('loads the real asset texture for effect performers instead of leaving the placeholder', async () => {
    const world = new realPixi.Container()
    const addChild = vi.spyOn(world, 'addChild')
    const placeholder = new FakeTexture('placeholder', { width: 1, height: 1 })
    const actual = new FakeTexture('paw', { width: 240, height: 180 })
    const load = vi.fn().mockResolvedValue({ texture: actual, real: true })
    const textureCache = {
      get: vi.fn().mockReturnValue(placeholder),
      load,
    } as unknown as TextureCache
    const renderer = new RevealEffectRenderer(
      world,
      realPixi,
      textureCache,
      () => ({
        assetId: 'paw-definition',
        size: { width: 120, height: 90 },
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        tint: 0xffffff,
        alpha: 1,
      }),
      (assetId) => (assetId === 'paw-definition' ? 'data:image/png;base64,cGF3' : null),
    )
    const effect: SceneEffect = {
      id: 'mark-1',
      kind: 'mark',
      start: 0,
      duration: 1,
      scopeNodeIds: ['target'],
      nodeIds: ['target'],
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 40 },
      visual: { kind: 'asset', nodeId: 'paw-node' },
    }

    renderer.update([effect], { getNode: () => ({}) } as unknown as Scene, 0.5, new Map())
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(load).toHaveBeenCalledWith('data:image/png;base64,cGF3', 'paw-definition')
    const performer = addChild.mock.calls
      .flatMap((call) => call)
      .find((child) => 'texture' in child)
    expect(performer).toBeDefined()
    expect((performer as { texture: FakeTexture }).texture).toBe(actual)
  })
})
