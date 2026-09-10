import type { EnginePublic, Scene } from '../../engine'
import type { MeshData, MeshVertex } from '../../engine/mesh'
import { evaluateMeshDeformation } from '../../engine/meshDeformationEvaluator'
import { walkPreOrder } from '../../engine/sceneNode'
import {
  worldTransformOf,
  pivotOffsetAndSizeFor,
  localToWorldWithPivot,
} from '../../engine/worldTransform'
import type { WorldTransform } from './worldGeometry'
import type { WorldTransformSource } from './hitTest'

function computeBoneWorldTransforms(
  scene: Scene,
  getWorldTransform?: WorldTransformSource,
): Map<string, WorldTransform> {
  const boneTransforms = new Map<string, WorldTransform>()
  for (const node of walkPreOrder(scene.root)) {
    if (!node.components.bone) continue
    const transform = getWorldTransform
      ? getWorldTransform(node.id)
      : worldTransformOf(scene, node.id)
    if (transform) boneTransforms.set(node.id, transform)
  }
  return boneTransforms
}

export function deformedMeshWorldVertices(
  mesh: MeshData,
  scene: Scene,
  meshTransform: WorldTransform,
  getWorldTransform?: WorldTransformSource,
  engine?: EnginePublic,
  nodeId?: string,
  time?: number,
): MeshVertex[] {
  // Try engine morph-aware path first when engine/nodeId/time available
  if (engine && nodeId !== undefined && time !== undefined) {
    try {
      const bones = computeBoneWorldTransforms(scene, getWorldTransform)
      const result = engine.evaluateMeshDeformation(nodeId, time, bones, meshTransform)
      if (result) {
        const deformedLocal = result.deformedVertices as readonly MeshVertex[]
        const node = nodeId ? scene.getNode(nodeId) : null
        const pivotOffset = node
          ? pivotOffsetAndSizeFor(
              deformedLocal as readonly { x: number; y: number }[],
              node as unknown as { transform: { localPivot?: { x: number; y: number } } },
            )
          : null
        return deformedLocal.map((vertex) =>
          localToWorldWithPivot(vertex.x, vertex.y, meshTransform, pivotOffset),
        )
      }
    } catch {
      // fall through to non-engine path
    }
  }

  const deformLocal = (() => {
    if (!mesh.boneWeights || mesh.boneWeights.length === 0) {
      return mesh.vertices as readonly MeshVertex[]
    }
    const boneTransforms = computeBoneWorldTransforms(scene, getWorldTransform)
    if (boneTransforms.size === 0) {
      return mesh.vertices as readonly MeshVertex[]
    }
    const deformed = evaluateMeshDeformation(mesh, boneTransforms, meshTransform)
    return deformed.deformedVertices as readonly MeshVertex[]
  })()

  const node = nodeId
    ? (() => {
        try {
          return scene.getNode(nodeId)
        } catch {
          return null
        }
      })()
    : null
  const pivotOffset = node
    ? pivotOffsetAndSizeFor(
        deformLocal,
        node as unknown as { transform: { localPivot?: { x: number; y: number } } },
      )
    : null
  return deformLocal.map((vertex) =>
    localToWorldWithPivot(vertex.x, vertex.y, meshTransform, pivotOffset),
  )
}
