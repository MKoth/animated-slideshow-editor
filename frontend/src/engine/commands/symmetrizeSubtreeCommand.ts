import type { Engine } from '../internal'
import type { Command } from './command'
import { walkPreOrder } from '../sceneNode'
import { cloneMeshData } from '../mesh'
import {
  mirroredTransform,
  mirroredUVTransform,
  mirroredVertex,
  requireSymmetryAxis,
} from '../symmetry'
import type { SymmetryAxis } from '../symmetry'
import type { MeshData } from '../mesh'
import type { Shape } from '../shape'
import type { Transform } from '../transform'
import { cloneUVTransform } from '../uvTransform'
import type { UVTransform } from '../uvTransform'

export interface SymmetrizeSubtreeParameters {
  readonly nodeId: string
  readonly axis: SymmetryAxis
}

export interface SymmetrizeSubtreeInverse {
  readonly snapshots: readonly {
    readonly nodeId: string
    readonly oldTransform: Transform
    readonly oldMesh?: MeshData
    readonly oldShapes?: readonly Shape[]
    readonly oldUVTransform?: UVTransform
  }[]
}

export class SymmetrizeSubtreeCommand implements Command<SymmetrizeSubtreeInverse> {
  readonly type = 'SymmetrizeSubtree'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #axis: SymmetryAxis

  constructor(input: SymmetrizeSubtreeParameters) {
    this.#nodeId = input.nodeId
    this.#axis = requireSymmetryAxis(input.axis, 'SymmetrizeSubtree axis')
    this.parameters = { nodeId: input.nodeId, axis: input.axis }
  }

  validate(engine: Engine): void {
    engine.getNode(this.#nodeId)
    requireSymmetryAxis(this.#axis, 'SymmetrizeSubtree axis')
  }

  execute(engine: Engine): SymmetrizeSubtreeInverse {
    const root = engine.getNode(this.#nodeId)
    const nodes = [...walkPreOrder(root)]
    const snapshots: {
      nodeId: string
      oldTransform: Transform
      oldMesh?: MeshData
      oldShapes?: readonly Shape[]
      oldUVTransform?: UVTransform
    }[] = []

    for (const node of nodes) {
      const oldTransform: Transform = { ...node.transform }
      if (node.transform.localPivot) {
        ;(oldTransform as unknown as Record<string, unknown>).localPivot = {
          ...node.transform.localPivot,
        }
      }
      const oldUVTransform = node.material.uvTransform
        ? cloneUVTransform(node.material.uvTransform)
        : undefined
      const meshComp = node.components.mesh
      const circleComp = node.components.circle
      const hasTexture = Boolean(node.material.textureId)
      if (meshComp) {
        const oldMesh = cloneMeshData(meshComp.mesh)
        const oldShapes = meshComp.shapes
          ? meshComp.shapes.map((s) => ({
              id: s.id,
              name: s.name,
              categoryId: s.categoryId ?? null,
              vertices: s.vertices.map((v) => ({ x: v.x, y: v.y })),
            }))
          : undefined

        snapshots.push({ nodeId: node.id, oldTransform, oldMesh, oldShapes, oldUVTransform })

        // Mirror geometry and flip winding. Keep UVs attached to their vertices:
        // reflecting the geometry already reflects the sampled image with it.
        const newVertices = meshComp.mesh.vertices.map((v) => mirroredVertex(v, this.#axis))
        const newUvs = meshComp.mesh.uvs.map((uv) => ({ u: uv.u, v: uv.v }))
        const newFaces = meshComp.mesh.faces.map((f) => ({ v0: f.v0, v1: f.v2, v2: f.v1 }))
        const newMesh: MeshData = {
          ...meshComp.mesh,
          vertices: newVertices,
          uvs: newUvs,
          faces: newFaces,
        }

        const newTransform = mirroredTransform(node.transform, this.#axis)
        engine.setTransform(node.id, newTransform)
        engine.setMeshData(node.id, newMesh)
        if (oldShapes && oldShapes.length > 0) {
          const newShapes: Shape[] = oldShapes.map((s) => ({
            id: s.id,
            name: s.name,
            categoryId: s.categoryId ?? null,
            vertices: s.vertices.map((v) => mirroredVertex(v, this.#axis)),
          }))
          engine.restoreShapes(node.id, newShapes)
        }
      } else if (circleComp) {
        snapshots.push({ nodeId: node.id, oldTransform, oldUVTransform })
        const newTransform = mirroredTransform(node.transform, this.#axis)
        engine.setTransform(node.id, newTransform)
        if (hasTexture) {
          const newUV = mirroredUVTransform(node.material.uvTransform, this.#axis)
          const newMaterial: Record<string, unknown> = {
            materialDefinitionId: node.material.materialDefinitionId,
            overrides: { ...node.material.overrides },
            textureId: node.material.textureId,
          }
          if (newUV) (newMaterial as unknown as { uvTransform: UVTransform }).uvTransform = newUV
          ;(node as unknown as { material: unknown }).material = newMaterial
          engine.emitMaterialChanged(node.id)
        }
      } else {
        // Group / bone / other: only mirror transform, but also flip texture if somehow present
        snapshots.push({ nodeId: node.id, oldTransform, oldUVTransform })
        const mirrored = mirroredTransform(node.transform, this.#axis)
        // Asset instances render as sprites, so reflect the sprite itself rather
        // than only moving/rotating its container.
        const newTransform: Transform = node.components.assetInstance
          ? {
              ...mirrored,
              scaleX: this.#axis === 'x' ? -mirrored.scaleX : mirrored.scaleX,
              scaleY: this.#axis === 'y' ? -mirrored.scaleY : mirrored.scaleY,
            }
          : mirrored
        const needsTransform =
          newTransform.x !== node.transform.x ||
          newTransform.y !== node.transform.y ||
          newTransform.rotation !== node.transform.rotation ||
          newTransform.scaleX !== node.transform.scaleX ||
          newTransform.scaleY !== node.transform.scaleY ||
          JSON.stringify(newTransform.localPivot) !== JSON.stringify(node.transform.localPivot)
        if (needsTransform) {
          engine.setTransform(node.id, newTransform)
        }
        if (hasTexture) {
          const newUV = mirroredUVTransform(node.material.uvTransform, this.#axis)
          const newMaterial: Record<string, unknown> = {
            materialDefinitionId: node.material.materialDefinitionId,
            overrides: { ...node.material.overrides },
            textureId: node.material.textureId,
          }
          if (newUV) (newMaterial as unknown as { uvTransform: UVTransform }).uvTransform = newUV
          ;(node as unknown as { material: unknown }).material = newMaterial
          engine.emitMaterialChanged(node.id)
        }
      }
    }

    return { snapshots }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
