import type { Engine } from '../internal'
import type { Command } from './command'

export interface SetZIndexParameters {
  readonly nodeId: string
  readonly zIndex: number
}

export interface SetZIndexInverse {
  readonly nodeId: string
  readonly oldZIndex: number
}

export class SetZIndexCommand implements Command<SetZIndexInverse> {
  readonly type = 'SetZIndex'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #zIndex: number

  constructor(input: SetZIndexParameters) {
    this.#nodeId = input.nodeId
    this.#zIndex = Math.trunc(input.zIndex)
    this.parameters = { nodeId: input.nodeId, zIndex: this.#zIndex }
  }

  validate(engine: Engine): void {
    if (!Number.isFinite(this.#zIndex)) {
      throw new Error('zIndex must be a finite number')
    }
    engine.getNode(this.#nodeId)
  }

  execute(engine: Engine): SetZIndexInverse {
    const { zIndex } = engine.getNode(this.#nodeId)
    engine.setZIndex(this.#nodeId, this.#zIndex)
    return { nodeId: this.#nodeId, oldZIndex: zIndex }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
