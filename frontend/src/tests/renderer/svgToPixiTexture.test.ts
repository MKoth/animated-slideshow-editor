import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { realPixi } from '../../pixi/renderer/pixi'
import type { PixiTexture } from '../../pixi/renderer/pixi'
import { svgToPixiTextureAsync } from '../../pixi/renderer/svgToPixiTexture'
import { FakeTexture } from './pixiFake'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./pixiFake')
  return createPixiFake()
})

describe('svgToPixiTextureAsync', () => {
  let createObjectURLSpy: ReturnType<typeof vi.fn>
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>
  let drawImageSpy: ReturnType<typeof vi.fn>
  const imageCallbacks: Array<() => void> = []

  beforeEach(() => {
    imageCallbacks.length = 0
    createObjectURLSpy = vi.fn(() => 'blob:mock-url')
    revokeObjectURLSpy = vi.fn()
    vi.spyOn(globalThis.URL, 'createObjectURL').mockImplementation(createObjectURLSpy as never)
    vi.spyOn(globalThis.URL, 'revokeObjectURL').mockImplementation(revokeObjectURLSpy as never)

    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb: FrameRequestCallback) => {
        cb(0)
        return 0
      }),
    )

    drawImageSpy = vi.fn()
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage: drawImageSpy }),
        } as unknown as HTMLCanvasElement
      }
      return document.createElement.call(document, tag)
    })

    vi.stubGlobal(
      'Image',
      function (this: Record<string, unknown>) {
        this.onload = null
        this.onerror = null
        this.naturalWidth = 100
        this.naturalHeight = 50
        const self = this as {
          onload: (() => void) | null
        }
        imageCallbacks.push(() => {
          if (self.onload) {
            self.onload()
          }
        })
      } as unknown as typeof Image,
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function makeSvg(
    attrs: Record<string, string> = { width: '200', height: '100' },
  ): SVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    for (const [key, value] of Object.entries(attrs)) {
      svg.setAttribute(key, value)
    }
    return svg
  }

  it('produces a valid PIXI.Texture from an SVG element', async () => {
    const promise = svgToPixiTextureAsync(realPixi, makeSvg())
    imageCallbacks[0]?.()
    const texture = await promise

    expect(texture).toBeDefined()
  })

  it('produces a texture with the correct dimensions at default resolution', async () => {
    vi.spyOn(realPixi.Texture, 'from').mockImplementation(((source: unknown) => {
      const canvas = source as HTMLCanvasElement
      return new FakeTexture(undefined, {
        width: canvas.width,
        height: canvas.height,
      })
    }) as never)

    const promise = svgToPixiTextureAsync(realPixi, makeSvg())
    imageCallbacks[0]?.()
    const texture: PixiTexture = await promise

    expect(texture.width).toBe(200)
    expect(texture.height).toBe(100)
  })

  it('uses the default resolution of 2', async () => {
    const fakeTexture = new FakeTexture()
    vi.spyOn(realPixi.Texture, 'from').mockReturnValue(fakeTexture as never)

    const promise = svgToPixiTextureAsync(realPixi, makeSvg())
    imageCallbacks[0]?.()
    await promise

    expect(realPixi.Texture.from).toHaveBeenCalledTimes(1)
  })

  it('allows configurable resolution', async () => {
    const fakeTexture = new FakeTexture()
    vi.spyOn(realPixi.Texture, 'from').mockReturnValue(fakeTexture as never)

    const promise = svgToPixiTextureAsync(realPixi, makeSvg(), { resolution: 3 })
    imageCallbacks[0]?.()
    await promise

    expect(realPixi.Texture.from).toHaveBeenCalledTimes(1)
  })

  it('sets alphaMode on the texture source', async () => {
    const fakeSource = { alphaMode: 'premultiply-alpha-on-upload' }
    const fakeTexture = Object.create(FakeTexture.prototype, {
      width: { value: 200 },
      height: { value: 100 },
      source: { value: fakeSource, writable: true },
    })
    vi.spyOn(realPixi.Texture, 'from').mockReturnValue(fakeTexture as never)

    const promise = svgToPixiTextureAsync(realPixi, makeSvg())
    imageCallbacks[0]?.()
    await promise

    expect(fakeSource.alphaMode).toBe('premultiply-alpha-on-upload')
  })

  it('allows custom alphaMode', async () => {
    const fakeSource = { alphaMode: 'premultiply-alpha-on-upload' }
    const fakeTexture = Object.create(FakeTexture.prototype, {
      width: { value: 200 },
      height: { value: 100 },
      source: { value: fakeSource, writable: true },
    })
    vi.spyOn(realPixi.Texture, 'from').mockReturnValue(fakeTexture as never)

    const promise = svgToPixiTextureAsync(realPixi, makeSvg(), {
      alphaMode: 'no-premultiply-alpha',
    })
    imageCallbacks[0]?.()
    await promise

    expect(fakeSource.alphaMode).toBe('no-premultiply-alpha')
  })

  it('calls requestAnimationFrame twice for Safari compositing workaround', async () => {
    const rafSpy = vi.fn((cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
    vi.stubGlobal('requestAnimationFrame', rafSpy)

    const promise = svgToPixiTextureAsync(realPixi, makeSvg())
    imageCallbacks[0]?.()
    await promise

    expect(rafSpy).toHaveBeenCalledTimes(2)
  })

  it('revokes the blob URL after texture creation (no memory leak)', async () => {
    const promise = svgToPixiTextureAsync(realPixi, makeSvg())
    imageCallbacks[0]?.()
    await promise

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url')
  })

  it('revokes the blob URL even if texture creation fails', async () => {
    vi.spyOn(realPixi.Texture, 'from').mockImplementation(() => {
      throw new Error('texture creation failed')
    })

    const promise = svgToPixiTextureAsync(realPixi, makeSvg())
    imageCallbacks[0]?.()
    await expect(promise).rejects.toThrow('texture creation failed')

    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1)
  })

  it('serializes the SVG element to a string', async () => {
    const serializer = new XMLSerializer()
    const serializeSpy = vi.spyOn(serializer, 'serializeToString')
    vi.stubGlobal(
      'XMLSerializer',
      vi.fn(function () {
        return serializer
      }),
    )

    const svg = makeSvg()
    const promise = svgToPixiTextureAsync(realPixi, svg)
    imageCallbacks[0]?.()
    await promise

    expect(serializeSpy).toHaveBeenCalledTimes(1)
    expect(serializeSpy).toHaveBeenCalledWith(svg)
  })

  it('creates a blob URL with SVG MIME type', async () => {
    const promise = svgToPixiTextureAsync(realPixi, makeSvg())
    imageCallbacks[0]?.()
    await promise

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
    const blobArg = createObjectURLSpy.mock.calls[0][0]
    expect(blobArg).toBeInstanceOf(Blob)
  })

  it('returns a texture with correct dimensions at resolution 3', async () => {
    vi.spyOn(realPixi.Texture, 'from').mockImplementation(((source: unknown) => {
      const canvas = source as HTMLCanvasElement
      return new FakeTexture(undefined, {
        width: canvas.width,
        height: canvas.height,
      })
    }) as never)

    const promise = svgToPixiTextureAsync(realPixi, makeSvg(), { resolution: 3 })
    imageCallbacks[0]?.()
    const texture: PixiTexture = await promise

    expect(texture.width).toBe(300)
    expect(texture.height).toBe(150)
  })

  it('throws if SVG loading fails', async () => {
    const errorCallbacks: Array<() => void> = []
    vi.stubGlobal(
      'Image',
      function (this: Record<string, unknown>) {
        this.onload = null
        this.onerror = null
        this.naturalWidth = 0
        this.naturalHeight = 0
        const self = this as { onerror: (() => void) | null }
        errorCallbacks.push(() => {
          if (self.onerror) {
            self.onerror()
          }
        })
      } as unknown as typeof Image,
    )

    const svg = makeSvg()
    const promise = svgToPixiTextureAsync(realPixi, svg)
    errorCallbacks[0]?.()
    await expect(promise).rejects.toThrow('Failed to load SVG from blob URL')
  })
})
