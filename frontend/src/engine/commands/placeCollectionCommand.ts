import type { Engine } from '../internal'
import type { Command } from './command'
import { requireString, requireFiniteNumber } from '../guards'

export interface PlaceCollectionParameters {
  readonly collectionId: string
  readonly parentNodeId: string
  readonly startTime?: number
}

export interface PlaceCollectionInverse {
  readonly placementId: string
  readonly createdInstanceIds: readonly { nodeId: string; instanceId: string }[]
  readonly parentNodeId: string
}

export class PlaceCollectionCommand implements Command<PlaceCollectionInverse> {
  readonly type = 'PlaceCollection'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #collectionId: string
  readonly #parentNodeId: string
  readonly #startTime: number

  constructor(input: PlaceCollectionParameters) {
    requireString(input.collectionId, 'collectionId')
    requireString(input.parentNodeId, 'parentNodeId')
    const start = input.startTime ?? 0
    requireFiniteNumber(start, 'startTime')
    if (start < 0) throw new Error('startTime must be non-negative')
    this.#collectionId = input.collectionId
    this.#parentNodeId = input.parentNodeId
    this.#startTime = start
    this.parameters = { collectionId: input.collectionId, parentNodeId: input.parentNodeId, startTime: start }
  }

  validate(engine: Engine): void {
    engine.getClipCollection(this.#collectionId)
    engine.getNode(this.#parentNodeId)
  }

  execute(engine: Engine): PlaceCollectionInverse {
    const result = engine.placeCollection(this.#collectionId, this.#parentNodeId, this.#startTime)
    return {
      placementId: result.placement.id,
      createdInstanceIds: result.created.map((c) => ({ nodeId: c.nodeId, instanceId: c.instanceId })),
      parentNodeId: this.#parentNodeId,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
