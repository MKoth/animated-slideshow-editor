import type { PixiTexture, RendererPixi } from './pixi'

export class TextureCache {
  readonly #pixi: RendererPixi
  readonly #textures = new Map<string, PixiTexture>()

  constructor(pixi: RendererPixi) {
    this.#pixi = pixi
  }

  get(key: string): PixiTexture {
    const cached = this.#textures.get(key)
    if (cached) {
      return cached
    }
    const texture = this.#createPlaceholder(key)
    this.#textures.set(key, texture)
    return texture
  }

  async load(_url: string, key: string): Promise<PixiTexture> {
    return this.get(key)
  }

  dispose(): void {
    for (const texture of this.#textures.values()) {
      texture.destroy(true)
    }
    this.#textures.clear()
  }
  #createPlaceholder(key: string): PixiTexture {
    const [red, green, blue] = toRgb(placeholderColor(key))
    const buffer = new Uint8Array([blue, green, red, 255])
    return this.#pixi.Texture.from({ resource: buffer, width: 1, height: 1, format: 'bgra8unorm' })
  }
}

function placeholderColor(nodeId: string): number {
  let hash = 0
  for (const character of nodeId) {
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
