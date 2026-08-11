import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'

export interface ScaleNodeParameters {
  readonly nodeId: string
  readonly scaleX: number
  readonly scaleY: number
}

export interface ScaleNodeInverse {
  readonly nodeId: string
  readonly oldScaleX: number
  readonly oldScaleY: number
}

export class ScaleNodeCommand implements Command<ScaleNodeInverse> {
  readonly type = 'ScaleNode'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #scaleX: number
  readonly #scaleY: number

  constructor(input: ScaleNodeParameters) {
    this.#nodeId = input.nodeId
    this.#scaleX = input.scaleX
    this.#scaleY = input.scaleY
    this.parameters = { nodeId: input.nodeId, scaleX: this.#scaleX, scaleY: this.#scaleY }
  }

  validate(engine: Engine): void {
    engine.getNode(this.#nodeId)
    requireFiniteNumber(this.#scaleX, 'ScaleX')
    requireFiniteNumber(this.#scaleY, 'ScaleY')
  }

  execute(engine: Engine): ScaleNodeInverse {
    const { transform } = engine.getNode(this.#nodeId)
    engine.setTransform(this.#nodeId, {
      ...transform,
      scaleX: this.#scaleX,
      scaleY: this.#scaleY,
    })
    return { nodeId: this.#nodeId, oldScaleX: transform.scaleX, oldScaleY: transform.scaleY }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
