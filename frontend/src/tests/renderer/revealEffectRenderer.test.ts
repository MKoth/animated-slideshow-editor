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

  it('keeps a visible performer when a visual:none sweep overlaps its nodes', async () => {
    const world = new realPixi.Container()
    const addChild = vi.spyOn(world, 'addChild')
    const placeholder = new FakeTexture('placeholder', { width: 1, height: 1 })
    const textureCache = {
      get: vi.fn().mockReturnValue(placeholder),
      load: vi.fn().mockResolvedValue({ texture: placeholder, real: false }),
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
      () => null,
    )
    // Table-border reveal with a chalk paw, plus an instant invisible
    // cell-mask setup wipe starting at the same time on a shared node.
    const reveal: SceneEffect = {
      id: 'border',
      kind: 'reveal',
      start: 52,
      duration: 1.2,
      scopeNodeIds: ['grid'],
      nodeIds: ['grid', 'c00'],
      bounds: { minX: 0, minY: 0, maxX: 400, maxY: 120 },
      visual: { kind: 'asset', nodeId: 'paw-node', scale: 4, anchorX: 0.5, anchorY: 0 },
    }
    const maskSetup: SceneEffect = {
      id: 'mask',
      kind: 'wipe',
      start: 52,
      duration: 0.01,
      scopeNodeIds: ['c00'],
      nodeIds: ['c00'],
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 30 },
      visual: { kind: 'none' },
    }

    renderer.update(
      [reveal, maskSetup],
      { getNode: () => ({}) } as unknown as Scene,
      52.5,
      new Map(),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The invisible mask sweep governs submasks but must not eat the paw:
    // a performer sprite is still drawn for the border reveal.
    const performer = addChild.mock.calls
      .flatMap((call) => call)
      .find((child) => 'texture' in child)
    expect(performer).toBeDefined()
  })

  it('opens extra trailing pixels after the reveal ends without moving the hand', () => {
    const world = new realPixi.Container()
    const textureCache = {
      get: vi.fn(),
      load: vi.fn(),
    } as unknown as TextureCache
    const renderer = new RevealEffectRenderer(
      world,
      realPixi,
      textureCache,
      () => null,
      () => null,
    )
    const reveal: SceneEffect = {
      id: 'r1',
      kind: 'reveal',
      start: 10,
      duration: 2,
      scopeNodeIds: ['n1'],
      nodeIds: ['n1'],
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 40 },
      visual: { kind: 'none' },
    }
    const container = new realPixi.Container()
    const containers = new Map([['n1', container as never]])
    const scene = { getNode: () => ({}) } as unknown as Scene
    const maskRects = () =>
      world.children
        .filter((child) => (child as { kind?: string }).kind === 'graphics')
        .flatMap((child) =>
          (
            (child as unknown as { calls: { method: string; args: unknown[] }[] }).calls ?? []
          ).filter((call) => call.method === 'rect'),
        )

    // At the exact end the mask stays tight: the hand finishes at maxX.
    renderer.update([reveal], scene, 12, containers)
    const tight = maskRects()
    expect(tight.length).toBeGreaterThan(0)
    expect(tight[tight.length - 1]!.args[2]).toBe(100)

    // After the hand is gone the mask opens extra trailing pixels.
    renderer.update([reveal], scene, 12.04, containers)
    const tailed = maskRects()
    expect(tailed.length).toBeGreaterThan(0)
    expect(tailed[tailed.length - 1]!.args[2]).toBeGreaterThan(100)
  })
})
