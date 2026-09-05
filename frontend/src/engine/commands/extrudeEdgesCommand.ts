import type { Engine } from '../internal'
import type { Command } from './command'
import type { MeshData, MeshFace, MeshVertex } from '../mesh'
import { requireFiniteNumber } from '../guards'

export interface ExtrudeEdgesParameters {
  readonly nodeId: string
  readonly edgeIndices: readonly { readonly v0: number; readonly v1: number }[]
  readonly distance: number
}

export interface ExtrudeEdgesInverse {
  readonly nodeId: string
  readonly mesh: MeshData
}

function computeEdgeNormal(v0: MeshVertex, v1: MeshVertex): { x: number; y: number } {
  const dx = v1.x - v0.x
  const dy = v1.y - v0.y
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 1e-10) {
    return { x: 0, y: -1 }
  }
  return { x: -dy / len, y: dx / len }
}

export class ExtrudeEdgesCommand implements Command<ExtrudeEdgesInverse> {
  readonly type = 'ExtrudeEdges'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #edgeIndices: readonly { readonly v0: number; readonly v1: number }[]
  readonly #distance: number

  constructor(input: ExtrudeEdgesParameters) {
    this.#nodeId = input.nodeId
    this.#edgeIndices = [...input.edgeIndices]
    this.#distance = input.distance
    this.parameters = {
      nodeId: input.nodeId,
      edgeIndices: this.#edgeIndices.map((e) => ({ v0: e.v0, v1: e.v1 })),
      distance: input.distance,
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
    for (const edge of this.#edgeIndices) {
      if (edge.v0 < 0 || edge.v0 >= mesh.vertices.length) {
        throw new Error(`Edge vertex index ${edge.v0} is out of bounds`)
      }
      if (edge.v1 < 0 || edge.v1 >= mesh.vertices.length) {
        throw new Error(`Edge vertex index ${edge.v1} is out of bounds`)
      }
    }
    if (this.#edgeIndices.length === 0) {
      throw new Error('At least one edge index must be provided')
    }
    requireFiniteNumber(this.#distance, 'Distance')
  }

  execute(engine: Engine): ExtrudeEdgesInverse {
    const node = engine.getNode(this.#nodeId)
    const oldMesh = node.components.mesh!.mesh

    const vertexSet = new Set<number>()
    for (const edge of this.#edgeIndices) {
      vertexSet.add(edge.v0)
      vertexSet.add(edge.v1)
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

    for (const edge of this.#edgeIndices) {
      const va = oldMesh.vertices[edge.v0]
      const vb = oldMesh.vertices[edge.v1]
      const normal = computeEdgeNormal(va, vb)
      const nx = normal.x * this.#distance
      const ny = normal.y * this.#distance

      const nva = indexMap.get(edge.v0)!
      const nvb = indexMap.get(edge.v1)!

      newVertices[nva] = { x: newVertices[nva].x + nx, y: newVertices[nva].y + ny }
      newVertices[nvb] = { x: newVertices[nvb].x + nx, y: newVertices[nvb].y + ny }

      newFaces.push({ v0: edge.v0, v1: edge.v1, v2: nvb })
      newFaces.push({ v0: edge.v0, v1: nvb, v2: nva })
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
