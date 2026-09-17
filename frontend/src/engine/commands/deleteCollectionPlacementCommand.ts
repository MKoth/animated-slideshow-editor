import type { Engine } from '../internal'
import type { Command } from './command'
import { requireString } from '../guards'
import type { CollectionPlacement } from '../collectionPlacement'
import type { ClipInstanceJSON } from '../json'
import { clipInstanceToJSON } from '../clipInstance'

export interface DeleteCollectionPlacementParameters {
  readonly placementId: string
}

export interface DeletedPlacementMember {
  readonly nodeId: string
  readonly layerIndex: number
  readonly instance: ClipInstanceJSON
}

export interface DeleteCollectionPlacementInverse {
  readonly placement: CollectionPlacement
  readonly index: number
  readonly memberPlacements: readonly { nodeId: string; instanceId: string; placementId: string }[]
  /** Full snapshots of member instances removed with the placement (undo restores them). */
  readonly memberInstances: readonly DeletedPlacementMember[]
}

export class DeleteCollectionPlacementCommand implements Command<DeleteCollectionPlacementInverse> {
  readonly type = 'DeleteCollectionPlacement'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #placementId: string

  constructor(input: DeleteCollectionPlacementParameters) {
    requireString(input.placementId, 'placementId')
    this.#placementId = input.placementId
    this.parameters = { placementId: input.placementId }
  }

  validate(engine: Engine): void {
    engine.getCollectionPlacement(this.#placementId)
  }

  execute(engine: Engine): DeleteCollectionPlacementInverse {
    const placement = engine.getCollectionPlacement(this.#placementId)
    const parent = engine.getNode(placement.parentNodeId)
    const index = parent.collectionPlacements.findIndex((p) => p.id === this.#placementId)
    // capture members before delete (instances are removed with the placement)
    const members: { nodeId: string; instanceId: string; placementId: string }[] = []
    const memberInstances: DeletedPlacementMember[] = []
    const membersRaw = engine.getPlacementMembers(this.#placementId)
    for (const m of membersRaw) {
      members.push({ nodeId: m.nodeId, instanceId: m.instance.id, placementId: this.#placementId })
      const node = engine.getNode(m.nodeId)
      memberInstances.push({
        nodeId: m.nodeId,
        layerIndex: node.clipInstances.findIndex((inst) => inst.id === m.instance.id),
        instance: clipInstanceToJSON(m.instance),
      })
    }
    engine.deleteCollectionPlacement(this.#placementId)
    return { placement: { ...placement }, index, memberPlacements: members, memberInstances }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
