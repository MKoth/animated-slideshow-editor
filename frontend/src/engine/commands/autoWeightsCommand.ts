import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'
import type { VertexBoneWeight, BoneBindPose } from '../mesh'
import { ensureBoneWeightsArray } from '../mesh'
import { worldTransformOf } from '../worldTransform'

export interface AutoWeightsParameters {
  readonly nodeId: string
  readonly boneIds: readonly string[]
  readonly falloff: number
}

export interface AutoWeightsInverse {
  readonly nodeId: string
  readonly oldWeights: readonly (readonly VertexBoneWeight[])[]
  readonly oldBindPose: Readonly<Record<string, BoneBindPose>> | undefined
}

export class AutoWeightsCommand implements Command<AutoWeightsInverse> {
  readonly type = 'AutoWeights'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #boneIds: readonly string[]
  readonly #falloff: number

  constructor(input: AutoWeightsParameters) {
    this.#nodeId = input.nodeId
    this.#boneIds = input.boneIds
    this.#falloff = input.falloff
    this.parameters = {
      nodeId: input.nodeId,
      boneIds: [...input.boneIds],
      falloff: input.falloff,
    }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.mesh) {
      throw new Error(`Node "${this.#nodeId}" does not have a mesh component`)
    }
    if (this.#boneIds.length === 0) {
      throw new Error('Bone ids must contain at least one entry')
    }
    for (const boneId of this.#boneIds) {
      if (typeof boneId !== 'string' || boneId === '') {
        throw new Error('Bone id must be a non-empty string')
      }
      try {
        engine.getNode(boneId)
      } catch {
        throw new Error(`Unknown bone id: "${boneId}"`)
      }
    }
    requireFiniteNumber(this.#falloff, 'Falloff', (v) => v > 0, 'positive number')
  }

  execute(engine: Engine): AutoWeightsInverse {
    const node = engine.getNode(this.#nodeId)
    const mesh = node.components.mesh!.mesh
    const scene = engine.getNodeScene(this.#nodeId)
    const meshWorldTransform = worldTransformOf(scene, this.#nodeId)

    // Save old weights and bind pose for inverse
    const oldWeights: (readonly VertexBoneWeight[])[] = []
    for (let i = 0; i < mesh.vertices.length; i++) {
      const vw = mesh.boneWeights?.[i]
      oldWeights.push(vw ? vw.map((w) => ({ boneId: w.boneId, weight: w.weight })) : [])
    }
    const oldBindPose = mesh.bindPose ? { ...mesh.bindPose } : undefined

    // Get world transforms of bones and record as bind poses
    const bindPose: Record<string, BoneBindPose> = mesh.bindPose ? { ...mesh.bindPose } : {}
    for (const boneId of this.#boneIds) {
      const worldTransform = worldTransformOf(scene, boneId)
      if (worldTransform) {
        bindPose[boneId] = {
          x: worldTransform.x,
          y: worldTransform.y,
          rotation: worldTransform.rotation,
          scaleX: worldTransform.scaleX,
          scaleY: worldTransform.scaleY,
        }
      }
    }

    // Get world positions of bones for weight calculation
    const bonePositions = new Map<string, { x: number; y: number }>()
    for (const boneId of this.#boneIds) {
      const worldTransform = worldTransformOf(scene, boneId)
      if (worldTransform) {
        bonePositions.set(boneId, { x: worldTransform.x, y: worldTransform.y })
      }
    }

    // Initialize bone weights array
    const boneWeights = ensureBoneWeightsArray(mesh)
    while (boneWeights.length < mesh.vertices.length) {
      boneWeights.push([])
    }

    // Calculate weights based on inverse distance
    for (let vi = 0; vi < mesh.vertices.length; vi++) {
      const vertex = mesh.vertices[vi]
      const vertexWorld = meshWorldTransform
        ? {
            x:
              vertex.x * meshWorldTransform.scaleX * Math.cos(meshWorldTransform.rotation) -
              vertex.y * meshWorldTransform.scaleY * Math.sin(meshWorldTransform.rotation) +
              meshWorldTransform.x,
            y:
              vertex.x * meshWorldTransform.scaleX * Math.sin(meshWorldTransform.rotation) +
              vertex.y * meshWorldTransform.scaleY * Math.cos(meshWorldTransform.rotation) +
              meshWorldTransform.y,
          }
        : vertex
      const weights: VertexBoneWeight[] = []
      let totalWeight = 0

      for (const boneId of this.#boneIds) {
        const bonePos = bonePositions.get(boneId)
        if (!bonePos) continue

        const dx = vertexWorld.x - bonePos.x
        const dy = vertexWorld.y - bonePos.y
        const distance = Math.sqrt(dx * dx + dy * dy)

        // Inverse distance with falloff
        const weight = 1 / Math.pow(distance + 0.0001, this.#falloff)
        weights.push({ boneId, weight })
        totalWeight += weight
      }

      // Normalize weights
      if (totalWeight > 0) {
        const normalizedWeights = weights.map((w) => ({
          boneId: w.boneId,
          weight: w.weight / totalWeight,
        }))
        boneWeights[vi] = normalizedWeights
      } else {
        boneWeights[vi] = weights
      }
    }

    const newMesh = { ...mesh, boneWeights, bindPose }
    engine.setMeshData(this.#nodeId, newMesh)
    return {
      nodeId: this.#nodeId,
      oldWeights,
      oldBindPose,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
