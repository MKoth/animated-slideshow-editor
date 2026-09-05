import type { Engine } from '../internal'
import type { Command } from './command'
import type { MeshData, MeshFace } from '../mesh'

export interface DeleteVerticesParameters {
  readonly nodeId: string
  readonly vertexIndices: readonly number[]
}

export interface DeleteVerticesInverse {
  readonly nodeId: string
  readonly mesh: MeshData
  readonly deletedVertexIndices: readonly number[]
}

export class DeleteVerticesCommand implements Command<DeleteVerticesInverse> {
  readonly type = 'DeleteVertices'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #vertexIndices: readonly number[]

  constructor(input: DeleteVerticesParameters) {
    this.#nodeId = input.nodeId
    this.#vertexIndices = [...input.vertexIndices].sort((a, b) => a - b)
    this.parameters = {
      nodeId: input.nodeId,
      vertexIndices: [...this.#vertexIndices],
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
    for (const idx of this.#vertexIndices) {
      if (idx < 0 || idx >= mesh.vertices.length) {
        throw new Error(`Vertex index ${idx} is out of bounds`)
      }
    }
    if (this.#vertexIndices.length === 0) {
      throw new Error('At least one vertex index must be provided')
    }
  }

  execute(engine: Engine): DeleteVerticesInverse {
    const node = engine.getNode(this.#nodeId)
    const oldMesh = node.components.mesh!.mesh

    const deletedSet = new Set(this.#vertexIndices)
    const newVertices = oldMesh.vertices
      .map((v, i) => (deletedSet.has(i) ? null : { x: v.x, y: v.y }))
      .filter((v): v is { x: number; y: number } => v !== null)

    const indexMap = new Map<number, number>()
    let newIndex = 0
    for (let i = 0; i < oldMesh.vertices.length; i++) {
      if (!deletedSet.has(i)) {
        indexMap.set(i, newIndex)
        newIndex++
      }
    }

    const newFaces: MeshFace[] = []
    for (const face of oldMesh.faces) {
      if (deletedSet.has(face.v0) || deletedSet.has(face.v1) || deletedSet.has(face.v2)) {
        continue
      }
      newFaces.push({
        v0: indexMap.get(face.v0)!,
        v1: indexMap.get(face.v1)!,
        v2: indexMap.get(face.v2)!,
      })
    }

    const newUvs = oldMesh.uvs
      .map((uv, i) => (deletedSet.has(i) ? null : { u: uv.u, v: uv.v }))
      .filter((uv): uv is { u: number; v: number } => uv !== null)

    const newMesh: MeshData = {
      vertices: newVertices,
      faces: newFaces,
      uvs: newUvs.length > 0 ? newUvs : newVertices.map(() => ({ u: 0, v: 0 })),
    }

    engine.setMeshData(this.#nodeId, newMesh)

    return {
      nodeId: this.#nodeId,
      mesh: oldMesh,
      deletedVertexIndices: [...this.#vertexIndices],
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
