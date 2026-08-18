import { ApiError } from '../api/apiClient'
import type { EnginePublic } from '../engine'
import { serialize } from '../engine/lessonSerializer'
import { useBackendStore } from '../stores/backendStore'
import { usePersistenceStore } from '../stores/persistenceStore'
import { useNotificationStore } from '../stores/notificationStore'
import { recordLastSaved, writeShadow } from './recoveryShadow'

export const AUTOSAVE_INTERVAL_MS = 30000

export const SAVE_FAILED_MESSAGE = 'Save failed.'
export const SAVE_BACKEND_DOWN_MESSAGE = 'Save failed — backend unavailable.'

export interface PersistenceDeps {
  readonly engine: EnginePublic
  readonly upsert: (blob: string) => Promise<unknown>
  readonly notify?: (message: string) => void
  readonly ensureEmbedded?: () => Promise<void>
}

export interface PersistenceService {
  save(): void
  onCommandSucceeded(): void
  dispose(): void
}

export function createPersistenceService(deps: PersistenceDeps): PersistenceService {
  let intervalId: ReturnType<typeof setInterval> | null = null
  let scheduledId: ReturnType<typeof setTimeout> | null = null
  let saveInFlight = false
  let saveAgain = false
  let projectGeneration = 0

  const notify =
    deps.notify ?? ((message: string) => useNotificationStore.getState().notify(message))

  const writeRecoveryShadow = (): void => {
    const project = deps.engine.project
    if (!project) {
      return
    }
    void writeShadow(serialize(project, deps.engine.clips)).catch(() => undefined)
  }

  const performSave = async (): Promise<void> => {
    if (saveInFlight) {
      saveAgain = true
      return
    }
    const project = deps.engine.project
    if (!project) {
      return
    }
    saveInFlight = true
    const generation = projectGeneration
    try {
      await deps.ensureEmbedded?.()
      const blob = serialize(project, deps.engine.clips)
      await deps.upsert(blob)
      useBackendStore.getState().markAvailable()
      void recordLastSaved(blob).catch(() => undefined)
      if (generation === projectGeneration) {
        usePersistenceStore.getState().markSaved()
      }
    } catch (error) {
      if (error instanceof ApiError) {
        notify(SAVE_FAILED_MESSAGE)
      } else {
        notify(SAVE_BACKEND_DOWN_MESSAGE)
        useBackendStore.getState().markUnavailable()
      }
    } finally {
      saveInFlight = false
      if (saveAgain) {
        saveAgain = false
        void performSave()
      }
    }
  }

  const autosave = (): void => {
    if (useBackendStore.getState().status !== 'available') {
      return
    }
    if (!usePersistenceStore.getState().dirty) {
      return
    }
    void performSave()
  }

  const requestAutosave = (): void => {
    if (useBackendStore.getState().status !== 'available') {
      return
    }
    if (scheduledId !== null) {
      return
    }
    scheduledId = setTimeout(() => {
      scheduledId = null
      autosave()
    }, 0)
  }

  const onProjectLoaded = (): void => {
    projectGeneration += 1
    usePersistenceStore.getState().markSaved()
    if (scheduledId !== null) {
      clearTimeout(scheduledId)
      scheduledId = null
    }
  }

  const ensureTimer = (): void => {
    if (intervalId === null) {
      intervalId = setInterval(() => {
        writeRecoveryShadow()
        autosave()
      }, AUTOSAVE_INTERVAL_MS)
    }
  }

  const handleBeforeUnload = (): void => {
    writeRecoveryShadow()
  }

  const unsubscribe = deps.engine.subscribe((event) => {
    if (event.type === 'ProjectLoaded') {
      onProjectLoaded()
    }
  })

  window.addEventListener('beforeunload', handleBeforeUnload)

  return {
    save: () => {
      void performSave()
    },
    onCommandSucceeded: () => {
      ensureTimer()
      usePersistenceStore.getState().markDirty()
      writeRecoveryShadow()
      requestAutosave()
    },
    dispose: () => {
      unsubscribe()
      window.removeEventListener('beforeunload', handleBeforeUnload)
      if (intervalId !== null) {
        clearInterval(intervalId)
        intervalId = null
      }
      if (scheduledId !== null) {
        clearTimeout(scheduledId)
        scheduledId = null
      }
    },
  }
}
