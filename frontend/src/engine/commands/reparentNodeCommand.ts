import type { Engine } from '../internal'
import type { Transform } from '../transform'
import { relativeTransform, transformsEqual, worldTransformOf } from '../worldTransform'
import type { Command } from './command'
import { walkPreOrder, wouldFormCycle } from '../sceneNode'

export type ParentingMode = 'keepWorld' | 'snapToTail'

export interface ReparentNodeParameters {
  readonly nodeId: string
  readonly parentId: string
  readonly index?: number
  readonly parentingMode?: ParentingMode
}

export interface ReparentNodeInverse {
  readonly nodeId: string
  readonly oldParentId: string
  readonly oldTransform: Transform
}

export class ReparentNodeCommand implements Command<ReparentNodeInverse> {
  readonly type = 'ReparentNode'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #parentId: string
  readonly #index: number | undefined
  readonly #parentingMode: ParentingMode

  constructor(input: ReparentNodeParameters) {
    this.#nodeId = input.nodeId
    this.#parentId = input.parentId
    this.#index = input.index
    this.#parentingMode = input.parentingMode ?? 'keepWorld'
    this.parameters = {
      nodeId: input.nodeId,
      parentId: input.parentId,
      ...(input.index !== undefined && { index: input.index }),
      ...(input.parentingMode !== undefined ? { parentingMode: input.parentingMode } : {}),
    }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (node.parent === null) {
      throw new Error('The root node cannot be reparented')
    }
    if (node.components.camera) {
      throw new Error('The camera node cannot be reparented')
    }
    const newParent = engine.getNodeScene(this.#nodeId).getNode(this.#parentId)
    if (!newParent) {
      throw new Error(`Parent node not found: ${this.#parentId}`)
    }
    if (this.#index !== undefined) {
      const bound = newParent.children.length + (newParent.children.includes(node) ? -1 : 0)
      if (!Number.isInteger(this.#index) || this.#index < 0 || this.#index > bound) {
        throw new Error(`Reorder index out of bounds: ${this.#index}`)
      }
    }
    if (node === newParent) {
      throw new Error('A node cannot be reparented to itself')
    }
    if (wouldFormCycle(node, newParent)) {
      throw new Error('A node cannot become a descendant of itself')
    }
  }

  execute(engine: Engine): ReparentNodeInverse {
    const node = engine.getNode(this.#nodeId)
    const oldParentId = node.parent ? node.parent.id : this.#parentId
    const oldTransform: Transform = { ...node.transform }
    const oldWorld = worldTransformOf(engine.getNodeScene(this.#nodeId), this.#nodeId)
    const newParentWorld = worldTransformOf(engine.getNodeScene(this.#nodeId), this.#parentId)
    engine.reparentNode(this.#nodeId, this.#parentId)
    if (this.#index !== undefined) {
      const newParent = engine.getNode(this.#parentId)
      const current = newParent.children.indexOf(node)
      if (current !== this.#index) {
        engine.reorderNode(this.#nodeId, this.#index)
      }
    }
    if (this.#parentingMode === 'snapToTail') {
      const reparentedNode = engine.getNode(this.#nodeId)
      const newParent = reparentedNode.parent
      const parentBoneLength = newParent?.components.bone?.length
      const snapTransform: Transform = {
        x: parentBoneLength ?? 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        ...(reparentedNode.transform.localPivot
          ? { localPivot: reparentedNode.transform.localPivot }
          : {}),
      }
      const current = reparentedNode.transform
      if (!transformsEqual(snapTransform, current)) {
        engine.setTransform(this.#nodeId, snapTransform)
      }
    } else if (oldWorld && newParentWorld) {
      const adjusted = relativeTransform(oldWorld, newParentWorld)
      const current = engine.getNode(this.#nodeId).transform
      if (adjusted && !transformsEqual(adjusted, current)) {
        engine.setTransform(this.#nodeId, adjusted)
      }
    }

    // --- Fix: keep skinning stable after reparent ---
    // If the reparented subtree contains bones, any mesh in the same scene that
    // references those bones will have a stale mesh-local bindPose (inv(meshWorld0)*boneWorld0)
    // if it was captured before the hierarchy changed. Even with KeepWorld (world preserved),
    // the *relative* mesh-local bind would be wrong if the mesh and the bone share a
    // common ancestor whose world changed (e.g. moving a chain under a Group). Recompute
    // the affected bindPose entries to the current relative so that subsequent
    // evaluateMeshDeformation (relativeCurrent * inv(bindLocal) * v) stays identity at rest.
    try {
      const scene = engine.getNodeScene(this.#nodeId)
      const reparentedNode = engine.getNode(this.#nodeId)
      const affectedBoneIds = new Set<string>()
      for (const n of walkPreOrder(reparentedNode)) {
        if (n.components.bone) affectedBoneIds.add(n.id)
      }
      // Also include the reparented node itself if it's a bone (walk includes it)
      // If no bone in subtree, nothing to do
      if (affectedBoneIds.size > 0) {
        for (const n of walkPreOrder(scene.root)) {
          const meshComp = n.components.mesh
          if (!meshComp) continue
          const mesh = meshComp.mesh
          if (!mesh.boneWeights || mesh.boneWeights.length === 0) continue
          // Check if this mesh references any affected bone
          let touches = false
          if (mesh.bindPose) {
            for (const bid of affectedBoneIds)
              if (mesh.bindPose[bid]) {
                touches = true
                break
              }
          }
          if (!touches) {
            for (const vw of mesh.boneWeights) {
              for (const w of vw)
                if (affectedBoneIds.has(w.boneId)) {
                  touches = true
                  break
                }
              if (touches) break
            }
          }
          if (!touches) continue

          const meshWorld = worldTransformOf(scene, n.id)
          if (!meshWorld) continue
          const newBindPose: Record<string, import('../mesh').BoneBindPose> = mesh.bindPose
            ? { ...mesh.bindPose }
            : {}
          let changed = false
          for (const bid of affectedBoneIds) {
            // Only update if the mesh actually uses this bone (or already has a bind entry)
            const usesBone =
              (mesh.bindPose && mesh.bindPose[bid]) ||
              mesh.boneWeights.some((vw) => vw.some((w) => w.boneId === bid))
            if (!usesBone) continue
            const boneWorld = worldTransformOf(scene, bid)
            if (!boneWorld) continue
            const rel = relativeTransform(boneWorld, meshWorld)
            if (!rel) continue
            const existing = newBindPose[bid]
            if (
              !existing ||
              existing.x !== rel.x ||
              existing.y !== rel.y ||
              existing.rotation !== rel.rotation ||
              existing.scaleX !== rel.scaleX ||
              existing.scaleY !== rel.scaleY
            ) {
              newBindPose[bid] = {
                x: rel.x,
                y: rel.y,
                rotation: rel.rotation,
                scaleX: rel.scaleX,
                scaleY: rel.scaleY,
              }
              changed = true
            }
          }
          if (changed) {
            const newMesh = { ...mesh, bindPose: newBindPose }
            engine.setMeshData(n.id, newMesh)
          }
        }
      }
    } catch {
      // Best-effort: never let bindPose upkeep break the reparent transaction
    }
    return { nodeId: this.#nodeId, oldParentId, oldTransform }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
