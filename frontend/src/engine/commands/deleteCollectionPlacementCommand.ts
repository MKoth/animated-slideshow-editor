import type { Engine } from '../internal'
import type { Command } from './command'
import { requireString } from '../guards'
import type { CollectionPlacement } from '../collectionPlacement'

export interface DeleteCollectionPlacementParameters {
  readonly placementId: string
}

export interface DeleteCollectionPlacementInverse {
  readonly placement: CollectionPlacement
  readonly index: number
  readonly memberPlacements: readonly { nodeId: string; instanceId: string; placementId: string }[]
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
    // capture members before delete (their placementId will be cleared)
    const members: { nodeId: string; instanceId: string; placementId: string }[] = []
    const membersRaw = engine.getPlacementMembers(this.#placementId)
    for (const m of membersRaw) {
      members.push({ nodeId: m.nodeId, instanceId: m.instance.id, placementId: this.#placementId })
    }
    engine.deleteCollectionPlacement(this.#placementId)
    return { placement: { ...placement }, index, memberPlacements: members }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
