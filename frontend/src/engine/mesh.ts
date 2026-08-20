export interface MeshVertex {
  readonly x: number
  readonly y: number
}

export interface MeshFace {
  readonly v0: number
  readonly v1: number
  readonly v2: number
}

export interface VertexBoneWeight {
  readonly boneId: string
  readonly weight: number
}

export interface MeshData {
  readonly vertices: readonly MeshVertex[]
  readonly faces: readonly MeshFace[]
  readonly uvs: readonly { readonly u: number; readonly v: number }[]
  readonly boneWeights?: readonly (readonly VertexBoneWeight[])[]
}

export function createDefaultRectangleMesh(width: number, height: number): MeshData {
  const vertices: MeshVertex[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ]
  const faces: MeshFace[] = [
    { v0: 0, v1: 1, v2: 2 },
    { v0: 0, v1: 2, v2: 3 },
  ]
  const uvs = [
    { u: 0, v: 0 },
    { u: 1, v: 0 },
    { u: 1, v: 1 },
    { u: 0, v: 1 },
  ]
  return { vertices, faces, uvs }
}

export function meshDataFromJSON(json: unknown): MeshData {
  if (typeof json !== 'object' || json === null) {
    throw new Error('Mesh data must be an object')
  }
  const record = json as Record<string, unknown>
  if (!Array.isArray(record.vertices) || record.vertices.length === 0) {
    throw new Error('Mesh data must have a non-empty vertices array')
  }
  if (!Array.isArray(record.faces) || record.faces.length === 0) {
    throw new Error('Mesh data must have a non-empty faces array')
  }
  if (!Array.isArray(record.uvs) || record.uvs.length !== record.vertices.length) {
    throw new Error('Mesh data uvs length must match vertices length')
  }
  const vertices: MeshVertex[] = []
  for (const v of record.vertices) {
    if (
      typeof v !== 'object' ||
      v === null ||
      typeof (v as Record<string, unknown>).x !== 'number' ||
      typeof (v as Record<string, unknown>).y !== 'number'
    ) {
      throw new Error('Each vertex must have x and y numbers')
    }
    vertices.push({
      x: (v as Record<string, unknown>).x as number,
      y: (v as Record<string, unknown>).y as number,
    })
  }
  const faces: MeshFace[] = []
  for (const f of record.faces) {
    if (
      typeof f !== 'object' ||
      f === null ||
      typeof (f as Record<string, unknown>).v0 !== 'number' ||
      typeof (f as Record<string, unknown>).v1 !== 'number' ||
      typeof (f as Record<string, unknown>).v2 !== 'number'
    ) {
      throw new Error('Each face must have v0, v1, v2 numbers')
    }
    faces.push({
      v0: (f as Record<string, unknown>).v0 as number,
      v1: (f as Record<string, unknown>).v1 as number,
      v2: (f as Record<string, unknown>).v2 as number,
    })
  }
  const uvs: { u: number; v: number }[] = []
  for (const uv of record.uvs) {
    if (
      typeof uv !== 'object' ||
      uv === null ||
      typeof (uv as Record<string, unknown>).u !== 'number' ||
      typeof (uv as Record<string, unknown>).v !== 'number'
    ) {
      throw new Error('Each UV must have u and v numbers')
    }
    uvs.push({
      u: (uv as Record<string, unknown>).u as number,
      v: (uv as Record<string, unknown>).v as number,
    })
  }
  let boneWeights: (readonly VertexBoneWeight[])[] | undefined
  if (Array.isArray(record.boneWeights)) {
    boneWeights = []
    for (const bw of record.boneWeights) {
      if (!Array.isArray(bw)) {
        throw new Error('Each boneWeights entry must be an array')
      }
      const weights: VertexBoneWeight[] = []
      for (const entry of bw) {
        if (
          typeof entry !== 'object' ||
          entry === null ||
          typeof (entry as Record<string, unknown>).boneId !== 'string' ||
          typeof (entry as Record<string, unknown>).weight !== 'number'
        ) {
          throw new Error('Each bone weight entry must have boneId (string) and weight (number)')
        }
        weights.push({
          boneId: (entry as Record<string, unknown>).boneId as string,
          weight: (entry as Record<string, unknown>).weight as number,
        })
      }
      boneWeights.push(weights)
    }
  }
  const result: MeshData = { vertices, faces, uvs }
  if (boneWeights !== undefined) {
    if (boneWeights.length !== vertices.length) {
      throw new Error('boneWeights length must match vertices length')
    }
    return { ...result, boneWeights }
  }
  return result
}

export function meshDataToJSON(mesh: MeshData): {
  vertices: readonly { readonly x: number; readonly y: number }[]
  faces: readonly { readonly v0: number; readonly v1: number; readonly v2: number }[]
  uvs: readonly { readonly u: number; readonly v: number }[]
  boneWeights?: readonly (readonly { readonly boneId: string; readonly weight: number }[])[]
} {
  const result = {
    vertices: mesh.vertices,
    faces: mesh.faces,
    uvs: mesh.uvs,
  }
  if (mesh.boneWeights) {
    return { ...result, boneWeights: mesh.boneWeights }
  }
  return result
}

export function cloneBoneWeights(
  boneWeights: readonly (readonly VertexBoneWeight[])[],
): VertexBoneWeight[][] {
  return boneWeights.map((vw) => vw.map((w) => ({ boneId: w.boneId, weight: w.weight })))
}

export function ensureBoneWeightsArray(mesh: MeshData): VertexBoneWeight[][] {
  if (mesh.boneWeights) {
    return cloneBoneWeights(mesh.boneWeights)
  }
  return []
}

export interface MeshEdge {
  readonly v0: number
  readonly v1: number
}

export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

export function extractEdges(mesh: MeshData): MeshEdge[] {
  const seen = new Set<string>()
  const edges: MeshEdge[] = []
  for (const face of mesh.faces) {
    const pairs: [number, number][] = [
      [face.v0, face.v1],
      [face.v1, face.v2],
      [face.v2, face.v0],
    ]
    for (const [a, b] of pairs) {
      const key = edgeKey(a, b)
      if (!seen.has(key)) {
        seen.add(key)
        edges.push({ v0: Math.min(a, b), v1: Math.max(a, b) })
      }
    }
  }
  return edges
}

export function cloneMeshData(mesh: MeshData): MeshData {
  const result: MeshData = {
    vertices: mesh.vertices.map((v) => ({ x: v.x, y: v.y })),
    faces: mesh.faces.map((f) => ({ v0: f.v0, v1: f.v1, v2: f.v2 })),
    uvs: mesh.uvs.map((uv) => ({ u: uv.u, v: uv.v })),
  }
  if (mesh.boneWeights) {
    return {
      ...result,
      boneWeights: mesh.boneWeights.map((vw) =>
        vw.map((w) => ({ boneId: w.boneId, weight: w.weight })),
      ),
    }
  }
  return result
}
