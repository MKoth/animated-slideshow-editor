import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { projectsApi } from '../api'
import { createCommandSystem } from '../engine/commands'
import type { PersistenceService } from './persistence'
import { createPersistenceService } from './persistence'
import { ensureReferencedEmbedded, ensureReferencedAudioEmbedded } from './assetSnapshot'
import { ensureReferencedMaterialAndShaderSnapshots } from './definitionSnapshot'
import { EngineContext } from './engineContext'
import { useProjectBrowserStore } from '../stores/projectBrowserStore'
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
      upsert: (blob) => {
        // New (never-listed) projects land in the currently selected folder.
        // Existing projects preserve their folder (UNSET) so moves are explicit.
        try {
          const id = (JSON.parse(blob) as { project?: { id?: unknown } }).project?.id
          if (typeof id === 'string') {
            const state = useProjectBrowserStore.getState()
            if (!state.projects.some((project) => project.id === id)) {
              const selected = state.selectedFolder
              const folder =
                selected === 'all' || selected === 'root'
                  ? null
                  : state.folders.some((entry) => entry.id === selected)
                    ? selected
                    : null
              return projectsApi.upsert(blob, folder)
            }
          }
        } catch {
          // Fall through to a plain upsert when the blob cannot be inspected.
        }
        return projectsApi.upsert(blob)
      },
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
