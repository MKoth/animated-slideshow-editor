import type { Engine } from '../internal'
import type { Command } from './command'
import type { VertexBoneWeight } from '../mesh'
import { ensureBoneWeightsArray } from '../mesh'

export interface NormalizeWeightsParameters {
  readonly nodeId: string
}

export interface NormalizeWeightsInverse {
  readonly nodeId: string
  readonly oldWeights: readonly (readonly VertexBoneWeight[])[]
}

export class NormalizeWeightsCommand implements Command<NormalizeWeightsInverse> {
  readonly type = 'NormalizeWeights'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string

  constructor(input: NormalizeWeightsParameters) {
    this.#nodeId = input.nodeId
    this.parameters = {
      nodeId: input.nodeId,
    }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.mesh) {
      throw new Error(`Node "${this.#nodeId}" does not have a mesh component`)
    }
  }

  execute(engine: Engine): NormalizeWeightsInverse {
    const node = engine.getNode(this.#nodeId)
    const mesh = node.components.mesh!.mesh

    // Save old weights for inverse
    const oldWeights: (readonly VertexBoneWeight[])[] = []
    for (let i = 0; i < mesh.vertices.length; i++) {
      const vw = mesh.boneWeights?.[i]
      oldWeights.push(vw ? vw.map((w) => ({ boneId: w.boneId, weight: w.weight })) : [])
    }

    const boneWeights = ensureBoneWeightsArray(mesh)
    while (boneWeights.length < mesh.vertices.length) {
      boneWeights.push([])
    }

    // Normalize each vertex's weights to sum to 1
    for (let vi = 0; vi < boneWeights.length; vi++) {
      const weights = boneWeights[vi]
      if (weights.length === 0) continue
      const total = weights.reduce((sum, w) => sum + w.weight, 0)
      if (total > 0 && total !== 1) {
        boneWeights[vi] = weights.map((w) => ({
          boneId: w.boneId,
          weight: w.weight / total,
        }))
      }
    }

    const newMesh = { ...mesh, boneWeights }
    engine.setMeshData(this.#nodeId, newMesh)
    return {
      nodeId: this.#nodeId,
      oldWeights,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
