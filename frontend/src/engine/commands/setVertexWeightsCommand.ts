import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'
import type { VertexBoneWeight } from '../mesh'
import { ensureBoneWeightsArray } from '../mesh'

export interface SetVertexWeightsParameters {
  readonly nodeId: string
  readonly vertexIndex: number
  readonly weights: readonly VertexBoneWeight[]
}

export interface SetVertexWeightsInverse {
  readonly nodeId: string
  readonly vertexIndex: number
  readonly oldWeights: readonly VertexBoneWeight[]
}

export class SetVertexWeightsCommand implements Command<SetVertexWeightsInverse> {
  readonly type = 'SetVertexWeights'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #vertexIndex: number
  readonly #weights: readonly VertexBoneWeight[]

  constructor(input: SetVertexWeightsParameters) {
    this.#nodeId = input.nodeId
    this.#vertexIndex = input.vertexIndex
    this.#weights = input.weights
    this.parameters = {
      nodeId: input.nodeId,
      vertexIndex: input.vertexIndex,
      weights: input.weights.map((w) => ({ boneId: w.boneId, weight: w.weight })),
    }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.mesh) {
      throw new Error(`Node "${this.#nodeId}" does not have a mesh component`)
    }
    const mesh = node.components.mesh.mesh
    if (this.#vertexIndex < 0 || this.#vertexIndex >= mesh.vertices.length) {
      throw new Error(`Vertex index ${this.#vertexIndex} is out of bounds`)
    }
    if (this.#weights.length === 0) {
      throw new Error('Weights must contain at least one entry')
    }
    for (const entry of this.#weights) {
      if (typeof entry.boneId !== 'string' || entry.boneId === '') {
        throw new Error('Bone id must be a non-empty string')
      }
      requireFiniteNumber(entry.weight, 'Weight', (v) => v >= 0, 'non-negative number')
      requireFiniteNumber(entry.weight, 'Weight', (v) => v <= 1, 'number at most 1')
      // Verify bone exists in scene
      try {
        engine.getNode(entry.boneId)
      } catch {
        throw new Error(`Unknown bone id: "${entry.boneId}"`)
      }
    }
  }

  execute(engine: Engine): SetVertexWeightsInverse {
    const node = engine.getNode(this.#nodeId)
    const mesh = node.components.mesh!.mesh
    const oldWeights = mesh.boneWeights?.[this.#vertexIndex] ?? []
    const oldWeightsCopy: VertexBoneWeight[] = oldWeights.map((w) => ({
      boneId: w.boneId,
      weight: w.weight,
    }))
    // Ensure boneWeights array exists and is long enough
    const boneWeights = ensureBoneWeightsArray(mesh)
    while (boneWeights.length < mesh.vertices.length) {
      boneWeights.push([])
    }
    boneWeights[this.#vertexIndex] = this.#weights.map((w) => ({
      boneId: w.boneId,
      weight: w.weight,
    }))
    const newMesh = { ...mesh, boneWeights }
    engine.setMeshData(this.#nodeId, newMesh)
    return {
      nodeId: this.#nodeId,
      vertexIndex: this.#vertexIndex,
      oldWeights: oldWeightsCopy,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
