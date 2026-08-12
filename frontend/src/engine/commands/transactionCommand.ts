import type { Engine } from '../internal'
import { isRecord } from '../guards'
import type { Command } from './command'

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

  constructor(commands: readonly Command<unknown>[]) {
    this.#children = commands
    this.parameters = { commands: commands.map((command) => command.toJSON()) }
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
      for (const child of children) {
        restoreMove(engine, child.inverse)
      }
      throw error
    }
    return { children }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, commands: this.#children.map((command) => command.toJSON()) }
  }
}

function restoreMove(engine: Engine, inverse: unknown): void {
  if (!isRecord(inverse)) {
    return
  }
  const { nodeId, oldX, oldY } = inverse
  if (typeof nodeId !== 'string' || typeof oldX !== 'number' || typeof oldY !== 'number') {
    return
  }
  try {
    const node = engine.getNode(nodeId)
    engine.setTransform(nodeId, { ...node.transform, x: oldX, y: oldY })
  } catch {
    // the node no longer exists; there is nothing to restore
  }
}
