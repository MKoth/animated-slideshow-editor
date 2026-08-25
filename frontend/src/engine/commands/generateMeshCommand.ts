import type { Engine } from '../internal'
import type { Command } from './command'
import type { MeshData } from '../mesh'

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
  }

  execute(engine: Engine): GenerateMeshInverse {
    const node = engine.getNode(this.#nodeId)
    const oldMesh = node.components.mesh?.mesh ?? null

    engine.setMeshData(this.#nodeId, this.#mesh)

    return {
      nodeId: this.#nodeId,
      oldMesh,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
