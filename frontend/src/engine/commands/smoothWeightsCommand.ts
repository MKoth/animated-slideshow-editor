import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'
import type { VertexBoneWeight } from '../mesh'
import { extractEdges, ensureBoneWeightsArray } from '../mesh'

export interface SmoothWeightsParameters {
  readonly nodeId: string
  readonly vertexIndices: readonly number[]
  readonly iterations: number
}

export interface SmoothWeightsInverse {
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

export class SmoothWeightsCommand implements Command<SmoothWeightsInverse> {
  readonly type = 'SmoothWeights'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #vertexIndices: readonly number[]
  readonly #iterations: number

  constructor(input: SmoothWeightsParameters) {
    this.#nodeId = input.nodeId
    this.#vertexIndices = input.vertexIndices
    this.#iterations = input.iterations
    this.parameters = {
      nodeId: input.nodeId,
      vertexIndices: [...input.vertexIndices],
      iterations: input.iterations,
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
    requireFiniteNumber(this.#iterations, 'Iterations', (v) => v >= 1, 'number at least 1')
  }

  execute(engine: Engine): SmoothWeightsInverse {
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
    // Perform smoothing iterations
    for (let iter = 0; iter < this.#iterations; iter++) {
      for (const vi of this.#vertexIndices) {
        const neighbors = adjacency.get(vi)
        if (!neighbors || neighbors.size === 0) {
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
        boneWeights[vi] = normalizeWeights(averaged)
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
