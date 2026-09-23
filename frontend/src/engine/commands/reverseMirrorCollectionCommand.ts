import type { Engine } from '../internal'
import type { Command } from './command'
import { requireString, requireFiniteNumber } from '../guards'
import { requireMirrorAxis } from '../clipMirror'
import type { MirrorAxis } from '../clipMirror'

export interface ReverseMirrorCollectionParameters {
  readonly sourceCollectionId: string
  readonly newName: string
  readonly axis: MirrorAxis
  readonly targetParentNodeId?: string
  readonly startTime?: number
}

export interface ReverseMirrorCollectionInverse {
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
}

export class ReverseMirrorCollectionCommand implements Command<ReverseMirrorCollectionInverse> {
  readonly type = 'ReverseMirrorCollection'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #sourceCollectionId: string
  readonly #newName: string
  readonly #axis: MirrorAxis
  readonly #targetParentNodeId?: string
  readonly #startTime?: number

  constructor(input: ReverseMirrorCollectionParameters) {
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

  execute(engine: Engine): ReverseMirrorCollectionInverse {
    const { collection, clipIdMap, skipped } = engine.createReverseMirroredCollection(
      this.#sourceCollectionId,
      this.#axis,
      this.#newName,
    )
    const newClipIds = [...clipIdMap.values()]
    const clipSnapshots = newClipIds.map((id) => engine.getClip(id).toJSON())
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
      ...(placementId
        ? { placementId, placementSnapshot, createdInstanceIds, instanceSnapshots, parentNodeId }
        : {}),
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
