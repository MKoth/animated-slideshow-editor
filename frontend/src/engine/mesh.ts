export interface MeshVertex {
  readonly x: number
  readonly y: number
}

export interface MeshFace {
  readonly v0: number
  readonly v1: number
  readonly v2: number
}

export interface MeshData {
  readonly vertices: readonly MeshVertex[]
  readonly faces: readonly MeshFace[]
  readonly uvs: readonly { readonly u: number; readonly v: number }[]
}

export function createDefaultRectangleMesh(
  width: number,
  height: number,
): MeshData {
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
    if (typeof v !== 'object' || v === null || typeof (v as Record<string, unknown>).x !== 'number' || typeof (v as Record<string, unknown>).y !== 'number') {
      throw new Error('Each vertex must have x and y numbers')
    }
    vertices.push({ x: (v as Record<string, unknown>).x as number, y: (v as Record<string, unknown>).y as number })
  }
  const faces: MeshFace[] = []
  for (const f of record.faces) {
    if (typeof f !== 'object' || f === null || typeof (f as Record<string, unknown>).v0 !== 'number' || typeof (f as Record<string, unknown>).v1 !== 'number' || typeof (f as Record<string, unknown>).v2 !== 'number') {
      throw new Error('Each face must have v0, v1, v2 numbers')
    }
    faces.push({ v0: (f as Record<string, unknown>).v0 as number, v1: (f as Record<string, unknown>).v1 as number, v2: (f as Record<string, unknown>).v2 as number })
  }
  const uvs: { u: number; v: number }[] = []
  for (const uv of record.uvs) {
    if (typeof uv !== 'object' || uv === null || typeof (uv as Record<string, unknown>).u !== 'number' || typeof (uv as Record<string, unknown>).v !== 'number') {
      throw new Error('Each UV must have u and v numbers')
    }
    uvs.push({ u: (uv as Record<string, unknown>).u as number, v: (uv as Record<string, unknown>).v as number })
  }
  return { vertices, faces, uvs }
}

export function cloneMeshData(mesh: MeshData): MeshData {
  return {
    vertices: mesh.vertices.map((v) => ({ x: v.x, y: v.y })),
    faces: mesh.faces.map((f) => ({ v0: f.v0, v1: f.v1, v2: f.v2 })),
    uvs: mesh.uvs.map((uv) => ({ u: uv.u, v: uv.v })),
  }
}
