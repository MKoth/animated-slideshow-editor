import type { Engine } from '../internal'
import type { Command } from './command'
import type { Constraint } from '../constraint'

export interface RemoveConstraintParameters {
  readonly nodeId: string
  readonly constraintId: string
}

export interface RemoveConstraintInverse {
  readonly nodeId: string
  readonly constraint: Constraint
}

export class RemoveConstraintCommand implements Command<RemoveConstraintInverse> {
  readonly type = 'RemoveConstraint'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #constraintId: string

  constructor(input: RemoveConstraintParameters) {
    this.#nodeId = input.nodeId
    this.#constraintId = input.constraintId
    this.parameters = {
      nodeId: input.nodeId,
      constraintId: input.constraintId,
    }
  }

  validate(engine: Engine): void {
    engine.getNode(this.#nodeId)
    engine.getConstraint(this.#constraintId)
  }

  execute(engine: Engine): RemoveConstraintInverse {
    const constraint = engine.removeConstraint(this.#nodeId, this.#constraintId)
    return { nodeId: this.#nodeId, constraint }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
