import earcut from 'earcut'
import type { MeshVertex, MeshFace } from './mesh'

export interface MeshGeneratorInput {
  readonly imageData: ImageData
  readonly density: number
}

export interface ContourPoint {
  readonly x: number
  readonly y: number
}

export interface MeshGeneratorResult {
  readonly vertices: readonly MeshVertex[]
  readonly faces: readonly MeshFace[]
  readonly uvs: readonly { readonly u: number; readonly v: number }[]
  readonly width: number
  readonly height: number
}

interface Contours {
  readonly outer: ContourPoint[][]
  readonly holes: ContourPoint[][]
}

const MIN_VISIBLE_ALPHA = 0
const MAX_INTERIOR_POINTS = 400

export function extractAlphaChannel(imageData: ImageData): Uint8Array {
  validateImageData(imageData)
  const { data, width, height } = imageData
  const alpha = new Uint8Array(width * height)
  for (let i = 0; i < alpha.length; i++) {
    alpha[i] = data[i * 4 + 3]
  }
  return alpha
}

/** Returns the largest visible boundary. The full generator preserves every boundary and hole. */
export function traceContour(alpha: Uint8Array, width: number, height: number): ContourPoint[] {
  validateRaster(alpha, width, height)
  const contours = extractContours(alpha, width, height)
  const outer = contours.outer.slice().sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)))[0]
  if (!outer) {
    throw new Error('Image contains no visible pixels')
  }
  return outer
}

export function triangulateContour(
  contour: readonly ContourPoint[],
  holes: readonly (readonly ContourPoint[])[],
  interiorPoints: readonly ContourPoint[] = [],
): MeshFace[] {
  if (contour.length < 3) {
    throw new Error('Contour must contain at least three points')
  }
  const rings = [contour, ...holes]
  const ringPoints = rings.flatMap((ring) => ring)
  const holeIndices: number[] = []
  let offset = contour.length
  for (const hole of holes) {
    if (hole.length < 3) {
      throw new Error('Hole must contain at least three points')
    }
    holeIndices.push(offset)
    offset += hole.length
  }
  const flat = ringPoints.flatMap((point) => [point.x, point.y])
  const indices = earcut(flat, holeIndices, 2)
  if (indices.length === 0 || indices.length % 3 !== 0) {
    throw new Error('Contour could not be triangulated')
  }
  const faces: MeshFace[] = []
  for (let i = 0; i < indices.length; i += 3) {
    faces.push({ v0: indices[i], v1: indices[i + 1], v2: indices[i + 2] })
  }
  for (let pointIndex = 0; pointIndex < interiorPoints.length; pointIndex++) {
    const vertexIndex = ringPoints.length + pointIndex
    const point = interiorPoints[pointIndex]
    const containingFace = faces.findIndex((face) =>
      pointInTriangle(point, ringPoints.concat(interiorPoints), face),
    )
    if (containingFace < 0) {
      throw new Error('Interior point could not be inserted into the triangulation')
    }
    const face = faces[containingFace]
    faces.splice(
      containingFace,
      1,
      { v0: face.v0, v1: face.v1, v2: vertexIndex },
      { v0: face.v1, v1: face.v2, v2: vertexIndex },
      { v0: face.v2, v1: face.v0, v2: vertexIndex },
    )
  }
  return faces
}

export function generateInteriorPoints(
  contour: readonly ContourPoint[],
  diagonal: number,
  density: number,
): ContourPoint[] {
  validateDensity(density)
  if (!Number.isFinite(diagonal) || diagonal <= 0 || contour.length < 3) {
    throw new Error('A valid contour diagonal is required')
  }
  const spacing = diagonal * (0.15 - (0.14 * density) / 100)
  const bounds = contour.reduce(
    (result, point) => ({
      minX: Math.min(result.minX, point.x),
      minY: Math.min(result.minY, point.y),
      maxX: Math.max(result.maxX, point.x),
      maxY: Math.max(result.maxY, point.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  )
  const points: ContourPoint[] = []
  const startX = Math.floor(bounds.minX / spacing) * spacing + spacing / 2
  const startY = Math.floor(bounds.minY / spacing) * spacing + spacing / 2
  for (let y = startY; y < bounds.maxY; y += spacing) {
    for (let x = startX; x < bounds.maxX; x += spacing) {
      if (pointInPolygon({ x, y }, contour)) {
        points.push({ x, y })
      }
    }
  }
  if (points.length <= MAX_INTERIOR_POINTS) return points
  const stride = Math.ceil(points.length / MAX_INTERIOR_POINTS)
  return points.filter((_, index) => index % stride === 0)
}

export function computeUVs(
  vertices: readonly MeshVertex[],
  width: number,
  height: number,
): readonly { readonly u: number; readonly v: number }[] {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error('Image dimensions must be positive integers')
  }
  return vertices.map((vertex) => ({ u: vertex.x / width, v: vertex.y / height }))
}

export function generateMesh(input: MeshGeneratorInput): MeshGeneratorResult {
  validateDensity(input.density)
  validateImageData(input.imageData)
  const { width, height } = input.imageData
  const alpha = extractAlphaChannel(input.imageData)
  const contours = extractContours(alpha, width, height)
  if (contours.outer.length === 0) {
    throw new Error('Cannot generate a mesh from a fully transparent image')
  }

  const diagonal = silhouetteDiagonal(contours.outer)
  const vertices: MeshVertex[] = []
  const faces: MeshFace[] = []
  for (const rawOuter of contours.outer) {
    const tolerance =
      diagonal * (0.15 - (0.14 * input.density) / 100) * 0.25 * (1 - input.density / 100)
    const outer = simplifyContour(rawOuter, tolerance)
    const holes = contours.holes
      .filter((hole) => pointInPolygon(hole[0], outer))
      .filter((hole) => {
        const containingOuters = contours.outer
          .filter((candidate) => pointInPolygon(hole[0], candidate))
          .sort((a, b) => Math.abs(area(a)) - Math.abs(area(b)))
        return containingOuters[0] === rawOuter
      })
      .map((hole) => simplifyContour(hole, tolerance))
    const interior = generateInteriorPoints(outer, diagonal, input.density).filter(
      (point) => !holes.some((hole) => pointInPolygon(point, hole)),
    )
    const base = vertices.length
    vertices.push(...outer, ...holes.flat(), ...interior)
    faces.push(
      ...triangulateContour(outer, holes, interior).map((face) => ({
        v0: face.v0 + base,
        v1: face.v1 + base,
        v2: face.v2 + base,
      })),
    )
  }
  if (faces.length === 0 || faces.some((face) => face.v0 === face.v1 || face.v1 === face.v2)) {
    throw new Error('Generated mesh contains no valid triangles')
  }
  return { vertices, faces, uvs: computeUVs(vertices, width, height), width, height }
}

function extractContours(alpha: Uint8Array, width: number, height: number): Contours {
  const edges = new Map<string, [ContourPoint, ContourPoint][]>()
  let edgeCount = 0
  const addEdge = (a: ContourPoint, b: ContourPoint) => {
    const key = `${a.x},${a.y}`
    const outgoing = edges.get(key) ?? []
    outgoing.push([a, b])
    edges.set(key, outgoing)
    edgeCount++
  }
  const visible = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && alpha[y * width + x] > MIN_VISIBLE_ALPHA
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!visible(x, y)) continue
      if (!visible(x, y - 1)) addEdge({ x, y }, { x: x + 1, y })
      if (!visible(x + 1, y)) addEdge({ x: x + 1, y }, { x: x + 1, y: y + 1 })
      if (!visible(x, y + 1)) addEdge({ x: x + 1, y: y + 1 }, { x, y: y + 1 })
      if (!visible(x - 1, y)) addEdge({ x, y: y + 1 }, { x, y })
    }
  }
  const loops: ContourPoint[][] = []
  while (edgeCount > 0) {
    const first = edges.entries().next().value as [string, [ContourPoint, ContourPoint][]]
    const firstEdge = first[1].pop() as [ContourPoint, ContourPoint]
    edgeCount--
    if (first[1].length === 0) edges.delete(first[0])
    const loop = [firstEdge[0], firstEdge[1]]
    while (loop[loop.length - 1].x !== loop[0].x || loop[loop.length - 1].y !== loop[0].y) {
      const current = loop[loop.length - 1]
      const key = `${current.x},${current.y}`
      const outgoing = edges.get(key)
      if (!outgoing || outgoing.length === 0) break
      const edge = outgoing.pop() as [ContourPoint, ContourPoint]
      edgeCount--
      if (outgoing.length === 0) edges.delete(key)
      loop.push(edge[1])
    }
    if (
      loop.length > 3 &&
      loop[0].x === loop[loop.length - 1].x &&
      loop[0].y === loop[loop.length - 1].y
    ) {
      loop.pop()
      loops.push(removeCollinear(loop))
    }
  }
  const outer: ContourPoint[][] = []
  const holes: ContourPoint[][] = []
  for (const loop of loops) {
    const depth = loops.reduce(
      (count, candidate) =>
        count + (candidate !== loop && pointInPolygon(loop[0], candidate) ? 1 : 0),
      0,
    )
    if (depth % 2 === 0) outer.push(loop)
    else holes.push(loop)
  }
  return { outer, holes }
}

function removeCollinear(points: ContourPoint[]): ContourPoint[] {
  return points.filter((point, index) => {
    const previous = points[(index + points.length - 1) % points.length]
    const next = points[(index + 1) % points.length]
    return (
      (point.x - previous.x) * (next.y - point.y) !== (point.y - previous.y) * (next.x - point.x)
    )
  })
}

function simplifyContour(points: readonly ContourPoint[], tolerance: number): ContourPoint[] {
  if (tolerance <= 0 || points.length < 4) return [...points]
  const result: ContourPoint[] = []
  for (let index = 0; index < points.length; index++) {
    const previous = points[(index + points.length - 1) % points.length]
    const current = points[index]
    const next = points[(index + 1) % points.length]
    const distance =
      Math.abs(
        (next.x - previous.x) * (previous.y - current.y) -
          (previous.x - current.x) * (next.y - previous.y),
      ) / Math.hypot(next.x - previous.x, next.y - previous.y)
    if (distance > tolerance || index === 0) result.push(current)
  }
  return result.length >= 3 ? result : [...points]
}

function silhouetteDiagonal(contours: readonly (readonly ContourPoint[])[]): number {
  const points = contours.flat()
  const bounds = points.reduce(
    (result, point) => ({
      minX: Math.min(result.minX, point.x),
      minY: Math.min(result.minY, point.y),
      maxX: Math.max(result.maxX, point.x),
      maxY: Math.max(result.maxY, point.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  )
  return Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
}

function area(points: readonly ContourPoint[]): number {
  return (
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length]
      return sum + point.x * next.y - next.x * point.y
    }, 0) / 2
  )
}

function pointInPolygon(point: ContourPoint, polygon: readonly ContourPoint[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside
    }
  }
  return inside
}

function pointInTriangle(
  point: ContourPoint,
  vertices: readonly ContourPoint[],
  face: MeshFace,
): boolean {
  const a = vertices[face.v0]
  const b = vertices[face.v1]
  const c = vertices[face.v2]
  const sign = (p1: ContourPoint, p2: ContourPoint, p3: ContourPoint) =>
    (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y)
  const d1 = sign(point, a, b)
  const d2 = sign(point, b, c)
  const d3 = sign(point, c, a)
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}

function validateDensity(density: number): void {
  if (!Number.isFinite(density))
    throw new Error('Density must be a finite number between 0 and 100')
  if (density < 0 || density > 100) throw new Error('Density must be between 0 and 100')
}

function validateRaster(alpha: Uint8Array, width: number, height: number): void {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error('Image dimensions must be positive integers')
  }
  if (alpha.length !== width * height)
    throw new Error('Alpha data length does not match image dimensions')
}

function validateImageData(imageData: ImageData): void {
  if (!imageData || !Number.isInteger(imageData.width) || !Number.isInteger(imageData.height)) {
    throw new Error('ImageData must have integer width and height')
  }
  if (
    !(imageData.data instanceof Uint8ClampedArray) ||
    imageData.data.length !== imageData.width * imageData.height * 4
  ) {
    throw new Error('ImageData must contain exactly width * height * 4 bytes')
  }
  validateRaster(
    new Uint8Array(imageData.width * imageData.height),
    imageData.width,
    imageData.height,
  )
}
