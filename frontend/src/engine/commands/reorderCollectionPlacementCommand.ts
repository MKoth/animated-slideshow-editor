import type { Engine } from '../internal'
import type { Command } from './command'
import { requireString, requireFiniteNumber } from '../guards'

export interface ReorderCollectionPlacementParameters {
  readonly parentNodeId: string
  readonly placementId: string
  readonly newIndex: number
}

export interface ReorderCollectionPlacementInverse {
  readonly parentNodeId: string
  readonly placementId: string
  readonly oldIndex: number
}

export class ReorderCollectionPlacementCommand implements Command<ReorderCollectionPlacementInverse> {
  readonly type = 'ReorderCollectionPlacement'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #parentNodeId: string
  readonly #placementId: string
  readonly #newIndex: number

  constructor(input: ReorderCollectionPlacementParameters) {
    requireString(input.parentNodeId, 'parentNodeId')
    requireString(input.placementId, 'placementId')
    requireFiniteNumber(input.newIndex, 'newIndex')
    if (!Number.isInteger(input.newIndex) || input.newIndex < 0)
      throw new Error('newIndex must be non-negative integer')
    this.#parentNodeId = input.parentNodeId
    this.#placementId = input.placementId
    this.#newIndex = input.newIndex
    this.parameters = {
      parentNodeId: input.parentNodeId,
      placementId: input.placementId,
      newIndex: input.newIndex,
    }
  }

  validate(engine: Engine): void {
    engine.getNode(this.#parentNodeId)
    engine.getCollectionPlacement(this.#placementId)
    const parent = engine.getNode(this.#parentNodeId)
    if (this.#newIndex >= parent.collectionPlacements.length)
      throw new Error(`newIndex out of bounds: ${this.#newIndex}`)
  }

  execute(engine: Engine): ReorderCollectionPlacementInverse {
    const oldIndex = engine.reorderCollectionPlacement(
      this.#parentNodeId,
      this.#placementId,
      this.#newIndex,
    )
    return { parentNodeId: this.#parentNodeId, placementId: this.#placementId, oldIndex }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
