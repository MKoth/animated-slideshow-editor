import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'

export interface SetClipInstanceStartTimeParameters {
  readonly nodeId: string
  readonly instanceId: string
  readonly startTime: number
}

export interface SetClipInstanceStartTimeInverse {
  readonly nodeId: string
  readonly instanceId: string
  readonly oldStartTime: number
}

export class SetClipInstanceStartTimeCommand implements Command<SetClipInstanceStartTimeInverse> {
  readonly type = 'SetClipInstanceStartTime'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #instanceId: string
  readonly #startTime: number

  constructor(input: SetClipInstanceStartTimeParameters) {
    this.#nodeId = input.nodeId
    this.#instanceId = input.instanceId
    this.#startTime = input.startTime
    this.parameters = {
      nodeId: input.nodeId,
      instanceId: input.instanceId,
      startTime: input.startTime,
    }
  }

  validate(engine: Engine): void {
    engine.getNode(this.#nodeId)
    engine.getClipInstance(this.#nodeId, this.#instanceId)
    requireFiniteNumber(this.#startTime, 'Start time')
    if (this.#startTime < 0) {
      throw new Error('Start time must be non-negative')
    }
  }

  execute(engine: Engine): SetClipInstanceStartTimeInverse {
    const instance = engine.getClipInstance(this.#nodeId, this.#instanceId)
    const oldStartTime = instance.startTime
    engine.setClipInstanceStartTime(this.#nodeId, this.#instanceId, this.#startTime)
    return { nodeId: this.#nodeId, instanceId: this.#instanceId, oldStartTime }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
