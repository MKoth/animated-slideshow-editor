import { createContext } from 'react'
import type { Command, CommandResult } from '../engine/commands'
import type { UndoStack } from '../engine/commands'
import type { EngineReadOnly } from '../engine'

export interface EngineContextValue {
  readonly engine: EngineReadOnly
  readonly undoStack: UndoStack
  readonly dispatch: <Inverse>(command: Command<Inverse>) => CommandResult<Inverse>
}

export const EngineContext = createContext<EngineContextValue | null>(null)
