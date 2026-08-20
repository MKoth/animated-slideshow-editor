import type { Engine } from '../internal'
import type { Command } from './command'
import type { MeshData, MeshFace, MeshVertex } from '../mesh'

export interface MirrorMeshParameters {
  readonly nodeId: string
  readonly axis: 'x' | 'y'
}

export interface MirrorMeshInverse {
  readonly nodeId: string
  readonly mesh: MeshData
}

const DEFAULT_MERGE_THRESHOLD = 0.01

function isCloseAlongAxis(a: MeshVertex, b: MeshVertex, axis: 'x' | 'y'): boolean {
  if (axis === 'x') {
    return Math.abs(a.y - b.y) < DEFAULT_MERGE_THRESHOLD
  }
  return Math.abs(a.x - b.x) < DEFAULT_MERGE_THRESHOLD
}

export class MirrorMeshCommand implements Command<MirrorMeshInverse> {
  readonly type = 'MirrorMesh'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #axis: 'x' | 'y'

  constructor(input: MirrorMeshParameters) {
    this.#nodeId = input.nodeId
    this.#axis = input.axis
    this.parameters = {
      nodeId: input.nodeId,
      axis: input.axis,
    }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.mesh) {
      throw new Error(`Node "${this.#nodeId}" does not have a mesh component`)
    }
    if (this.#axis !== 'x' && this.#axis !== 'y') {
      throw new Error(`Axis must be "x" or "y", got "${this.#axis}"`)
    }
  }

  execute(engine: Engine): MirrorMeshInverse {
    const node = engine.getNode(this.#nodeId)
    const oldMesh = node.components.mesh!.mesh

    const originalVertexCount = oldMesh.vertices.length
    const mirroredVertices: MeshVertex[] = []
    const mirroredUvs: { u: number; v: number }[] = []

    for (let i = 0; i < originalVertexCount; i++) {
      const v = oldMesh.vertices[i]
      const uv = oldMesh.uvs[i]
      if (this.#axis === 'x') {
        mirroredVertices.push({ x: -v.x, y: v.y })
        mirroredUvs.push({ u: 1 - uv.u, v: uv.v })
      } else {
        mirroredVertices.push({ x: v.x, y: -v.y })
        mirroredUvs.push({ u: uv.u, v: 1 - uv.v })
      }
    }

    const indexMap = new Map<number, number>()
    for (let i = 0; i < originalVertexCount; i++) {
      indexMap.set(i, i)
    }

    for (let mi = 0; mi < originalVertexCount; mi++) {
      const mv = mirroredVertices[mi]
      let merged = false
      for (let oi = 0; oi < originalVertexCount; oi++) {
        const ov = oldMesh.vertices[oi]
        if (isCloseAlongAxis(mv, ov, this.#axis)) {
          indexMap.set(mi, oi)
          merged = true
          break
        }
      }
      if (!merged) {
        indexMap.set(mi, mirroredVertices.length)
      }
    }

    const newVertices: MeshVertex[] = oldMesh.vertices.map((v) => ({ x: v.x, y: v.y }))
    const newUvs = oldMesh.uvs.map((uv) => ({ u: uv.u, v: uv.v }))

    for (let mi = 0; mi < originalVertexCount; mi++) {
      if (indexMap.get(mi) === mi) {
        const targetIdx = newVertices.length
        indexMap.set(mi, targetIdx)
        newVertices.push(mirroredVertices[mi])
        newUvs.push(mirroredUvs[mi])
      }
    }

    const newFaces: MeshFace[] = oldMesh.faces.map((f) => ({ v0: f.v0, v1: f.v1, v2: f.v2 }))

    for (const face of oldMesh.faces) {
      const v0 = indexMap.get(face.v0)!
      const v1 = indexMap.get(face.v1)!
      const v2 = indexMap.get(face.v2)!

      if (v0 !== face.v0 || v1 !== face.v1 || v2 !== face.v2) {
        if (v0 !== v1 && v1 !== v2 && v0 !== v2) {
          newFaces.push({ v0, v1: v2, v2: v1 })
        }
      }
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
