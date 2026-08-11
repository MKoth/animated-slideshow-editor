import { createEngineInternal, toReadOnly } from '../internal'
import type { Engine, EngineReadOnly } from '../internal'
import type { Command, CommandResult } from './command'
import { UndoStack } from './undoStack'
import { newId } from '../ids'
import { formatParameters } from './format'

export type CommandLogger = (message: string) => void

const defaultLogger: CommandLogger = (message) => {
  console.info(`[command] ${message}`)
}

export class CommandDispatcher {
  readonly #engine: Engine
  readonly #undoStack: UndoStack
  readonly #log: CommandLogger

  constructor(engine: Engine, undoStack: UndoStack, log: CommandLogger = defaultLogger) {
    this.#engine = engine
    this.#undoStack = undoStack
    this.#log = log
  }

  dispatch<Inverse>(command: Command<Inverse>): CommandResult<Inverse> {
    try {
      command.validate(this.#engine)
      const inverse = command.execute(this.#engine)
      this.#undoStack.record({
        id: newId('command'),
        type: command.type,
        parameters: command.parameters,
        inverse,
      })
      this.#log(`${command.type} ${formatParameters(command.parameters)}`)
      return { ok: true, inverse }
    } catch (error) {
      return { ok: false, error: toError(error) }
    }
  }
}

export interface CommandSystem {
  readonly engine: EngineReadOnly
  readonly dispatcher: CommandDispatcher
  readonly undoStack: UndoStack
}

export function createCommandSystem(logger: CommandLogger = defaultLogger): CommandSystem {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  return {
    engine: toReadOnly(engine),
    dispatcher: new CommandDispatcher(engine, undoStack, logger),
    undoStack,
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
