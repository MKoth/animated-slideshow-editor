import type { Engine } from '../internal'
import type { Command } from './command'
import { requireOpacity } from '../guards'

export interface SetOpacityParameters {
  readonly nodeId: string
  readonly opacity: number
}

export interface SetOpacityInverse {
  readonly nodeId: string
  readonly oldOpacity: number
}

export class SetOpacityCommand implements Command<SetOpacityInverse> {
  readonly type = 'SetOpacity'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #opacity: number

  constructor(input: SetOpacityParameters) {
    this.#nodeId = input.nodeId
    this.#opacity = input.opacity
    this.parameters = { nodeId: input.nodeId, opacity: this.#opacity }
  }

  validate(engine: Engine): void {
    requireOpacity(this.#opacity, 'Opacity')
    engine.getNode(this.#nodeId)
  }

  execute(engine: Engine): SetOpacityInverse {
    const { opacity } = engine.getNode(this.#nodeId)
    engine.setOpacity(this.#nodeId, this.#opacity)
    return { nodeId: this.#nodeId, oldOpacity: opacity }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
