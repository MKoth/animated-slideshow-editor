import { createContext } from 'react'
import type { Command, CommandResult } from '../engine/commands'
import type { UndoStack } from '../engine/commands'
import type { EnginePublic } from '../engine'
import type { PersistenceService } from './persistence'

export interface EngineContextValue {
  readonly engine: EnginePublic
  readonly undoStack: UndoStack
  readonly dispatch: <Inverse>(command: Command<Inverse>) => CommandResult<Inverse>
  readonly persistence: PersistenceService
}

export const EngineContext = createContext<EngineContextValue | null>(null)
