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

    // Preserve skinning data: interpolate boneWeights for new midpoint vertices
    const newBoneWeights: (readonly import('../mesh').VertexBoneWeight[])[] | undefined =
      oldMesh.boneWeights ? [...oldMesh.boneWeights.map((vw) => [...vw])] : undefined
    // midpointCache maps edgeKey -> new vertex index; we need to set weights for those new indices
    // Do a second pass to assign interpolated weights for each new midpoint
    if (newBoneWeights) {
      // Ensure array length matches old vertices initially, will push for new mids
      while (newBoneWeights.length < oldMesh.vertices.length) newBoneWeights.push([])
      // For each cached midpoint, interpolate from its endpoints
      for (const [key, newIdx] of midpointCache.entries()) {
        const [aStr, bStr] = key.split(':')
        const a = Number(aStr)
        const b = Number(bStr)
        const wa = oldMesh.boneWeights?.[a] ?? []
        const wb = oldMesh.boneWeights?.[b] ?? []
        // Average weights: collect all boneIds from both, average
        const allIds = new Set<string>([...wa.map((w) => w.boneId), ...wb.map((w) => w.boneId)])
        const averaged: import('../mesh').VertexBoneWeight[] = []
        for (const bid of allIds) {
          const va = wa.find((w) => w.boneId === bid)?.weight ?? 0
          const vb = wb.find((w) => w.boneId === bid)?.weight ?? 0
          const avg = (va + vb) / 2
          if (avg > 0) averaged.push({ boneId: bid, weight: avg })
        }
        // Ensure array is long enough
        while (newBoneWeights.length <= newIdx) newBoneWeights.push([])
        newBoneWeights[newIdx] = averaged
      }
      // Any remaining new vertices beyond old length already handled via cache; but if there are gaps, pad
      while (newBoneWeights.length < newVertices.length) newBoneWeights.push([])
    }

    const newMesh: MeshData = {
      vertices: newVertices,
      faces: newFaces,
      uvs: newUvs,
      ...(newBoneWeights ? { boneWeights: newBoneWeights } : {}),
      ...(oldMesh.bindPose ? { bindPose: { ...oldMesh.bindPose } } : {}),
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
