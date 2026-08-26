import { describe, expect, it } from 'vitest'
import { generateMesh } from '../../engine/meshGenerator'
import type { MeshGeneratorInput } from '../../engine/meshGenerator'

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

function defaults(overrides?: Partial<MeshGeneratorInput>): MeshGeneratorInput {
  return {
    imageData: image(8, 6, () => true),
    meshDensity: 30,
    boundarySpacing: 8,
    jointDensity: 2.0,
    jointRadius: 60,
    jointMinDist: 20,
    maxVertices: 300,
    ...overrides,
  }
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
    const input = defaults({ imageData: image(8, 6, () => true) })
    const result = generateMesh(input)
    expectValidMesh(result)
    expect(result.uvs[0]).toEqual({ u: 0, v: 0 })
    const uMin = Math.min(...result.uvs.map((uv) => uv.u))
    const uMax = Math.max(...result.uvs.map((uv) => uv.u))
    const vMin = Math.min(...result.uvs.map((uv) => uv.v))
    const vMax = Math.max(...result.uvs.map((uv) => uv.v))
    expect(uMin).toBe(0)
    expect(uMax).toBe(1)
    expect(vMin).toBe(0)
    expect(vMax).toBe(1)
    expect(generateMesh(input)).toEqual(result)
  })

  it('follows a concave silhouette and preserves transparent holes', () => {
    const result = generateMesh(
      defaults({
        imageData: image(10, 10, (x, y) => (x < 7 && y < 7) || (x >= 3 && y >= 3)),
      }),
    )
    expectValidMesh(result)

    const withHole = generateMesh(
      defaults({
        imageData: image(10, 10, (x, y) => x < 9 && y < 9 && !(x >= 3 && x < 6 && y >= 3 && y < 6)),
      }),
    )
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

  it('increases interior detail with higher mesh density', () => {
    const input = image(12, 12, () => true)
    const low = generateMesh(defaults({ imageData: input, meshDensity: 10 }))
    const high = generateMesh(defaults({ imageData: input, meshDensity: 80 }))
    expect(high.vertices.length).toBeGreaterThanOrEqual(low.vertices.length)
    expect(high.faces.length).toBeGreaterThanOrEqual(low.faces.length)
  })

  it('centers vertices while keeping UVs in image-coordinate space', () => {
    const input = image(8, 6, () => true)
    const result = generateMesh(defaults({ imageData: input }))
    const minX = Math.min(...result.vertices.map((v) => v.x))
    const maxX = Math.max(...result.vertices.map((v) => v.x))
    const minY = Math.min(...result.vertices.map((v) => v.y))
    const maxY = Math.max(...result.vertices.map((v) => v.y))
    expect(minX).toBe(-4)
    expect(maxX).toBe(4)
    expect(minY).toBe(-3)
    expect(maxY).toBe(3)
    expect(result.uvs[0]).toEqual({ u: 0, v: 0 })
    const uMax = Math.max(...result.uvs.map((uv) => uv.u))
    const vMax = Math.max(...result.uvs.map((uv) => uv.v))
    expect(uMax).toBe(1)
    expect(vMax).toBe(1)
  })

  it('rejects invalid mesh density', () => {
    expect(() =>
      generateMesh(defaults({ imageData: image(2, 2, () => true), meshDensity: 5 })),
    ).toThrow(/mesh density/i)
    expect(() =>
      generateMesh(defaults({ imageData: image(2, 2, () => true), meshDensity: 81 })),
    ).toThrow(/mesh density/i)
    expect(() =>
      generateMesh(defaults({ imageData: image(2, 2, () => true), meshDensity: Number.NaN })),
    ).toThrow(/mesh density/i)
  })

  it('rejects invalid boundary spacing', () => {
    expect(() =>
      generateMesh(defaults({ imageData: image(2, 2, () => true), boundarySpacing: 1 })),
    ).toThrow(/boundary spacing/i)
    expect(() =>
      generateMesh(defaults({ imageData: image(2, 2, () => true), boundarySpacing: 31 })),
    ).toThrow(/boundary spacing/i)
  })

  it('rejects invalid joint density', () => {
    expect(() =>
      generateMesh(defaults({ imageData: image(2, 2, () => true), jointDensity: 0.5 })),
    ).toThrow(/joint density/i)
    expect(() =>
      generateMesh(defaults({ imageData: image(2, 2, () => true), jointDensity: 5.1 })),
    ).toThrow(/joint density/i)
  })

  it('rejects invalid joint radius', () => {
    expect(() =>
      generateMesh(defaults({ imageData: image(2, 2, () => true), jointRadius: 5 })),
    ).toThrow(/joint radius/i)
    expect(() =>
      generateMesh(defaults({ imageData: image(2, 2, () => true), jointRadius: 151 })),
    ).toThrow(/joint radius/i)
  })

  it('rejects invalid joint min distance', () => {
    expect(() =>
      generateMesh(defaults({ imageData: image(2, 2, () => true), jointMinDist: 2 })),
    ).toThrow(/joint min distance/i)
    expect(() =>
      generateMesh(defaults({ imageData: image(2, 2, () => true), jointMinDist: 81 })),
    ).toThrow(/joint min distance/i)
  })

  it('rejects invalid max vertices', () => {
    expect(() =>
      generateMesh(defaults({ imageData: image(2, 2, () => true), maxVertices: 10 })),
    ).toThrow(/max vertices/i)
    expect(() =>
      generateMesh(defaults({ imageData: image(2, 2, () => true), maxVertices: 1001 })),
    ).toThrow(/max vertices/i)
  })

  it('rejects malformed and fully transparent images', () => {
    expect(() => generateMesh(defaults({ imageData: image(3, 3, () => false) }))).toThrow(
      /transparent/i,
    )
    expect(() =>
      generateMesh(
        defaults({
          imageData: { width: 3, height: 3, data: new Uint8ClampedArray(1) } as ImageData,
        }),
      ),
    ).toThrow(/exactly/i)
  })

  it('enforces max vertices budget', () => {
    const input = image(20, 20, () => true)
    const result = generateMesh(defaults({ imageData: input, maxVertices: 100 }))
    expect(result.vertices.length).toBeLessThanOrEqual(100)
  })

  it('produces deterministic output for same inputs', () => {
    const input = image(10, 10, (x, y) => x < 8 && y < 8)
    const params = defaults({ imageData: input, meshDensity: 40, boundarySpacing: 6 })
    const result1 = generateMesh(params)
    const result2 = generateMesh(params)
    expect(result1).toEqual(result2)
  })

  it('generates mesh with bones producing joints near bone endpoints', () => {
    const input = image(20, 20, () => true)
    const bones = [{ sx: 10, sy: 5, ex: 10, ey: 15 }]
    const withBones = generateMesh(defaults({ imageData: input, bones }))
    const withoutBones = generateMesh(defaults({ imageData: input }))
    expect(withBones.vertices.length).toBeGreaterThanOrEqual(withoutBones.vertices.length)
  })

  it('handles multiple outer contours (islands)', () => {
    const data = new Uint8ClampedArray(30 * 30 * 4)
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < 30; x++) {
        const onIsland1 = x >= 1 && x <= 8 && y >= 1 && y <= 8
        const onIsland2 = x >= 20 && x <= 27 && y >= 20 && y <= 27
        data[(y * 30 + x) * 4 + 3] = onIsland1 || onIsland2 ? 255 : 0
      }
    }
    const imageData = { data, width: 30, height: 30, colorSpace: 'srgb' } as ImageData
    const result = generateMesh(defaults({ imageData, boundarySpacing: 3 }))
    expectValidMesh(result)
  })

  it('generates mesh with smaller boundary spacing for tighter contour', () => {
    const input = image(16, 16, (x, y) => {
      const cx = 8,
        cy = 8,
        r = 6
      return Math.hypot(x - cx, y - cy) <= r
    })
    const loose = generateMesh(defaults({ imageData: input, boundarySpacing: 20 }))
    const tight = generateMesh(defaults({ imageData: input, boundarySpacing: 3 }))
    expect(tight.vertices.length).toBeGreaterThanOrEqual(loose.vertices.length)
  })

  it('generates mesh with joint rings around bone endpoints', () => {
    const input = image(30, 30, () => true)
    const bones = [{ sx: 15, sy: 15, ex: 15, ey: 15 }]
    const result = generateMesh(
      defaults({
        imageData: input,
        bones,
        jointDensity: 4.0,
        jointRadius: 50,
        jointMinDist: 5,
      }),
    )
    expectValidMesh(result)
  })
})
