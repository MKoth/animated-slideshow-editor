import type { PixiTexture, RendererPixi } from './pixi'

export type ResolveAssetUrl = (definitionId: string) => string | null

export interface TextureLoadResult {
  readonly texture: PixiTexture
  readonly real: boolean
}

export class TextureCache {
  readonly #pixi: RendererPixi
  readonly #real = new Map<string, { readonly texture: PixiTexture; readonly url: string }>()
  readonly #placeholders = new Map<string, PixiTexture>()
  readonly #failed = new Set<string>()
  readonly #pending = new Map<string, Promise<TextureLoadResult>>()

  constructor(pixi: RendererPixi) {
    this.#pixi = pixi
  }

  get(key: string): PixiTexture {
    return this.#placeholderFor(key)
  }

  load(url: string, key: string): Promise<TextureLoadResult> {
    const real = this.#real.get(key)
    if (real) {
      return Promise.resolve({ texture: real.texture, real: true })
    }
    if (this.#failed.has(key)) {
      return Promise.resolve({ texture: this.#placeholderFor(key), real: false })
    }
    const pending = this.#pending.get(key)
    if (pending) {
      return pending
    }
    const result = this.#loadTexture(url, key)
    this.#pending.set(key, result)
    return result
  }

  async #loadTexture(url: string, key: string): Promise<TextureLoadResult> {
    try {
      const texture = await this.#pixi.Assets.load(url)
      this.#real.set(key, { texture, url })
      return { texture, real: true }
    } catch (error) {
      console.error(`[texture-cache] failed to load texture for "${key}" from ${url}:`, error)
      this.#failed.add(key)
      return { texture: this.#placeholderFor(key), real: false }
    } finally {
      this.#pending.delete(key)
    }
  }

  dispose(): void {
    for (const { url } of this.#real.values()) {
      void this.#pixi.Assets.unload(url)
    }
    for (const texture of this.#placeholders.values()) {
      texture.destroy(true)
    }
    this.#real.clear()
    this.#placeholders.clear()
    this.#failed.clear()
    this.#pending.clear()
  }
  #placeholderFor(key: string): PixiTexture {
    const cached = this.#placeholders.get(key)
    if (cached) {
      return cached
    }
    const texture = this.#createPlaceholder(key)
    this.#placeholders.set(key, texture)
    return texture
  }
  #createPlaceholder(key: string): PixiTexture {
    const [red, green, blue] = toRgb(placeholderColor(key))
    const buffer = new Uint8Array([blue, green, red, 255])
    return this.#pixi.Texture.from({ resource: buffer, width: 1, height: 1, format: 'bgra8unorm' })
  }
}

function placeholderColor(key: string): number {
  let hash = 0
  for (const character of key) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }
  return hslToHex(hash % 360, 55, 0.45)
}

function toRgb(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff]
}

function hslToHex(hue: number, saturation: number, lightness: number): number {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * (saturation / 100)
  const section = hue / 60
  const secondary = chroma * (1 - Math.abs((section % 2) - 1))
  const offset = lightness - chroma / 2
  let red = 0
  let green = 0
  let blue = 0
  if (section < 1) {
    red = chroma
    green = secondary
  } else if (section < 2) {
    red = secondary
    green = chroma
  } else if (section < 3) {
    green = chroma
    blue = secondary
  } else if (section < 4) {
    green = secondary
    blue = chroma
  } else if (section < 5) {
    red = secondary
    blue = chroma
  } else {
    red = chroma
    blue = secondary
  }
  const toByte = (value: number) => Math.round((value + offset) * 255)
  return (toByte(red) << 16) | (toByte(green) << 8) | toByte(blue)
}
