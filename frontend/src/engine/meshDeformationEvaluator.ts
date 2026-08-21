import type { MeshData, MeshVertex } from './mesh'
import type { WorldTransform } from './worldTransform'

export interface DeformedMeshResult {
  readonly deformedVertices: readonly MeshVertex[]
}

function rotateX(x: number, y: number, rotation: number): number {
  return x * Math.cos(rotation) - y * Math.sin(rotation)
}

function rotateY(x: number, y: number, rotation: number): number {
  return x * Math.sin(rotation) + y * Math.cos(rotation)
}

export function evaluateMeshDeformation(
  mesh: MeshData,
  boneWorldTransforms: ReadonlyMap<string, WorldTransform>,
): DeformedMeshResult {
  if (!mesh.boneWeights || mesh.boneWeights.length === 0) {
    return { deformedVertices: mesh.vertices }
  }

  const bindPose = mesh.bindPose

  const deformedVertices: MeshVertex[] = []
  for (let i = 0; i < mesh.vertices.length; i++) {
    const vertex = mesh.vertices[i]
    const weights = mesh.boneWeights[i]
    if (!weights || weights.length === 0) {
      deformedVertices.push({ x: vertex.x, y: vertex.y })
      continue
    }

    let deformedX = 0
    let deformedY = 0
    for (const entry of weights) {
      const boneTransform = boneWorldTransforms.get(entry.boneId)
      if (!boneTransform) {
        continue
      }

      const bp = bindPose?.[entry.boneId]

      if (bp) {
        // With bind pose: compute relative transform
        // deltaRotation = currentRotation - bindRotation
        // deltaScaleX = currentScaleX / bindScaleX
        // deltaScaleY = currentScaleY / bindScaleY
        // Apply delta to vertex position relative to bind pose
        const deltaRotation = boneTransform.rotation - bp.rotation
        const deltaScaleX =
          bp.scaleX !== 0 ? boneTransform.scaleX / bp.scaleX : boneTransform.scaleX
        const deltaScaleY =
          bp.scaleY !== 0 ? boneTransform.scaleY / bp.scaleY : boneTransform.scaleY

        const rotatedX = rotateX(vertex.x, vertex.y, deltaRotation)
        const rotatedY = rotateY(vertex.x, vertex.y, deltaRotation)
        const finalX = rotatedX * deltaScaleX
        const finalY = rotatedY * deltaScaleY
        deformedX += entry.weight * finalX
        deformedY += entry.weight * finalY
      } else {
        // No bind pose: apply rotation and scale only (no position offset)
        const rotatedX = rotateX(vertex.x, vertex.y, boneTransform.rotation)
        const rotatedY = rotateY(vertex.x, vertex.y, boneTransform.rotation)
        const finalX = rotatedX * boneTransform.scaleX
        const finalY = rotatedY * boneTransform.scaleY
        deformedX += entry.weight * finalX
        deformedY += entry.weight * finalY
      }
    }
    deformedVertices.push({ x: deformedX, y: deformedY })
  }

  return { deformedVertices }
}
