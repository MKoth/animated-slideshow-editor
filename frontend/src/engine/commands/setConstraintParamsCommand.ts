import type { Engine } from '../internal'
import type { Command } from './command'
import type { ConstraintParams } from '../constraint'

export interface SetConstraintParamsParameters {
  readonly nodeId: string
  readonly constraintId: string
  readonly params: ConstraintParams
}

export interface SetConstraintParamsInverse {
  readonly nodeId: string
  readonly constraintId: string
  readonly oldParams: ConstraintParams
}

export class SetConstraintParamsCommand implements Command<SetConstraintParamsInverse> {
  readonly type = 'SetConstraintParams'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #constraintId: string
  readonly #params: ConstraintParams

  constructor(input: SetConstraintParamsParameters) {
    this.#nodeId = input.nodeId
    this.#constraintId = input.constraintId
    this.#params = { ...input.params }
    this.parameters = {
      nodeId: input.nodeId,
      constraintId: input.constraintId,
      params: this.#params,
    }
  }

  validate(engine: Engine): void {
    engine.getNode(this.#nodeId)
    engine.getConstraint(this.#constraintId)
  }

  execute(engine: Engine): SetConstraintParamsInverse {
    const oldConstraint = engine.getConstraint(this.#constraintId)
    const oldParams = { ...oldConstraint.params }
    engine.setConstraintParams(this.#nodeId, this.#constraintId, this.#params)
    return { nodeId: this.#nodeId, constraintId: this.#constraintId, oldParams }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
