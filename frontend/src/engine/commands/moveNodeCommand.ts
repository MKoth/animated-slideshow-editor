import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'

export interface MoveNodeParameters {
  readonly nodeId: string
  readonly x: number
  readonly y: number
}

export interface MoveNodeInverse {
  readonly nodeId: string
  readonly oldX: number
  readonly oldY: number
}

export class MoveNodeCommand implements Command<MoveNodeInverse> {
  readonly type = 'MoveNode'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #x: number
  readonly #y: number

  constructor(input: MoveNodeParameters) {
    this.#nodeId = input.nodeId
    this.#x = input.x
    this.#y = input.y
    this.parameters = { nodeId: input.nodeId, x: this.#x, y: this.#y }
  }

  validate(engine: Engine): void {
    engine.getNode(this.#nodeId)
    requireFiniteNumber(this.#x, 'X')
    requireFiniteNumber(this.#y, 'Y')
  }

  execute(engine: Engine): MoveNodeInverse {
    const { transform } = engine.getNode(this.#nodeId)
    engine.setTransform(this.#nodeId, { ...transform, x: this.#x, y: this.#y })
    return { nodeId: this.#nodeId, oldX: transform.x, oldY: transform.y }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
