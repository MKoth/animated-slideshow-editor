import type { Engine } from '../internal'
import type { Command } from './command'
import type { MeshData } from '../mesh'
import { cloneMeshData } from '../mesh'

export interface GenerateMeshParameters {
  readonly nodeId: string
  readonly mesh: MeshData
}

export interface GenerateMeshInverse {
  readonly nodeId: string
  readonly oldMesh: MeshData | null
}

export class GenerateMeshCommand implements Command<GenerateMeshInverse> {
  readonly type = 'GenerateMesh'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #mesh: MeshData

  constructor(input: GenerateMeshParameters) {
    if (!input.mesh || input.mesh.vertices.length === 0 || input.mesh.faces.length === 0) {
      throw new Error('Generated mesh must contain vertices and faces')
    }
    this.#nodeId = input.nodeId
    this.#mesh = input.mesh
    this.parameters = {
      nodeId: input.nodeId,
    }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.assetInstance) {
      throw new Error(`Node "${this.#nodeId}" does not have an asset instance component`)
    }
    for (const face of this.#mesh.faces) {
      if (
        ![face.v0, face.v1, face.v2].every(
          (index) => Number.isInteger(index) && index >= 0 && index < this.#mesh.vertices.length,
        )
      ) {
        throw new Error('Generated mesh contains an invalid face index')
      }
    }
    if (this.#mesh.uvs.length !== this.#mesh.vertices.length) {
      throw new Error('Generated mesh UV count must match vertex count')
    }
  }

  execute(engine: Engine): GenerateMeshInverse {
    const node = engine.getNode(this.#nodeId)
    const oldMesh = node.components.mesh?.mesh ? cloneMeshData(node.components.mesh.mesh) : null

    engine.setMeshData(this.#nodeId, cloneMeshData(this.#mesh))

    return {
      nodeId: this.#nodeId,
      oldMesh,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
