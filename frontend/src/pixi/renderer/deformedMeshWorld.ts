import type { Scene } from '../../engine'
import type { MeshData, MeshVertex } from '../../engine/mesh'
import { evaluateMeshDeformation } from '../../engine/meshDeformationEvaluator'
import { walkPreOrder } from '../../engine/sceneNode'
import { worldTransformOf } from '../../engine/worldTransform'
import type { WorldTransform } from './worldGeometry'
import type { WorldTransformSource } from './hitTest'

export function deformedMeshWorldVertices(
  mesh: MeshData,
  scene: Scene,
  meshTransform: WorldTransform,
  getWorldTransform?: WorldTransformSource,
): MeshVertex[] {
  if (!mesh.boneWeights || mesh.boneWeights.length === 0) {
    return mesh.vertices.map((vertex) => localToWorld(vertex, meshTransform))
  }

  const boneTransforms = new Map<string, WorldTransform>()
  for (const node of walkPreOrder(scene.root)) {
    if (!node.components.bone) continue
    const transform = getWorldTransform
      ? getWorldTransform(node.id)
      : worldTransformOf(scene, node.id)
    if (transform) boneTransforms.set(node.id, transform)
  }
  if (boneTransforms.size === 0) {
    return mesh.vertices.map((vertex) => localToWorld(vertex, meshTransform))
  }

  const deformed = evaluateMeshDeformation(mesh, boneTransforms, meshTransform)
  return deformed.deformedVertices.map((vertex) => localToWorld(vertex, meshTransform))
}

function localToWorld(vertex: MeshVertex, transform: WorldTransform): MeshVertex {
  const scaledX = vertex.x * transform.scaleX
  const scaledY = vertex.y * transform.scaleY
  return {
    x:
      scaledX * Math.cos(transform.rotation) - scaledY * Math.sin(transform.rotation) + transform.x,
    y:
      scaledX * Math.sin(transform.rotation) + scaledY * Math.cos(transform.rotation) + transform.y,
  }
}
