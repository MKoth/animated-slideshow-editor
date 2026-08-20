import type { Engine } from '../internal'
import type { Command } from './command'
import type { ConstraintType, ConstraintParams } from '../constraint'

export interface AddConstraintParameters {
  readonly nodeId: string
  readonly constraintType: ConstraintType
  readonly priority: number
  readonly params: ConstraintParams
}

export interface AddConstraintInverse {
  readonly nodeId: string
  readonly constraintId: string
}

export class AddConstraintCommand implements Command<AddConstraintInverse> {
  readonly type = 'AddConstraint'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #constraintType: ConstraintType
  readonly #priority: number
  readonly #params: ConstraintParams

  constructor(input: AddConstraintParameters) {
    this.#nodeId = input.nodeId
    this.#constraintType = input.constraintType
    this.#priority = input.priority
    this.#params = { ...input.params }
    this.parameters = {
      nodeId: input.nodeId,
      constraintType: input.constraintType,
      priority: input.priority,
      params: this.#params,
    }
  }

  validate(engine: Engine): void {
    engine.getNode(this.#nodeId)
  }

  execute(engine: Engine): AddConstraintInverse {
    const constraint = engine.addConstraint(
      this.#nodeId,
      this.#constraintType,
      this.#priority,
      this.#params,
    )
    return { nodeId: this.#nodeId, constraintId: constraint.id }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
