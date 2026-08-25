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
  meshWorldTransform: WorldTransform = {
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  },
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
    let totalWeight = 0
    for (const entry of weights) {
      const boneTransform = boneWorldTransforms.get(entry.boneId)
      if (!boneTransform) {
        continue
      }

      const meshVertex = applyTransform(vertex, meshWorldTransform)
      const bp = bindPose?.[entry.boneId]
      const worldVertex = bp
        ? applyBoneTransform(meshVertex, bp, boneTransform)
        : applyAbsoluteBoneTransform(meshVertex, boneTransform)
      const localVertex = toLocal(worldVertex.x, worldVertex.y, meshWorldTransform)
      deformedX += entry.weight * localVertex.x
      deformedY += entry.weight * localVertex.y
      totalWeight += entry.weight
    }
    if (totalWeight > 0) {
      deformedVertices.push({ x: deformedX / totalWeight, y: deformedY / totalWeight })
    } else {
      deformedVertices.push({ x: vertex.x, y: vertex.y })
    }
  }

  return { deformedVertices }
}

function applyBoneTransform(
  vertex: MeshVertex,
  bindPose: NonNullable<MeshData['bindPose']>[string],
  current: WorldTransform,
): MeshVertex {
  // Transform the vertex through the inverse bind matrix, then through the current bone matrix.
  const bindLocalX =
    rotateX(vertex.x - bindPose.x, vertex.y - bindPose.y, -bindPose.rotation) /
    (bindPose.scaleX || 1)
  const bindLocalY =
    rotateY(vertex.x - bindPose.x, vertex.y - bindPose.y, -bindPose.rotation) /
    (bindPose.scaleY || 1)
  const scaledX = bindLocalX * current.scaleX
  const scaledY = bindLocalY * current.scaleY
  return {
    x: rotateX(scaledX, scaledY, current.rotation) + current.x,
    y: rotateY(scaledX, scaledY, current.rotation) + current.y,
  }
}

function applyAbsoluteBoneTransform(vertex: MeshVertex, current: WorldTransform): MeshVertex {
  const scaledX = vertex.x * current.scaleX
  const scaledY = vertex.y * current.scaleY
  return {
    // Legacy meshes have no bind matrix, so retain the old rotation/scale-only behavior.
    x: rotateX(scaledX, scaledY, current.rotation),
    y: rotateY(scaledX, scaledY, current.rotation),
  }
}

function applyTransform(vertex: MeshVertex, transform: WorldTransform): MeshVertex {
  const scaledX = vertex.x * transform.scaleX
  const scaledY = vertex.y * transform.scaleY
  return {
    x: rotateX(scaledX, scaledY, transform.rotation) + transform.x,
    y: rotateY(scaledX, scaledY, transform.rotation) + transform.y,
  }
}

function toLocal(x: number, y: number, transform: WorldTransform): MeshVertex {
  const localX = rotateX(x - transform.x, y - transform.y, -transform.rotation)
  const localY = rotateY(x - transform.x, y - transform.y, -transform.rotation)
  return {
    x: localX / (transform.scaleX || 1),
    y: localY / (transform.scaleY || 1),
  }
}
