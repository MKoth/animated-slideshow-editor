import type { Engine } from '../internal'
import type { Command } from './command'
import { requireString, requireFiniteNumber } from '../guards'

export interface SetCollectionPlacementStartTimeParameters {
  readonly placementId: string
  readonly startTime: number
}

export interface SetCollectionPlacementStartTimeInverse {
  readonly placementId: string
  readonly oldStartTime: number
}

export class SetCollectionPlacementStartTimeCommand implements Command<SetCollectionPlacementStartTimeInverse> {
  readonly type = 'SetCollectionPlacementStartTime'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #placementId: string
  readonly #startTime: number

  constructor(input: SetCollectionPlacementStartTimeParameters) {
    requireString(input.placementId, 'placementId')
    requireFiniteNumber(input.startTime, 'startTime')
    if (input.startTime < 0) throw new Error('startTime must be non-negative')
    this.#placementId = input.placementId
    this.#startTime = input.startTime
    this.parameters = { placementId: input.placementId, startTime: input.startTime }
  }

  validate(engine: Engine): void {
    engine.getCollectionPlacement(this.#placementId)
    requireFiniteNumber(this.#startTime, 'startTime')
  }

  execute(engine: Engine): SetCollectionPlacementStartTimeInverse {
    const old = engine.setCollectionPlacementStartTime(this.#placementId, this.#startTime)
    return { placementId: this.#placementId, oldStartTime: old }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
