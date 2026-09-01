import type { Engine } from '../internal'
import type { Command } from './command'
import { applyUndo } from './undoHandlers'

export interface TransactionParameters {
  readonly commands: readonly Readonly<Record<string, unknown>>[]
}

export interface TransactionInverseChild {
  readonly type: string
  readonly parameters: Readonly<Record<string, unknown>>
  readonly inverse: unknown
}

export interface TransactionInverse {
  readonly children: readonly TransactionInverseChild[]
}

export class TransactionCommand implements Command<TransactionInverse> {
  readonly type = 'Transaction'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #children: readonly Command<unknown>[]

  get children(): readonly Command<unknown>[] {
    return this.#children
  }

  constructor(commands: readonly Command<unknown>[]) {
    this.#children = flatten(commands)
    this.parameters = { commands: this.#children.map((command) => command.toJSON()) }
  }

  validate(engine: Engine): void {
    for (const command of this.#children) {
      command.validate(engine)
    }
  }

  execute(engine: Engine): TransactionInverse {
    const children: TransactionInverseChild[] = []
    try {
      for (const command of this.#children) {
        const inverse = command.execute(engine)
        children.push({ type: command.type, parameters: command.parameters, inverse })
      }
    } catch (error) {
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i]
        try {
          applyUndo(engine, child.type, child.parameters, child.inverse)
        } catch {
          // best-effort rollback: ignore secondary failures
        }
      }
      throw error
    }
    return { children }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, commands: this.#children.map((command) => command.toJSON()) }
  }
}

function flatten(commands: readonly Command<unknown>[]): readonly Command<unknown>[] {
  const result: Command<unknown>[] = []
  for (const cmd of commands) {
    if (cmd instanceof TransactionCommand) {
      result.push(...flatten(cmd.children))
    } else {
      result.push(cmd)
    }
  }
  return result
}
