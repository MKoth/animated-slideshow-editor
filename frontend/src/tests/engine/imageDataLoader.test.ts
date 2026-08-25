import { describe, expect, it } from 'vitest'
import { hasTransparentPixels } from '../../engine/imageDataLoader'

function createImageData(
  width: number,
  height: number,
  visible: (x: number, y: number) => boolean,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[(y * width + x) * 4 + 3] = visible(x, y) ? 255 : 0
    }
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData
}

describe('hasTransparentPixels', () => {
  it('returns false for fully opaque images', () => {
    const imageData = createImageData(2, 2, () => true)
    expect(hasTransparentPixels(imageData)).toBe(false)
  })

  it('returns true for images with transparent pixels', () => {
    const imageData = createImageData(2, 2, (x, y) => x === 0 && y === 0)
    expect(hasTransparentPixels(imageData)).toBe(true)
  })

  it('returns true for fully transparent images', () => {
    const imageData = createImageData(2, 2, () => false)
    expect(hasTransparentPixels(imageData)).toBe(true)
  })
})
