import type { Engine } from '../internal'
import type { Command } from './command'
import type { MeshData, MeshFace, MeshVertex } from '../mesh'
import { requireFiniteNumber } from '../guards'

export interface ExtrudeFacesParameters {
  readonly nodeId: string
  readonly faceIndices: readonly number[]
  readonly distance: number
}

export interface ExtrudeFacesInverse {
  readonly nodeId: string
  readonly mesh: MeshData
}

function computeFaceNormal(
  face: MeshFace,
  vertices: readonly MeshVertex[],
): { x: number; y: number } {
  const a = vertices[face.v0]
  const b = vertices[face.v1]
  const c = vertices[face.v2]

  const edges: [MeshVertex, MeshVertex][] = [
    [a, b],
    [b, c],
    [c, a],
  ]

  let nx = 0
  let ny = 0
  for (const [p, q] of edges) {
    const dx = q.x - p.x
    const dy = q.y - p.y
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 1e-10) continue
    nx += -dy / len
    ny += dx / len
  }

  const mag = Math.sqrt(nx * nx + ny * ny)
  if (mag < 1e-10) {
    return { x: 0, y: -1 }
  }

  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  if (cross < 0) {
    return { x: -nx / mag, y: -ny / mag }
  }
  return { x: nx / mag, y: ny / mag }
}

export class ExtrudeFacesCommand implements Command<ExtrudeFacesInverse> {
  readonly type = 'ExtrudeFaces'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #faceIndices: readonly number[]
  readonly #distance: number

  constructor(input: ExtrudeFacesParameters) {
    this.#nodeId = input.nodeId
    this.#faceIndices = [...input.faceIndices].sort((a, b) => a - b)
    this.#distance = input.distance
    this.parameters = {
      nodeId: input.nodeId,
      faceIndices: [...this.#faceIndices],
      distance: input.distance,
    }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.mesh) {
      throw new Error(`Node "${this.#nodeId}" does not have a mesh component`)
    }
    const mesh = node.components.mesh.mesh
    for (const idx of this.#faceIndices) {
      if (idx < 0 || idx >= mesh.faces.length) {
        throw new Error(`Face index ${idx} is out of bounds`)
      }
    }
    if (this.#faceIndices.length === 0) {
      throw new Error('At least one face index must be provided')
    }
    requireFiniteNumber(this.#distance, 'Distance')
  }

  execute(engine: Engine): ExtrudeFacesInverse {
    const node = engine.getNode(this.#nodeId)
    const oldMesh = node.components.mesh!.mesh

    const vertexSet = new Set<number>()
    for (const fi of this.#faceIndices) {
      const face = oldMesh.faces[fi]
      if (face) {
        vertexSet.add(face.v0)
        vertexSet.add(face.v1)
        vertexSet.add(face.v2)
      }
    }

    const indexMap = new Map<number, number>()
    const newVertices: MeshVertex[] = [...oldMesh.vertices.map((v) => ({ x: v.x, y: v.y }))]
    const newUvs = [...oldMesh.uvs.map((uv) => ({ u: uv.u, v: uv.v }))]

    for (const vi of vertexSet) {
      indexMap.set(vi, newVertices.length)
      const src = oldMesh.vertices[vi]
      newVertices.push({ x: src.x, y: src.y })
      const srcUv = oldMesh.uvs[vi]
      newUvs.push({ u: srcUv.u, v: srcUv.v })
    }

    const newFaces: MeshFace[] = [...oldMesh.faces.map((f) => ({ v0: f.v0, v1: f.v1, v2: f.v2 }))]

    for (const fi of this.#faceIndices) {
      const face = oldMesh.faces[fi]
      if (!face) continue

      const normal = computeFaceNormal(face, oldMesh.vertices)
      const nx = normal.x * this.#distance
      const ny = normal.y * this.#distance

      const nv0 = indexMap.get(face.v0)!
      const nv1 = indexMap.get(face.v1)!
      const nv2 = indexMap.get(face.v2)!

      newVertices[nv0] = { x: newVertices[nv0].x + nx, y: newVertices[nv0].y + ny }
      newVertices[nv1] = { x: newVertices[nv1].x + nx, y: newVertices[nv1].y + ny }
      newVertices[nv2] = { x: newVertices[nv2].x + nx, y: newVertices[nv2].y + ny }

      newFaces.push({ v0: face.v0, v1: face.v1, v2: nv1 })
      newFaces.push({ v0: face.v0, v1: nv1, v2: nv0 })
      newFaces.push({ v0: face.v1, v1: face.v2, v2: nv2 })
      newFaces.push({ v0: face.v1, v1: nv2, v2: nv1 })
      newFaces.push({ v0: face.v2, v1: face.v0, v2: nv0 })
      newFaces.push({ v0: face.v2, v1: nv0, v2: nv2 })
    }

    const newMesh: MeshData = {
      vertices: newVertices,
      faces: newFaces,
      uvs: newUvs,
    }

    engine.setMeshData(this.#nodeId, newMesh)

    return {
      nodeId: this.#nodeId,
      mesh: oldMesh,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
