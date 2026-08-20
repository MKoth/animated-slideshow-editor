import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'
import type { VertexBoneWeight } from '../mesh'
import { extractEdges, ensureBoneWeightsArray } from '../mesh'

export interface BlurWeightsParameters {
  readonly nodeId: string
  readonly iterations: number
  readonly strength: number
}

export interface BlurWeightsInverse {
  readonly nodeId: string
  readonly oldWeights: readonly (readonly VertexBoneWeight[])[]
}

function normalizeWeights(weights: VertexBoneWeight[]): VertexBoneWeight[] {
  const total = weights.reduce((sum, w) => sum + w.weight, 0)
  if (total === 0 || !Number.isFinite(total)) {
    return weights
  }
  return weights.map((w) => ({ boneId: w.boneId, weight: w.weight / total }))
}

export class BlurWeightsCommand implements Command<BlurWeightsInverse> {
  readonly type = 'BlurWeights'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #iterations: number
  readonly #strength: number

  constructor(input: BlurWeightsParameters) {
    this.#nodeId = input.nodeId
    this.#iterations = input.iterations
    this.#strength = input.strength
    this.parameters = {
      nodeId: input.nodeId,
      iterations: input.iterations,
      strength: input.strength,
    }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.mesh) {
      throw new Error(`Node "${this.#nodeId}" does not have a mesh component`)
    }
    requireFiniteNumber(this.#iterations, 'Iterations', (v) => v >= 1, 'number at least 1')
    requireFiniteNumber(this.#strength, 'Strength', (v) => v >= 0, 'non-negative number')
    requireFiniteNumber(this.#strength, 'Strength', (v) => v <= 1, 'number at most 1')
  }

  execute(engine: Engine): BlurWeightsInverse {
    const node = engine.getNode(this.#nodeId)
    const mesh = node.components.mesh!.mesh

    // Save old weights for inverse
    const oldWeights: (readonly VertexBoneWeight[])[] = []
    for (let i = 0; i < mesh.vertices.length; i++) {
      const vw = mesh.boneWeights?.[i]
      oldWeights.push(vw ? vw.map((w) => ({ boneId: w.boneId, weight: w.weight })) : [])
    }

    // Initialize working copy of weights
    const boneWeights = ensureBoneWeightsArray(mesh)
    while (boneWeights.length < mesh.vertices.length) {
      boneWeights.push([])
    }

    // Build adjacency map from edges
    const edges = extractEdges(mesh)
    const adjacency = new Map<number, Set<number>>()
    for (const edge of edges) {
      if (!adjacency.has(edge.v0)) adjacency.set(edge.v0, new Set())
      if (!adjacency.has(edge.v1)) adjacency.set(edge.v1, new Set())
      adjacency.get(edge.v0)!.add(edge.v1)
      adjacency.get(edge.v1)!.add(edge.v0)
    }

    // Perform blur iterations
    for (let iter = 0; iter < this.#iterations; iter++) {
      const newWeights: VertexBoneWeight[][] = []

      for (let vi = 0; vi < mesh.vertices.length; vi++) {
        const neighbors = adjacency.get(vi)
        if (!neighbors || neighbors.size === 0) {
          newWeights.push(boneWeights[vi])
          continue
        }

        // Collect all bone ids from neighbors
        const allBoneIds = new Set<string>()
        for (const ni of neighbors) {
          for (const w of boneWeights[ni]) {
            allBoneIds.add(w.boneId)
          }
        }

        // Average weights from neighbors
        const averaged: VertexBoneWeight[] = []
        for (const boneId of allBoneIds) {
          let sum = 0
          let count = 0
          for (const ni of neighbors) {
            const w = boneWeights[ni].find((entry) => entry.boneId === boneId)
            if (w) {
              sum += w.weight
              count++
            }
          }
          if (count > 0) {
            averaged.push({ boneId, weight: sum / count })
          }
        }

        // Blend between current and averaged based on strength
        const current = boneWeights[vi]
        const blended: VertexBoneWeight[] = []
        const allBoneIdsCurrent = new Set<string>()
        for (const w of current) allBoneIdsCurrent.add(w.boneId)
        for (const w of averaged) allBoneIdsCurrent.add(w.boneId)

        for (const boneId of allBoneIdsCurrent) {
          const currentWeight = current.find((w) => w.boneId === boneId)?.weight ?? 0
          const averagedWeight = averaged.find((w) => w.boneId === boneId)?.weight ?? 0
          const blendedWeight =
            currentWeight * (1 - this.#strength) + averagedWeight * this.#strength
          if (blendedWeight > 0) {
            blended.push({ boneId, weight: blendedWeight })
          }
        }

        newWeights.push(normalizeWeights(blended))
      }

      // Update bone weights for next iteration
      for (let vi = 0; vi < mesh.vertices.length; vi++) {
        boneWeights[vi] = newWeights[vi]
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
