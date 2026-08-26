import poly2tri from 'poly2tri'
import type { MeshVertex, MeshFace } from './mesh'

export interface MeshGeneratorInput {
  readonly imageData: ImageData
  readonly meshDensity: number
  readonly boundarySpacing: number
  readonly jointDensity: number
  readonly jointRadius: number
  readonly jointMinDist: number
  readonly maxVertices: number
  readonly bones?: ReadonlyArray<BoneSegment>
}

export interface ContourPoint {
  readonly x: number
  readonly y: number
}

export interface BoneSegment {
  readonly sx: number
  readonly sy: number
  readonly ex: number
  readonly ey: number
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

export function extractAlphaChannel(imageData: ImageData): Uint8Array {
  validateImageData(imageData)
  const { data, width, height } = imageData
  const alpha = new Uint8Array(width * height)
  for (let i = 0; i < alpha.length; i++) {
    alpha[i] = data[i * 4 + 3]
  }
  return alpha
}

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

  const cleanBoundary = ensureClockwise(contour)

  const p2tContour = cleanBoundary.map(
    (p, i) => new poly2tri.Point(p.x + perturbation(i), p.y + perturbation(i) * 0.7),
  )

  const swctx = new poly2tri.SweepContext(p2tContour)

  for (const hole of holes) {
    if (hole.length < 3) {
      throw new Error('Hole must contain at least three points')
    }
    const holePoints = ensureCounterClockwise(hole).map(
      (p, i) => new poly2tri.Point(p.x + perturbation(i), p.y + perturbation(i) * 0.7),
    )
    swctx.addHole(holePoints)
  }

  if (interiorPoints.length > 0) {
    const steinerPoints = interiorPoints.map(
      (p, i) =>
        new poly2tri.Point(
          p.x + perturbation(i + cleanBoundary.length),
          p.y + perturbation(i + cleanBoundary.length) * 1.3,
        ),
    )
    swctx.addPoints(steinerPoints)
  }

  swctx.triangulate()

  const triangles = swctx.getTriangles()
  if (triangles.length === 0) {
    throw new Error('Contour could not be triangulated')
  }

  const allPoints = [...cleanBoundary, ...holes.flat(), ...interiorPoints]
  const vertMap = new Map<string, number>()
  const faces: MeshFace[] = []

  for (const tri of triangles) {
    const pts = [tri.getPoint(0), tri.getPoint(1), tri.getPoint(2)]
    const faceIdx: number[] = []

    for (const pt of pts) {
      const key = `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`
      if (!vertMap.has(key)) {
        vertMap.set(key, vertMap.size)
      }
      faceIdx.push(vertMap.get(key)!)
    }

    const a = allPoints[faceIdx[0]]
    const b = allPoints[faceIdx[1]]
    const c = allPoints[faceIdx[2]]
    if (a && b && c) {
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
      if (Math.abs(cross) > 1e-10) {
        faces.push({ v0: faceIdx[0], v1: faceIdx[1], v2: faceIdx[2] })
      }
    }
  }

  if (faces.length === 0) {
    throw new Error('Contour could not be triangulated')
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
  const bounds = computeBounds(contour)
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
  return points
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
  validateMeshInput(input)
  const { width, height } = input.imageData
  const alpha = extractAlphaChannel(input.imageData)
  const contours = extractContours(alpha, width, height)
  if (contours.outer.length === 0) {
    throw new Error('Cannot generate a mesh from a fully transparent image')
  }

  const joints = input.bones ? getJoints(input.bones, alpha, width, height, input.jointMinDist) : []

  const vertices: MeshVertex[] = []
  const faces: MeshFace[] = []

  for (const rawOuter of contours.outer) {
    const boundary = subsampleContour(rawOuter, input.boundarySpacing)
    const cleanBoundary = removeCollinear(boundary)
    if (cleanBoundary.length < 3) continue

    const holes = contours.holes
      .filter((hole) => pointInPolygon(hole[0], rawOuter))
      .filter((hole) => {
        const containingOuters = contours.outer
          .filter((candidate) => pointInPolygon(hole[0], candidate))
          .sort((a, b) => Math.abs(area(a)) - Math.abs(area(b)))
        return containingOuters[0] === rawOuter
      })
      .map((hole) => {
        const subsampled = subsampleContour(hole, input.boundarySpacing)
        return removeCollinear(subsampled)
      })
      .filter((hole) => hole.length >= 3)

    const interior = generateAdaptiveInteriorPoints(
      cleanBoundary,
      joints,
      alpha,
      width,
      height,
      input.meshDensity,
      input.jointDensity,
      input.jointRadius,
    ).filter((point) => !holes.some((hole) => pointInPolygon(point, hole)))

    const allowedInterior = Math.max(
      0,
      input.maxVertices - cleanBoundary.length - holes.flat().length,
    )
    const limitedInterior = interior.slice(0, allowedInterior)

    const base = vertices.length
    vertices.push(...cleanBoundary, ...holes.flat(), ...limitedInterior)

    faces.push(
      ...triangulateContour(cleanBoundary, holes, limitedInterior).map((face) => ({
        v0: face.v0 + base,
        v1: face.v1 + base,
        v2: face.v2 + base,
      })),
    )
  }

  const referenced = new Set(faces.flatMap((face) => [face.v0, face.v1, face.v2]))
  if (
    faces.length === 0 ||
    faces.some(
      (face) => face.v0 === face.v1 || face.v1 === face.v2 || triangleArea(face, vertices) === 0,
    )
  ) {
    throw new Error(
      `Generated mesh contains no valid triangles (${referenced.size}/${vertices.length})`,
    )
  }

  const usedIndices = Array.from(referenced).sort((a, b) => a - b)
  const indexMap = new Map<number, number>()
  const remappedVertices: MeshVertex[] = []
  for (let i = 0; i < usedIndices.length; i++) {
    indexMap.set(usedIndices[i], i)
    remappedVertices.push(vertices[usedIndices[i]])
  }

  const remappedFaces: MeshFace[] = faces.map((face) => ({
    v0: indexMap.get(face.v0)!,
    v1: indexMap.get(face.v1)!,
    v2: indexMap.get(face.v2)!,
  }))

  const uvs = computeUVs(remappedVertices, width, height)
  const halfW = width / 2
  const halfH = height / 2
  const centered = remappedVertices.map((v) => ({ x: v.x - halfW, y: v.y - halfH }))
  return { vertices: centered, faces: remappedFaces, uvs, width, height }
}

function generateAdaptiveInteriorPoints(
  contour: readonly ContourPoint[],
  joints: readonly ContourPoint[],
  alpha: Uint8Array,
  width: number,
  height: number,
  meshDensity: number,
  jointDensity: number,
  jointRadius: number,
): ContourPoint[] {
  const points: ContourPoint[] = []
  const bounds = computeBounds(contour)
  const hasJoints = joints.length > 0

  const gridSpacing = Math.max(4, 80 - meshDensity + 5)

  for (
    let y = Math.floor(bounds.minY) + Math.floor(gridSpacing / 2);
    y < bounds.maxY;
    y += gridSpacing
  ) {
    for (
      let x = Math.floor(bounds.minX) + Math.floor(gridSpacing / 2);
      x < bounds.maxX;
      x += gridSpacing
    ) {
      const px = Math.round(x)
      const py = Math.round(y)

      if (px < 0 || px >= width || py < 0 || py >= height) continue
      if (alpha[py * width + px] === 0) continue

      points.push({ x, y })

      if (hasJoints) {
        let minDist = Infinity
        for (const j of joints) {
          const d = Math.hypot(x - j.x, y - j.y)
          if (d < minDist) minDist = d
        }

        if (minDist < jointRadius) {
          const extraCount = Math.floor((jointDensity - 1) * 4)

          if (extraCount > 0) {
            const subSpacing = gridSpacing / (extraCount + 1)

            for (let sy = 0; sy <= extraCount; sy++) {
              for (let sx = 0; sx <= extraCount; sx++) {
                const subX = x - gridSpacing / 2 + subSpacing * (sx + 0.5)
                const subY = y - gridSpacing / 2 + subSpacing * (sy + 0.5)

                if (Math.abs(subX - x) < 0.5 && Math.abs(subY - y) < 0.5) continue

                const spx = Math.round(subX)
                const spy = Math.round(subY)
                if (
                  spx >= 0 &&
                  spx < width &&
                  spy >= 0 &&
                  spy < height &&
                  alpha[spy * width + spx] > 0
                ) {
                  points.push({ x: subX, y: subY })
                }
              }
            }
          }
        }
      }
    }
  }

  if (hasJoints) {
    const ringCount = 12
    const rings = Math.min(3, Math.ceil(jointDensity))

    for (const j of joints) {
      for (let ring = 1; ring <= rings; ring++) {
        const r = gridSpacing * 0.3 * ring
        for (let i = 0; i < ringCount; i++) {
          const angle = (i / ringCount) * Math.PI * 2
          const px = Math.round(j.x + Math.cos(angle) * r)
          const py = Math.round(j.y + Math.sin(angle) * r)
          if (px >= 0 && px < width && py >= 0 && py < height && alpha[py * width + px] > 0) {
            points.push({
              x: j.x + Math.cos(angle) * r,
              y: j.y + Math.sin(angle) * r,
            })
          }
        }
      }
    }
  }

  return points
}

function getJoints(
  bones: ReadonlyArray<BoneSegment>,
  alpha: Uint8Array,
  width: number,
  height: number,
  jointMinDist: number,
): ContourPoint[] {
  const map = new Map<string, number>()

  for (const b of bones) {
    const sk = `${b.sx.toFixed(1)},${b.sy.toFixed(1)}`
    const ek = `${b.ex.toFixed(1)},${b.ey.toFixed(1)}`
    map.set(sk, (map.get(sk) || 0) + 1)
    map.set(ek, (map.get(ek) || 0) + 1)
  }

  const joints: ContourPoint[] = []

  for (const [k, v] of map) {
    if (v >= 2) {
      const parts = k.split(',').map(Number)
      joints.push({ x: parts[0], y: parts[1] })
    }
  }

  for (const b of bones) {
    for (const pt of [
      { x: b.sx, y: b.sy },
      { x: b.ex, y: b.ey },
    ]) {
      const key = `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`
      if ((map.get(key) ?? 0) >= 2) continue

      if (joints.some((j) => Math.hypot(j.x - pt.x, j.y - pt.y) < 1)) continue

      const dist = distanceToEdge(pt.x, pt.y, alpha, width, height)
      if (dist >= jointMinDist) {
        joints.push(pt)
      }
    }
  }

  return joints
}

function distanceToEdge(
  x: number,
  y: number,
  alpha: Uint8Array,
  width: number,
  height: number,
): number {
  const px = Math.round(x)
  const py = Math.round(y)

  if (px < 0 || px >= width || py < 0 || py >= height) return 0
  if (alpha[py * width + px] === 0) return 0

  const maxSearch = 100
  for (let r = 1; r <= maxSearch; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue

        const nx = px + dx
        const ny = py + dy

        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue

        if (alpha[ny * width + nx] === 0) {
          let isEdge = false
          for (const [ox, oy] of [
            [0, 1],
            [0, -1],
            [1, 0],
            [-1, 0],
          ]) {
            const ex = nx + ox
            const ey = ny + oy
            if (ex >= 0 && ex < width && ey >= 0 && ey < height && alpha[ey * width + ex] > 0) {
              isEdge = true
              break
            }
          }
          if (isEdge) {
            return Math.hypot(dx, dy) - 1
          }
        }
      }
    }
  }

  return maxSearch
}

function subsampleContour(contour: readonly ContourPoint[], spacing: number): ContourPoint[] {
  if (contour.length === 0) return []

  const result: ContourPoint[] = [contour[0]]
  let dist = 0

  for (let i = 1; i < contour.length; i++) {
    const dx = contour[i].x - contour[i - 1].x
    const dy = contour[i].y - contour[i - 1].y
    dist += Math.hypot(dx, dy)

    if (dist >= spacing) {
      result.push(contour[i])
      dist = 0
    }
  }

  return result
}

function perturbation(index: number): number {
  return 0.001 * ((index % 3) - 1)
}

function ensureClockwise(contour: readonly ContourPoint[]): ContourPoint[] {
  const a = area(contour)
  return a > 0 ? [...contour] : [...contour].reverse()
}

function ensureCounterClockwise(contour: readonly ContourPoint[]): ContourPoint[] {
  const a = area(contour)
  return a < 0 ? [...contour] : [...contour].reverse()
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

function computeBounds(points: readonly ContourPoint[]): {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
} {
  return points.reduce(
    (result, point) => ({
      minX: Math.min(result.minX, point.x),
      minY: Math.min(result.minY, point.y),
      maxX: Math.max(result.maxX, point.x),
      maxY: Math.max(result.maxY, point.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  )
}

function triangleArea(face: MeshFace, vertices: readonly MeshVertex[]): number {
  const a = vertices[face.v0]
  const b = vertices[face.v1]
  const c = vertices[face.v2]
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
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

function validateMeshInput(input: MeshGeneratorInput): void {
  validateImageData(input.imageData)
  validateRange(input.meshDensity, 10, 80, 'Mesh density')
  validateRange(input.boundarySpacing, 2, 30, 'Boundary spacing')
  validateRange(input.jointDensity, 1.0, 5.0, 'Joint density')
  validateRange(input.jointRadius, 10, 150, 'Joint radius')
  validateRange(input.jointMinDist, 5, 80, 'Joint min distance')
  validateRange(input.maxVertices, 50, 1000, 'Max vertices')
}

function validateRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isFinite(value))
    throw new Error(`${label} must be a finite number between ${min} and ${max}`)
  if (value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}`)
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
