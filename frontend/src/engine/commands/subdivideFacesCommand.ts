import type { Engine } from '../internal'
import type { Command } from './command'
import type { MeshData, MeshFace, MeshVertex } from '../mesh'
import { edgeKey } from '../mesh'

export interface SubdivideFacesParameters {
  readonly nodeId: string
  readonly faceIndices: readonly number[]
}

export interface SubdivideFacesInverse {
  readonly nodeId: string
  readonly mesh: MeshData
}

export class SubdivideFacesCommand implements Command<SubdivideFacesInverse> {
  readonly type = 'SubdivideFaces'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #faceIndices: readonly number[]

  constructor(input: SubdivideFacesParameters) {
    this.#nodeId = input.nodeId
    this.#faceIndices = [...input.faceIndices].sort((a, b) => a - b)
    this.parameters = {
      nodeId: input.nodeId,
      faceIndices: [...this.#faceIndices],
    }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.mesh) {
      throw new Error(`Node "${this.#nodeId}" does not have a mesh component`)
    }
    if ((node.components.mesh.shapes?.length ?? 0) > 0) {
      throw new Error('Remove Shapes to edit topology')
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
  }

  execute(engine: Engine): SubdivideFacesInverse {
    const node = engine.getNode(this.#nodeId)
    const oldMesh = node.components.mesh!.mesh

    const selectedSet = new Set(this.#faceIndices)
    const midpointCache = new Map<string, number>()
    const newVertices: MeshVertex[] = oldMesh.vertices.map((v) => ({ x: v.x, y: v.y }))
    const newUvs = oldMesh.uvs.map((uv) => ({ u: uv.u, v: uv.v }))
    const newFaces: MeshFace[] = []

    for (let fi = 0; fi < oldMesh.faces.length; fi++) {
      const face = oldMesh.faces[fi]
      if (!face) continue

      if (!selectedSet.has(fi)) {
        newFaces.push({ v0: face.v0, v1: face.v1, v2: face.v2 })
        continue
      }

      const m01 = this.#getOrCreateMidpoint(
        face.v0,
        face.v1,
        oldMesh,
        midpointCache,
        newVertices,
        newUvs,
      )
      const m12 = this.#getOrCreateMidpoint(
        face.v1,
        face.v2,
        oldMesh,
        midpointCache,
        newVertices,
        newUvs,
      )
      const m20 = this.#getOrCreateMidpoint(
        face.v2,
        face.v0,
        oldMesh,
        midpointCache,
        newVertices,
        newUvs,
      )

      newFaces.push({ v0: face.v0, v1: m01, v2: m20 })
      newFaces.push({ v0: m01, v1: face.v1, v2: m12 })
      newFaces.push({ v0: m20, v1: m12, v2: face.v2 })
      newFaces.push({ v0: m01, v1: m12, v2: m20 })
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

  #getOrCreateMidpoint(
    vi: number,
    vj: number,
    oldMesh: MeshData,
    cache: Map<string, number>,
    newVertices: MeshVertex[],
    newUvs: { u: number; v: number }[],
  ): number {
    const key = edgeKey(vi, vj)
    const cached = cache.get(key)
    if (cached !== undefined) {
      return cached
    }

    const a = oldMesh.vertices[vi]
    const b = oldMesh.vertices[vj]
    const idx = newVertices.length

    newVertices.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

    const uvA = oldMesh.uvs[vi]
    const uvB = oldMesh.uvs[vj]
    newUvs.push({ u: (uvA.u + uvB.u) / 2, v: (uvA.v + uvB.v) / 2 })

    cache.set(key, idx)
    return idx
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
