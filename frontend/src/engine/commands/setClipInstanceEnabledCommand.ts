import type { Engine } from '../internal'
import type { Command } from './command'
import { requireBoolean } from '../guards'

export interface SetClipInstanceEnabledParameters {
  readonly nodeId: string
  readonly instanceId: string
  readonly enabled: boolean
}

export interface SetClipInstanceEnabledInverse {
  readonly nodeId: string
  readonly instanceId: string
  readonly oldEnabled: boolean
}

export class SetClipInstanceEnabledCommand implements Command<SetClipInstanceEnabledInverse> {
  readonly type = 'SetClipInstanceEnabled'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #instanceId: string
  readonly #enabled: boolean

  constructor(input: SetClipInstanceEnabledParameters) {
    this.#nodeId = input.nodeId
    this.#instanceId = input.instanceId
    this.#enabled = input.enabled
    this.parameters = {
      nodeId: input.nodeId,
      instanceId: input.instanceId,
      enabled: input.enabled,
    }
  }

  validate(engine: Engine): void {
    engine.getNode(this.#nodeId)
    engine.getClipInstance(this.#nodeId, this.#instanceId)
    requireBoolean(this.#enabled, 'Enabled')
  }

  execute(engine: Engine): SetClipInstanceEnabledInverse {
    const instance = engine.getClipInstance(this.#nodeId, this.#instanceId)
    const oldEnabled = instance.enabled
    engine.setClipInstanceEnabled(this.#nodeId, this.#instanceId, this.#enabled)
    return { nodeId: this.#nodeId, instanceId: this.#instanceId, oldEnabled }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
