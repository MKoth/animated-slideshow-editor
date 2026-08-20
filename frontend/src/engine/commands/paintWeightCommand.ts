import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'
import type { VertexBoneWeight } from '../mesh'
import { ensureBoneWeightsArray } from '../mesh'

export interface PaintWeightParameters {
  readonly nodeId: string
  readonly vertexIndex: number
  readonly boneId: string
  readonly strength: number
  readonly mode: 'add' | 'remove' | 'set'
}

export interface PaintWeightInverse {
  readonly nodeId: string
  readonly vertexIndex: number
  readonly oldWeights: readonly VertexBoneWeight[]
}

export class PaintWeightCommand implements Command<PaintWeightInverse> {
  readonly type = 'PaintWeight'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #vertexIndex: number
  readonly #boneId: string
  readonly #strength: number
  readonly #mode: 'add' | 'remove' | 'set'

  constructor(input: PaintWeightParameters) {
    this.#nodeId = input.nodeId
    this.#vertexIndex = input.vertexIndex
    this.#boneId = input.boneId
    this.#strength = input.strength
    this.#mode = input.mode
    this.parameters = {
      nodeId: input.nodeId,
      vertexIndex: input.vertexIndex,
      boneId: input.boneId,
      strength: input.strength,
      mode: input.mode,
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
    if (typeof this.#boneId !== 'string' || this.#boneId === '') {
      throw new Error('Bone id must be a non-empty string')
    }
    requireFiniteNumber(this.#strength, 'Strength', (v) => v >= 0, 'non-negative number')
    requireFiniteNumber(this.#strength, 'Strength', (v) => v <= 1, 'number at most 1')
    try {
      engine.getNode(this.#boneId)
    } catch {
      throw new Error(`Unknown bone id: "${this.#boneId}"`)
    }
  }

  execute(engine: Engine): PaintWeightInverse {
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

    // Get current weights for this vertex
    const currentWeights = [...boneWeights[this.#vertexIndex]]
    const boneIndex = currentWeights.findIndex((w) => w.boneId === this.#boneId)

    if (this.#mode === 'set') {
      // Set absolute weight
      if (boneIndex >= 0) {
        currentWeights[boneIndex] = { boneId: this.#boneId, weight: this.#strength }
      } else {
        currentWeights.push({ boneId: this.#boneId, weight: this.#strength })
      }
    } else if (this.#mode === 'add') {
      // Add weight (clamped to 1)
      const currentWeight = boneIndex >= 0 ? currentWeights[boneIndex].weight : 0
      const newWeight = Math.min(1, currentWeight + this.#strength)
      if (boneIndex >= 0) {
        currentWeights[boneIndex] = { boneId: this.#boneId, weight: newWeight }
      } else {
        currentWeights.push({ boneId: this.#boneId, weight: newWeight })
      }
    } else if (this.#mode === 'remove') {
      // Remove weight
      const currentWeight = boneIndex >= 0 ? currentWeights[boneIndex].weight : 0
      const newWeight = Math.max(0, currentWeight - this.#strength)
      if (boneIndex >= 0) {
        if (newWeight <= 0) {
          currentWeights.splice(boneIndex, 1)
        } else {
          currentWeights[boneIndex] = { boneId: this.#boneId, weight: newWeight }
        }
      }
    }

    // Normalize weights to sum to 1
    const total = currentWeights.reduce((sum, w) => sum + w.weight, 0)
    if (total > 0) {
      const normalizedWeights = currentWeights.map((w) => ({
        boneId: w.boneId,
        weight: w.weight / total,
      }))
      boneWeights[this.#vertexIndex] = normalizedWeights
    } else {
      boneWeights[this.#vertexIndex] = currentWeights
    }
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
