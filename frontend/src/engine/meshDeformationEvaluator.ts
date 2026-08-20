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
      // Apply bone world transform to vertex local position:
      // rotated = rotate(vertex, bone.rotation)
      // scaled = (rotated.x * bone.scaleX, rotated.y * bone.scaleY)
      // final = scaled + bone.position
      const rotatedX = rotateX(vertex.x, vertex.y, boneTransform.rotation)
      const rotatedY = rotateY(vertex.x, vertex.y, boneTransform.rotation)
      const scaledX = rotatedX * boneTransform.scaleX
      const scaledY = rotatedY * boneTransform.scaleY
      const finalX = scaledX + boneTransform.x
      const finalY = scaledY + boneTransform.y
      deformedX += entry.weight * finalX
      deformedY += entry.weight * finalY
    }
    deformedVertices.push({ x: deformedX, y: deformedY })
  }

  return { deformedVertices }
}
