import { describe, expect, it } from 'vitest'
import { generateMesh } from '../../engine/meshGenerator'

function image(
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

function expectValidMesh(result: ReturnType<typeof generateMesh>): void {
  expect(result.vertices.length).toBeGreaterThan(0)
  expect(result.faces.length).toBeGreaterThan(0)
  expect(result.uvs).toHaveLength(result.vertices.length)
  for (const face of result.faces) {
    expect(new Set([face.v0, face.v1, face.v2]).size).toBe(3)
    for (const index of [face.v0, face.v1, face.v2]) {
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(result.vertices.length)
    }
  }
}

describe('generateMesh', () => {
  it('generates deterministic UV-mapped triangles for a rectangle', () => {
    const input = image(8, 6, () => true)
    const result = generateMesh({ imageData: input, density: 50 })
    expectValidMesh(result)
    expect(result.vertices.slice(0, 4)).toEqual([
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 6 },
      { x: 0, y: 6 },
    ])
    expect(result.uvs[0]).toEqual({ u: 0, v: 0 })
    expect(result.uvs[2]).toEqual({ u: 1, v: 1 })
    expect(generateMesh({ imageData: input, density: 50 })).toEqual(result)
  })

  it('follows a concave silhouette and preserves transparent holes', () => {
    const result = generateMesh({
      imageData: image(10, 10, (x, y) => (x < 7 && y < 7) || (x >= 3 && y >= 3)),
      density: 25,
    })
    expectValidMesh(result)
    expect(result.vertices.some((point) => point.x === 8 && point.y === 0)).toBe(false)

    const withHole = generateMesh({
      imageData: image(10, 10, (x, y) => x < 9 && y < 9 && !(x >= 3 && x < 6 && y >= 3 && y < 6)),
      density: 50,
    })
    expectValidMesh(withHole)
    expect(
      withHole.faces.some((face) =>
        [face.v0, face.v1, face.v2].every((index) => {
          const point = withHole.vertices[index]
          return point.x > 3 && point.x < 6 && point.y > 3 && point.y < 6
        }),
      ),
    ).toBe(false)
  })

  it('increases interior detail monotonically with density', () => {
    const input = image(12, 12, () => true)
    const low = generateMesh({ imageData: input, density: 0 })
    const high = generateMesh({ imageData: input, density: 100 })
    expect(high.vertices.length).toBeGreaterThan(low.vertices.length)
    expect(high.faces.length).toBeGreaterThan(low.faces.length)
  })

  it.each([
    { density: -1, message: /density/i },
    { density: 101, message: /density/i },
    { density: Number.NaN, message: /density/i },
  ])('rejects invalid density $density', ({ density, message }) => {
    expect(() => generateMesh({ imageData: image(2, 2, () => true), density })).toThrow(message)
  })

  it('rejects malformed and fully transparent images', () => {
    expect(() => generateMesh({ imageData: image(3, 3, () => false), density: 50 })).toThrow(
      /transparent/i,
    )
    expect(() =>
      generateMesh({
        imageData: { width: 3, height: 3, data: new Uint8ClampedArray(1) } as ImageData,
        density: 50,
      }),
    ).toThrow(/exactly/i)
  })
})
