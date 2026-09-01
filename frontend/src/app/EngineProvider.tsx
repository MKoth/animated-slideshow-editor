import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { projectsApi } from '../api'
import { createCommandSystem } from '../engine/commands'
import type { PersistenceService } from './persistence'
import { createPersistenceService } from './persistence'
import { ensureReferencedEmbedded, ensureReferencedAudioEmbedded } from './assetSnapshot'
import { ensureReferencedMaterialAndShaderSnapshots } from './definitionSnapshot'
import { EngineContext } from './engineContext'
import type { EngineContextValue } from './engineContext'
import { registerActiveSlideSync } from './activeSlideSync'
import {
  registerLibrarySync,
  registerMaterialLibrarySync,
  registerMaterialUniformPropagation,
  registerShaderLibrarySync,
} from './librarySync'

export function EngineProvider({ children }: { children: ReactNode }) {
  const [system] = useState(() => createCommandSystem())
  const persistenceRef = useRef<PersistenceService | null>(null)
  const [value] = useState<EngineContextValue>(() => ({
    engine: system.engine,
    undoStack: system.undoStack,
    dispatcher: system.dispatcher,
    dispatch: (command) => system.dispatcher.dispatch(command),
    persistence: {
      save: () => persistenceRef.current?.save(),
      onCommandSucceeded: () => persistenceRef.current?.onCommandSucceeded(),
      dispose: () => persistenceRef.current?.dispose(),
    },
  }))
  useEffect(() => {
    const persistence = createPersistenceService({
      engine: system.engine,
      upsert: (blob) => projectsApi.upsert(blob),
      ensureEmbedded: async () => {
        await ensureReferencedEmbedded(system.engine)
        await ensureReferencedAudioEmbedded(system.engine)
        ensureReferencedMaterialAndShaderSnapshots(system.engine)
      },
    })
    persistenceRef.current = persistence
    system.dispatcher.setOnCommandSucceeded(() => persistence.onCommandSucceeded())
    const disposeLibrarySync = registerLibrarySync(system.assetLibrarySync)
    const disposeMaterialLibrarySync = registerMaterialLibrarySync(system.materialLibrarySync)
    const disposeShaderLibrarySync = registerShaderLibrarySync(system.shaderLibrarySync)
    const disposeMaterialUniformPropagation = registerMaterialUniformPropagation()
    const disposeActiveSlideSync = registerActiveSlideSync(system.engine)
    return () => {
      disposeActiveSlideSync()
      disposeMaterialUniformPropagation()
      disposeShaderLibrarySync()
      disposeMaterialLibrarySync()
      disposeLibrarySync()
      persistence.dispose()
      if (persistenceRef.current === persistence) {
        persistenceRef.current = null
      }
    }
  }, [system])
  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>
}
