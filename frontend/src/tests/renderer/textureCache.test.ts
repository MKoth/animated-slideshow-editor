import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { realPixi } from '../../pixi/renderer/pixi'
import { TextureCache } from '../../pixi/renderer/textureCache'
import {
  FakeTexture,
  assetLoadCalls,
  assetUnloadCalls,
  fakeTexture,
  resetTextureRegistries,
  textureFailures,
  textureLoads,
} from './pixiFake'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./pixiFake')
  return createPixiFake()
})

describe('TextureCache', () => {
  let cache: TextureCache

  beforeEach(() => {
    fakeTexture.calls.length = 0
    resetTextureRegistries()
    cache = new TextureCache(realPixi)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a placeholder texture for an unknown key', () => {
    const texture = cache.get('node-1')

    expect(texture).toBeDefined()
    expect(texture.destroyed).toBe(false)
  })

  it('returns the same texture for repeated lookups of the same key', () => {
    const first = cache.get('node-1')
    const second = cache.get('node-1')

    expect(second).toBe(first)
  })

  it('returns distinct textures for distinct keys', () => {
    const first = cache.get('node-1')
    const second = cache.get('node-2')

    expect(second).not.toBe(first)
  })

  it('loads a real texture for a url and caches it per key', async () => {
    textureLoads.set(
      'http://assets/def-1.png',
      new FakeTexture('def-1', { width: 512, height: 300 }),
    )
    const first = await cache.load('http://assets/def-1.png', 'def-1')
    const second = await cache.load('http://assets/def-1.png', 'def-1')

    expect(first.real).toBe(true)
    expect(first.texture).toBeDefined()
    expect(second.texture).toBe(first.texture)
    expect(assetLoadCalls).toHaveLength(1)
  })

  it('loads textures for distinct keys independently', async () => {
    textureLoads.set('http://assets/def-1.png', new FakeTexture())
    textureLoads.set('http://assets/def-2.png', new FakeTexture())
    const first = await cache.load('http://assets/def-1.png', 'def-1')
    const second = await cache.load('http://assets/def-2.png', 'def-2')

    expect(first.real).toBe(true)
    expect(second.real).toBe(true)
    expect(second.texture).not.toBe(first.texture)
    expect(assetLoadCalls).toHaveLength(2)
  })

  it('debounces concurrent loads of the same key into one fetch', async () => {
    const results = await Promise.all([
      cache.load('http://assets/def-1.png', 'def-1'),
      cache.load('http://assets/def-1.png', 'def-1'),
    ])

    expect(results[0].texture).toBe(results[1].texture)
    expect(assetLoadCalls).toHaveLength(1)
  })

  it('falls back to a cached placeholder and logs when a load fails, without retrying', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    textureFailures.set('http://assets/def-1.png', new Error('connection refused'))

    const first = await cache.load('http://assets/def-1.png', 'def-1')
    expect(first.real).toBe(false)

    const second = await cache.load('http://assets/def-1.png', 'def-1')
    expect(second.real).toBe(false)
    expect(second.texture).toBe(first.texture)
    expect(assetLoadCalls).toHaveLength(1)
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError.mock.calls[0][0]).toContain('http://assets/def-1.png')
    expect(consoleError.mock.calls[0][1]).toBeInstanceOf(Error)
    consoleError.mockRestore()
  })

  it('dispose destroys every cached texture and forgets them', () => {
    const first = cache.get('node-1')
    const second = cache.get('node-2')

    cache.dispose()

    expect(first.destroyed).toBe(true)
    expect(second.destroyed).toBe(true)
    const fresh = cache.get('node-1')
    expect(fresh).not.toBe(first)
    expect(fresh.destroyed).toBe(false)
  })

  it('unloads real textures on dispose so a fresh cache can load them again', async () => {
    const loaded = await cache.load('http://assets/def-1.png', 'def-1')
    expect(loaded.real).toBe(true)

    cache.dispose()

    expect(loaded.texture.destroyed).toBe(true)
    expect(assetUnloadCalls).toEqual(['http://assets/def-1.png'])

    const reloaded = await cache.load('http://assets/def-1.png', 'def-1')
    expect(reloaded.real).toBe(true)
    expect(reloaded.texture).not.toBe(loaded.texture)
    expect(reloaded.texture.destroyed).toBe(false)
  })

  it('creates placeholder textures from a 1x1 buffer in the key color (bgra byte order)', () => {
    cache.get('node-1')

    expect(fakeTexture.calls).toHaveLength(1)
    expect(fakeTexture.calls[0][0]).toEqual({
      resource: new Uint8Array([64, 178, 52, 255]),
      width: 1,
      height: 1,
      format: 'bgra8unorm',
    })
  })
})
