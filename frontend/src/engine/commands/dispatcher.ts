import { createEngineInternal, toReadOnly } from '../internal'
import type { Engine, EnginePublic } from '../internal'
import { AssetLibrarySync } from '../assetLibrarySync'
import { MaterialLibrarySync } from '../materialLibrarySync'
import { ShaderLibrarySync } from '../shaderLibrarySync'
import type { Command, CommandResult } from './command'
import { UndoStack } from './undoStack'
import { newId } from '../ids'
import { formatParameters } from './format'

export type CommandLogger = (message: string) => void

export type CommandSucceededListener = () => void

export type DispatchCommand = <Inverse>(command: Command<Inverse>) => CommandResult<Inverse>

const defaultLogger: CommandLogger = (message) => {
  console.info(`[command] ${message}`)
}

export class CommandDispatcher {
  readonly #engine: Engine
  readonly #undoStack: UndoStack
  readonly #log: CommandLogger
  #onCommandSucceeded: CommandSucceededListener | null = null

  constructor(engine: Engine, undoStack: UndoStack, log: CommandLogger = defaultLogger) {
    this.#engine = engine
    this.#undoStack = undoStack
    this.#log = log
  }

  setOnCommandSucceeded(listener: CommandSucceededListener): void {
    this.#onCommandSucceeded = listener
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
        timestamp: Date.now(),
        source: 'user',
      })
      this.#log(`${command.type} ${formatParameters(command.parameters)}`)
      this.#onCommandSucceeded?.()
      return { ok: true, inverse }
    } catch (error) {
      return { ok: false, error: toError(error) }
    }
  }

  undo(): boolean {
    try {
      const entry = this.#undoStack.undo(this.#engine)
      if (!entry) return false
      this.#log(`undo ${entry.type}`)
      return true
    } catch (error) {
      console.error('[undo] failed', error)
      return false
    }
  }

  redo(): boolean {
    try {
      const entry = this.#undoStack.redo(this.#engine)
      if (!entry) return false
      this.#log(`redo ${entry.type}`)
      return true
    } catch (error) {
      console.error('[redo] failed', error)
      return false
    }
  }

  get canUndo(): boolean {
    return this.#undoStack.canUndo
  }

  get canRedo(): boolean {
    return this.#undoStack.canRedo
  }
}

export interface CommandSystem {
  readonly engine: EnginePublic
  readonly assetLibrarySync: AssetLibrarySync
  readonly materialLibrarySync: MaterialLibrarySync
  readonly shaderLibrarySync: ShaderLibrarySync
  readonly dispatcher: CommandDispatcher
  readonly undoStack: UndoStack
}

export function createCommandSystem(logger: CommandLogger = defaultLogger): CommandSystem {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  engine.subscribe((event) => {
    if (event.type === 'ProjectLoaded') {
      undoStack.clear()
    }
  })
  return {
    engine: toReadOnly(engine),
    assetLibrarySync: new AssetLibrarySync(engine),
    materialLibrarySync: new MaterialLibrarySync(engine),
    shaderLibrarySync: new ShaderLibrarySync(engine),
    dispatcher: new CommandDispatcher(engine, undoStack, logger),
    undoStack,
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
