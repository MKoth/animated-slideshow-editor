import type { Engine } from '../internal'
import type { Command } from './command'
import { requireBoolean } from '../guards'

export interface SetVisibilityParameters {
  readonly nodeId: string
  readonly visible: boolean
}

export interface SetVisibilityInverse {
  readonly nodeId: string
  readonly oldVisible: boolean
}

export class SetVisibilityCommand implements Command<SetVisibilityInverse> {
  readonly type = 'SetVisibility'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #visible: boolean

  constructor(input: SetVisibilityParameters) {
    this.#nodeId = input.nodeId
    this.#visible = input.visible
    this.parameters = { nodeId: input.nodeId, visible: this.#visible }
  }

  validate(engine: Engine): void {
    requireBoolean(this.#visible, 'Visible')
    engine.getNode(this.#nodeId)
  }

  execute(engine: Engine): SetVisibilityInverse {
    const { visible } = engine.getNode(this.#nodeId)
    engine.setVisibility(this.#nodeId, this.#visible)
    return { nodeId: this.#nodeId, oldVisible: visible }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
