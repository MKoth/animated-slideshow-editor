import type { ControlSet } from '../control'
import type { Engine } from '../internal'
import type { Command } from './command'

export interface SetControlSetParameters {
  readonly nodeId: string
  readonly controlSet?: ControlSet
}

export interface SetControlSetInverse {
  readonly nodeId: string
  readonly oldControlSet?: ControlSet
}

export class SetControlSetCommand implements Command<SetControlSetInverse> {
  readonly type = 'SetControlSet'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #controlSet?: ControlSet

  constructor(input: SetControlSetParameters) {
    this.#nodeId = input.nodeId
    this.#controlSet = input.controlSet
    this.parameters = { nodeId: input.nodeId, controlSet: input.controlSet }
  }

  validate(engine: Engine): void {
    engine.getNode(this.#nodeId)
  }

  execute(engine: Engine): SetControlSetInverse {
    const oldControlSet = engine.getNode(this.#nodeId).controlSet
    engine.setControlSet(this.#nodeId, this.#controlSet)
    return { nodeId: this.#nodeId, oldControlSet }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
