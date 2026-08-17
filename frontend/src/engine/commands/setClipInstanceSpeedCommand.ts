import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'

export interface SetClipInstanceSpeedParameters {
  readonly nodeId: string
  readonly instanceId: string
  readonly speed: number
}

export interface SetClipInstanceSpeedInverse {
  readonly nodeId: string
  readonly instanceId: string
  readonly oldSpeed: number
}

export class SetClipInstanceSpeedCommand implements Command<SetClipInstanceSpeedInverse> {
  readonly type = 'SetClipInstanceSpeed'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #instanceId: string
  readonly #speed: number

  constructor(input: SetClipInstanceSpeedParameters) {
    this.#nodeId = input.nodeId
    this.#instanceId = input.instanceId
    this.#speed = input.speed
    this.parameters = {
      nodeId: input.nodeId,
      instanceId: input.instanceId,
      speed: input.speed,
    }
  }

  validate(engine: Engine): void {
    engine.getNode(this.#nodeId)
    engine.getClipInstance(this.#nodeId, this.#instanceId)
    requireFiniteNumber(this.#speed, 'Speed')
    if (this.#speed < 0) {
      throw new Error('Speed must be non-negative')
    }
  }

  execute(engine: Engine): SetClipInstanceSpeedInverse {
    const instance = engine.getClipInstance(this.#nodeId, this.#instanceId)
    const oldSpeed = instance.speed
    engine.setClipInstanceSpeed(this.#nodeId, this.#instanceId, this.#speed)
    return { nodeId: this.#nodeId, instanceId: this.#instanceId, oldSpeed }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
