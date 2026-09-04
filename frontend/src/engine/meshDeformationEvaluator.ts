import type { MeshData, MeshVertex } from './mesh'
import type { WorldTransform } from './worldTransform'
import type { Shape, MorphState } from './shape'
import { resolveMorphedVertices } from './shape'

export interface DeformedMeshResult {
  readonly deformedVertices: readonly MeshVertex[]
}

function rotateX(x: number, y: number, rotation: number): number {
  return x * Math.cos(rotation) - y * Math.sin(rotation)
}

function rotateY(x: number, y: number, rotation: number): number {
  return x * Math.sin(rotation) + y * Math.cos(rotation)
}

// PROTOTYPE helper — morph-then-bones composition (research/morph-brush)
// Thin wrapper that lerps rest vertices before delegating to existing skin evaluator.
export function evaluateMorphedMeshDeformation(
  mesh: MeshData,
  morph: MorphState | null,
  shapes: readonly Shape[] | undefined,
  boneWorldTransforms: ReadonlyMap<string, WorldTransform>,
  meshWorldTransform?: WorldTransform,
): DeformedMeshResult {
  if (
    !morph ||
    !morph.binding ||
    morph.binding.fromShapeId === null ||
    morph.binding.toShapeId === null
  ) {
    return evaluateMeshDeformation(mesh, boneWorldTransforms, meshWorldTransform)
  }
  const morphedVerts = resolveMorphedVertices(mesh.vertices, shapes, morph)
  const morphedMesh: MeshData = { ...mesh, vertices: morphedVerts as MeshVertex[] }
  return evaluateMeshDeformation(morphedMesh, boneWorldTransforms, meshWorldTransform)
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

      const bp = bindPose?.[entry.boneId]
      let localVertex: MeshVertex
      if (bp) {
        // bindPose is mesh-local: inv(meshWorld0) * boneWorld0
        // relativeCurrent = inv(meshWorld) * boneWorld  (bone pose relative to mesh current)
        // deformedLocal = relativeCurrent * inv(bindPose) * vertex
        const relative = relativeTransform(boneTransform, meshWorldTransform)
        if (!relative) {
          continue
        }
        localVertex = applyRelativeBoneTransform(vertex, bp, relative)
      } else {
        // Legacy meshes have no bind matrix: retain rotation/scale-only behavior.
        // Use relative to keep Scale Group single-scale, but ignore translation.
        const relative = relativeTransform(boneTransform, meshWorldTransform)
        if (relative) {
          localVertex = applyAbsoluteBoneTransform(vertex, relative)
        } else {
          localVertex = applyAbsoluteBoneTransform(vertex, boneTransform)
        }
      }
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

function applyRelativeBoneTransform(
  vertex: MeshVertex,
  bindPoseLocal: NonNullable<MeshData['bindPose']>[string],
  relativeCurrent: WorldTransform,
): MeshVertex {
  // Transform vertex through inverse bind-local, then through current relative bone transform.
  // bindPoseLocal = inv(meshWorld0) * boneWorld0  (mesh-local)
  // relativeCurrent = inv(meshWorld) * boneWorld  (mesh-local current)
  const bindLocalX =
    rotateX(vertex.x - bindPoseLocal.x, vertex.y - bindPoseLocal.y, -bindPoseLocal.rotation) /
    (bindPoseLocal.scaleX || 1)
  const bindLocalY =
    rotateY(vertex.x - bindPoseLocal.x, vertex.y - bindPoseLocal.y, -bindPoseLocal.rotation) /
    (bindPoseLocal.scaleY || 1)
  const scaledX = bindLocalX * relativeCurrent.scaleX
  const scaledY = bindLocalY * relativeCurrent.scaleY
  return {
    x: rotateX(scaledX, scaledY, relativeCurrent.rotation) + relativeCurrent.x,
    y: rotateY(scaledX, scaledY, relativeCurrent.rotation) + relativeCurrent.y,
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

function relativeTransform(
  world: WorldTransform,
  parentWorld: WorldTransform,
): WorldTransform | null {
  if (parentWorld.scaleX === 0 || parentWorld.scaleY === 0) {
    return null
  }
  const dx = world.x - parentWorld.x
  const dy = world.y - parentWorld.y
  return {
    x: rotateX(dx, dy, -parentWorld.rotation) / parentWorld.scaleX,
    y: rotateY(dx, dy, -parentWorld.rotation) / parentWorld.scaleY,
    rotation: world.rotation - parentWorld.rotation,
    scaleX: world.scaleX / parentWorld.scaleX,
    scaleY: world.scaleY / parentWorld.scaleY,
  }
}
