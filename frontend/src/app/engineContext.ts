import { createContext } from 'react'
import type { Command, CommandResult } from '../engine/commands'
import type { UndoStack } from '../engine/commands'
import type { EnginePublic } from '../engine'

export interface EngineContextValue {
  readonly engine: EnginePublic
  readonly undoStack: UndoStack
  readonly dispatch: <Inverse>(command: Command<Inverse>) => CommandResult<Inverse>
}

export const EngineContext = createContext<EngineContextValue | null>(null)
