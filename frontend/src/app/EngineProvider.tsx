import { useState } from 'react'
import type { ReactNode } from 'react'
import { createCommandSystem } from '../engine/commands'
import { EngineContext } from './engineContext'
import type { EngineContextValue } from './engineContext'

export function EngineProvider({ children }: { children: ReactNode }) {
  const [value] = useState<EngineContextValue>(() => {
    const system = createCommandSystem()
    return {
      engine: system.engine,
      undoStack: system.undoStack,
      dispatch: (command) => system.dispatcher.dispatch(command),
    }
  })
  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>
}
