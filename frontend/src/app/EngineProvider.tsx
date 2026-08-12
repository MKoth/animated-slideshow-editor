import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createCommandSystem } from '../engine/commands'
import { EngineContext } from './engineContext'
import type { EngineContextValue } from './engineContext'
import { registerLibrarySync } from './librarySync'

export function EngineProvider({ children }: { children: ReactNode }) {
  const [system] = useState(() => createCommandSystem())
  useEffect(() => registerLibrarySync(system.assetLibrarySync), [system])
  const [value] = useState<EngineContextValue>(() => ({
    engine: system.engine,
    undoStack: system.undoStack,
    dispatch: (command) => system.dispatcher.dispatch(command),
  }))
  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>
}
