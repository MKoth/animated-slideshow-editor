import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'
import type { VertexBoneWeight } from '../mesh'
import { ensureBoneWeightsArray } from '../mesh'

export interface FillWeightsParameters {
  readonly nodeId: string
  readonly vertexIndices: readonly number[]
  readonly boneId: string
  readonly weight: number
}

export interface FillWeightsInverse {
  readonly nodeId: string
  readonly oldWeights: readonly (readonly VertexBoneWeight[])[]
}

export class FillWeightsCommand implements Command<FillWeightsInverse> {
  readonly type = 'FillWeights'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #vertexIndices: readonly number[]
  readonly #boneId: string
  readonly #weight: number

  constructor(input: FillWeightsParameters) {
    this.#nodeId = input.nodeId
    this.#vertexIndices = input.vertexIndices
    this.#boneId = input.boneId
    this.#weight = input.weight
    this.parameters = {
      nodeId: input.nodeId,
      vertexIndices: [...input.vertexIndices],
      boneId: input.boneId,
      weight: input.weight,
    }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.mesh) {
      throw new Error(`Node "${this.#nodeId}" does not have a mesh component`)
    }
    const mesh = node.components.mesh.mesh
    if (this.#vertexIndices.length === 0) {
      throw new Error('Vertex indices must contain at least one entry')
    }
    for (const idx of this.#vertexIndices) {
      if (idx < 0 || idx >= mesh.vertices.length) {
        throw new Error(`Vertex index ${idx} is out of bounds`)
      }
    }
    if (typeof this.#boneId !== 'string' || this.#boneId === '') {
      throw new Error('Bone id must be a non-empty string')
    }
    requireFiniteNumber(this.#weight, 'Weight', (v) => v >= 0, 'non-negative number')
    requireFiniteNumber(this.#weight, 'Weight', (v) => v <= 1, 'number at most 1')
    try {
      engine.getNode(this.#boneId)
    } catch {
      throw new Error(`Unknown bone id: "${this.#boneId}"`)
    }
  }

  execute(engine: Engine): FillWeightsInverse {
    const node = engine.getNode(this.#nodeId)
    const mesh = node.components.mesh!.mesh

    // Save old weights for inverse
    const oldWeights: (readonly VertexBoneWeight[])[] = []
    for (let i = 0; i < mesh.vertices.length; i++) {
      const vw = mesh.boneWeights?.[i]
      oldWeights.push(vw ? vw.map((w) => ({ boneId: w.boneId, weight: w.weight })) : [])
    }

    // Ensure boneWeights array exists and is long enough
    const boneWeights = ensureBoneWeightsArray(mesh)
    while (boneWeights.length < mesh.vertices.length) {
      boneWeights.push([])
    }

    // Fill selected vertices with uniform weight
    for (const vi of this.#vertexIndices) {
      const currentWeights = boneWeights[vi]
      const boneIndex = currentWeights.findIndex((w) => w.boneId === this.#boneId)

      if (boneIndex >= 0) {
        currentWeights[boneIndex] = { boneId: this.#boneId, weight: this.#weight }
      } else {
        currentWeights.push({ boneId: this.#boneId, weight: this.#weight })
      }

      // Normalize weights
      const total = currentWeights.reduce((sum, w) => sum + w.weight, 0)
      if (total > 0) {
        const normalizedWeights = currentWeights.map((w) => ({
          boneId: w.boneId,
          weight: w.weight / total,
        }))
        boneWeights[vi] = normalizedWeights
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
