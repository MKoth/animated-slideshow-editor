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

export function extractAlphaChannel(imageData: ImageData): Uint8Array {
  const { data, width, height } = imageData
  const alpha = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    alpha[i] = data[i * 4 + 3]
  }
  return alpha
}

export function traceContour(alpha: Uint8Array, width: number, height: number): ContourPoint[] {
  void alpha
  void width
  void height
  throw new Error('Not implemented: traceContour')
}

export function triangulateContour(
  contour: readonly ContourPoint[],
  holes: readonly (readonly ContourPoint[])[],
): MeshFace[] {
  void contour
  void holes
  throw new Error('Not implemented: triangulateContour')
}

export function generateInteriorPoints(
  contour: readonly ContourPoint[],
  diagonal: number,
  density: number,
): ContourPoint[] {
  void contour
  void diagonal
  void density
  throw new Error('Not implemented: generateInteriorPoints')
}

export function computeUVs(
  vertices: readonly MeshVertex[],
  width: number,
  height: number,
): readonly { readonly u: number; readonly v: number }[] {
  return vertices.map((v) => ({
    u: v.x / width,
    v: v.y / height,
  }))
}

export function generateMesh(input: MeshGeneratorInput): MeshGeneratorResult {
  const { imageData, density } = input
  const { width, height } = imageData

  const alpha = extractAlphaChannel(imageData)
  const contour = traceContour(alpha, width, height)
  const diagonal = Math.sqrt(width * width + height * height)
  const interiorPoints = generateInteriorPoints(contour, diagonal, density)

  const allPoints = [...contour, ...interiorPoints]
  const vertices: MeshVertex[] = allPoints.map((p) => ({ x: p.x, y: p.y }))
  const faces = triangulateContour(contour, [])
  const uvs = computeUVs(vertices, width, height)

  return { vertices, faces, uvs, width, height }
}
