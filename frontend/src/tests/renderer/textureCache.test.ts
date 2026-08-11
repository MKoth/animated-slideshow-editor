import { beforeEach, describe, expect, it, vi } from 'vitest'
import { realPixi } from '../../pixi/renderer/pixi'
import { TextureCache } from '../../pixi/renderer/textureCache'
import { fakeTexture } from './pixiFake'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./pixiFake')
  return createPixiFake()
})

describe('TextureCache', () => {
  let cache: TextureCache

  beforeEach(() => {
    fakeTexture.calls.length = 0
    cache = new TextureCache(realPixi)
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

  it('load resolves with the placeholder texture for the key', async () => {
    const texture = await cache.load('http://assets/def-1.png', 'node-1')

    expect(texture).toBeDefined()
    expect(texture.destroyed).toBe(false)
  })

  it('load and get share the same cached texture for a key', async () => {
    const loaded = await cache.load('http://assets/def-1.png', 'node-1')
    const retrieved = cache.get('node-1')

    expect(retrieved).toBe(loaded)
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
