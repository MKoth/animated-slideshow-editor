import type { Engine } from '../internal'
import type { Command } from './command'
import { requireString, requireFiniteNumber } from '../guards'
import { requireMirrorAxis, mirrorMorphGeometry } from '../clipMirror'
import type { MirrorAxis } from '../clipMirror'
import { walkPreOrder } from '../sceneNode'
import { cloneMeshData } from '../mesh'
import type { MeshData } from '../mesh'
import type { Shape } from '../shape'

export interface MirrorCollectionParameters {
  readonly sourceCollectionId: string
  readonly newName: string
  readonly axis: MirrorAxis
  readonly targetParentNodeId?: string
  readonly startTime?: number
}

export interface MirrorCollectionShapeSnapshot {
  readonly nodeId: string
  readonly oldMesh: MeshData
  readonly oldShapes: readonly Shape[] | undefined
}

export interface MirrorCollectionInverse {
  readonly newCollectionId: string
  readonly snapshot: unknown
  readonly newClipIds: readonly string[]
  readonly clipSnapshots: readonly unknown[]
  readonly skipped: readonly string[]
  readonly placementId?: string
  readonly placementSnapshot?: unknown
  readonly createdInstanceIds?: readonly { nodeId: string; instanceId: string }[]
  readonly instanceSnapshots?: readonly unknown[]
  readonly parentNodeId?: string
  /**
   * Index-preserving morph-geometry auto-mirror snapshots (issue #357).
   * Present only when a target subtree was auto-mirrored; restored on undo
   * and re-applied on redo as part of the same single History Entry.
   */
  readonly shapeSnapshots?: readonly MirrorCollectionShapeSnapshot[]
  /**
   * Non-fatal morph warnings (vertex-count mismatches). The mirror never
   * fails for shape data — mismatched shapes fall back to base geometry.
   */
  readonly morphWarnings?: readonly string[]
}

export class MirrorCollectionCommand implements Command<MirrorCollectionInverse> {
  readonly type = 'MirrorCollection'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #sourceCollectionId: string
  readonly #newName: string
  readonly #axis: MirrorAxis
  readonly #targetParentNodeId?: string
  readonly #startTime?: number

  constructor(input: MirrorCollectionParameters) {
    requireString(input.sourceCollectionId, 'sourceCollectionId')
    requireString(input.newName, 'newName')
    const axis = requireMirrorAxis(input.axis)
    if (input.targetParentNodeId !== undefined)
      requireString(input.targetParentNodeId, 'targetParentNodeId')
    if (input.startTime !== undefined) {
      requireFiniteNumber(input.startTime, 'startTime')
      if (input.startTime < 0) throw new Error('startTime must be non-negative')
    }
    this.#sourceCollectionId = input.sourceCollectionId
    this.#newName = input.newName
    this.#axis = axis
    this.#targetParentNodeId = input.targetParentNodeId
    this.#startTime = input.startTime
    this.parameters = {
      sourceCollectionId: input.sourceCollectionId,
      newName: input.newName,
      axis,
      ...(input.targetParentNodeId !== undefined
        ? { targetParentNodeId: input.targetParentNodeId }
        : {}),
      ...(input.startTime !== undefined ? { startTime: input.startTime } : {}),
    }
  }

  validate(engine: Engine): void {
    if (!engine.project) throw new Error('No project exists in memory')
    const source = engine.getClipCollection(this.#sourceCollectionId)
    requireString(this.#newName, 'newName')
    if (this.#newName.trim() === '') throw new Error('newName must not be empty')
    requireMirrorAxis(this.#axis)
    void source
    if (this.#targetParentNodeId !== undefined) {
      engine.getNode(this.#targetParentNodeId)
      if (this.#startTime !== undefined) {
        requireFiniteNumber(this.#startTime!, 'startTime')
        if (this.#startTime! < 0) throw new Error('startTime must be non-negative')
      }
    }
  }

  execute(engine: Engine): MirrorCollectionInverse {
    const { collection, clipIdMap, skipped } = engine.createMirroredCollection(
      this.#sourceCollectionId,
      this.#axis,
      this.#newName,
    )
    const newClipIds = [...clipIdMap.values()]
    const clipSnapshots = newClipIds.map((id) => engine.getClip(id).toJSON())
    let shapeSnapshots: MirrorCollectionShapeSnapshot[] | undefined
    let morphWarnings: string[] | undefined
    if (this.#targetParentNodeId !== undefined) {
      // Morph geometry auto-mirror end-to-end (issue #357): mirror rest
      // vertices plus every Shape's vertices index-preservingly on the
      // target subtree so verbatim-copied coefficient curves keep resolving
      // on mirrored geometry. Asymmetric rigs degrade to warnings, never
      // failures — per-node try/catch, mismatches warn with base fallback.
      try {
        const root = engine.getNode(this.#targetParentNodeId)
        for (const node of walkPreOrder(root)) {
          const meshComp = node.components.mesh
          if (!meshComp) continue
          try {
            const oldMesh = cloneMeshData(meshComp.mesh)
            const oldShapes = meshComp.shapes
              ? meshComp.shapes.map((s) => ({
                  id: s.id,
                  name: s.name,
                  categoryId: s.categoryId ?? null,
                  vertices: s.vertices.map((v) => ({ x: v.x, y: v.y })),
                }))
              : undefined
            const { mesh, shapes, warnings } = mirrorMorphGeometry(
              meshComp.mesh,
              meshComp.shapes,
              this.#axis,
              { nodeName: node.name },
            )
            if (!shapeSnapshots) shapeSnapshots = []
            shapeSnapshots.push({ nodeId: node.id, oldMesh, oldShapes })
            engine.setMeshData(node.id, mesh)
            engine.restoreShapes(node.id, [...shapes])
            if (warnings.length > 0) {
              if (!morphWarnings) morphWarnings = []
              morphWarnings.push(...warnings)
            }
          } catch (e) {
            const warning =
              `[morph-mirror] Skipping geometry auto-mirror on node "${node.name}": ` +
              `${e instanceof Error ? e.message : String(e)} — morphs fall back to base geometry`
            if (!morphWarnings) morphWarnings = []
            morphWarnings.push(warning)
            console.warn(warning)
          }
        }
      } catch (e) {
        const warning = `[morph-mirror] Geometry auto-mirror skipped: ${e instanceof Error ? e.message : String(e)}`
        if (!morphWarnings) morphWarnings = []
        morphWarnings.push(warning)
        console.warn(warning)
      }
      // Mirror-time missing-shape check (issue #357): warn for remapped
      // shape names absent from the target subtree — eval falls back to
      // base geometry per resolveMorphedVertices, never failing the mirror.
      // Union-based so it only warns when absent everywhere (no false
      // positives when a name lives on a different node than the binding).
      try {
        const targetRoot = engine.getNode(this.#targetParentNodeId)
        const available = new Set<string>()
        for (const node of walkPreOrder(targetRoot)) {
          const meshComp = node.components.mesh
          if (!meshComp?.shapes) continue
          for (const s of meshComp.shapes) available.add(s.name)
        }
        const reported = new Set<string>()
        for (const newClipId of newClipIds) {
          let clipName = newClipId
          let keyframes: readonly { value: unknown }[] = []
          try {
            const clip = engine.getClip(newClipId)
            clipName = clip.name
            keyframes = clip.getMorphKeyframes()
          } catch {
            continue
          }
          for (const kf of keyframes) {
            const v = kf.value as unknown
            if (typeof v !== 'object' || v === null || Array.isArray(v)) continue
            const rec = v as Record<string, unknown>
            for (const key of ['fromShapeName', 'toShapeName'] as const) {
              const name = rec[key]
              if (typeof name !== 'string' || available.has(name) || reported.has(name)) {
                continue
              }
              reported.add(name)
              const warning =
                `[morph-mirror] Shape "${name}" referenced by mirrored clip "${clipName}" ` +
                `not found on the mirror target — morphs fall back to base geometry`
              if (!morphWarnings) morphWarnings = []
              morphWarnings.push(warning)
              console.warn(warning)
            }
          }
        }
      } catch {
        void 0
      }
    }
    let placementId: string | undefined
    let placementSnapshot: unknown | undefined
    let createdInstanceIds: { nodeId: string; instanceId: string }[] | undefined
    let instanceSnapshots: unknown[] | undefined
    let parentNodeId: string | undefined
    if (this.#targetParentNodeId !== undefined) {
      const start = this.#startTime ?? 0
      const result = engine.placeCollection(collection.id, this.#targetParentNodeId, start)
      placementId = result.placement.id
      placementSnapshot = { ...result.placement }
      createdInstanceIds = result.created.map((c) => ({
        nodeId: c.nodeId,
        instanceId: c.instanceId,
      }))
      instanceSnapshots = result.created
        .map((c) => {
          const node = engine.getNode(c.nodeId)
          const inst = node.clipInstances.find((i) => i.id === c.instanceId)
          return inst ? { ...inst } : null
        })
        .filter(Boolean)
      parentNodeId = this.#targetParentNodeId
    }
    return {
      newCollectionId: collection.id,
      snapshot: collection.toJSON(),
      newClipIds,
      clipSnapshots,
      skipped,
      ...(shapeSnapshots ? { shapeSnapshots } : {}),
      ...(morphWarnings ? { morphWarnings } : {}),
      ...(placementId
        ? { placementId, placementSnapshot, createdInstanceIds, instanceSnapshots, parentNodeId }
        : {}),
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
