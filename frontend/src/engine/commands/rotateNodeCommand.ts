import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'

export interface RotateNodeParameters {
  readonly nodeId: string
  readonly rotation: number
}

export interface RotateNodeInverse {
  readonly nodeId: string
  readonly oldRotation: number
}

export class RotateNodeCommand implements Command<RotateNodeInverse> {
  readonly type = 'RotateNode'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #rotation: number

  constructor(input: RotateNodeParameters) {
    this.#nodeId = input.nodeId
    this.#rotation = input.rotation
    this.parameters = { nodeId: input.nodeId, rotation: this.#rotation }
  }

  validate(engine: Engine): void {
    requireFiniteNumber(this.#rotation, 'Rotation')
    engine.getNode(this.#nodeId)
  }

  execute(engine: Engine): RotateNodeInverse {
    const { transform } = engine.getNode(this.#nodeId)
    engine.setTransform(this.#nodeId, { ...transform, rotation: this.#rotation })
    return { nodeId: this.#nodeId, oldRotation: transform.rotation }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
