import { projectsApi } from '../api'
import { createBlankProject } from '../engine'
import type { EnginePublic, LessonJSON } from '../engine'
import { useNotificationStore } from '../stores/notificationStore'
import { usePersistenceStore } from '../stores/persistenceStore'
import { useProjectBrowserStore } from '../stores/projectBrowserStore'
import { openProjectInEditor, restoreProjectInEditor } from './openProjectActions'
import { duplicateLessonJSON } from './projectDuplication'

export const OPEN_FAILED_MESSAGE = 'Could not open the project.'
export const DELETE_FAILED_MESSAGE = 'Could not delete the project.'
export const DUPLICATE_FAILED_MESSAGE = 'Could not duplicate the project.'
export const RENAME_FAILED_MESSAGE = 'Could not rename the project.'

export function openProjectBrowser(): void {
  useProjectBrowserStore.getState().show()
}

export function requestNewProject(): void {
  const state = useProjectBrowserStore.getState()
  state.show()
  if (usePersistenceStore.getState().dirty) {
    state.setPendingNew(true)
  } else {
    state.showNewProject()
  }
}

export function formatLastModified(iso: string): string {
  const value = iso.replace('T', ' ')
  return value.length >= 16 ? value.slice(0, 16) : value
}

export async function refreshProjects(): Promise<void> {
  useProjectBrowserStore.getState().setLoading(true)
  useProjectBrowserStore.getState().setError(null)
  try {
    const projects = await projectsApi.list()
    useProjectBrowserStore.getState().setProjects(projects)
  } catch {
    useProjectBrowserStore.getState().setProjects([])
    useProjectBrowserStore.getState().setError('Failed to load projects — is the backend running?')
  } finally {
    useProjectBrowserStore.getState().setLoading(false)
  }
}

export async function openLibraryProject(engine: EnginePublic, id: string): Promise<boolean> {
  try {
    const blob = await projectsApi.get(id)
    const json = JSON.parse(blob) as LessonJSON
    engine.restoreFromJSON(json)
    restoreProjectInEditor(engine)
    return true
  } catch {
    useNotificationStore.getState().notify(OPEN_FAILED_MESSAGE)
    return false
  }
}

export async function deleteLibraryProject(id: string): Promise<boolean> {
  try {
    await projectsApi.delete(id)
  } catch {
    useNotificationStore.getState().notify(DELETE_FAILED_MESSAGE)
    return false
  }
  useProjectBrowserStore.getState().removeProject(id)
  return true
}

export async function duplicateLibraryProject(sourceId: string): Promise<boolean> {
  try {
    const blob = await projectsApi.get(sourceId)
    const json = JSON.parse(blob) as LessonJSON
    const existingNames = useProjectBrowserStore.getState().projects.map((p) => p.name)
    const duplicated = duplicateLessonJSON(json, existingNames)
    const blob2 = JSON.stringify(duplicated)
    await projectsApi.upsert(blob2)
    await refreshProjects()
    return true
  } catch {
    useNotificationStore.getState().notify(DUPLICATE_FAILED_MESSAGE)
    return false
  }
}

export function isDuplicateProjectName(name: string, existingNames: readonly string[]): boolean {
  const trimmed = name.trim()
  return existingNames.some((n) => n.trim() === trimmed)
}

export async function renameLibraryProject(
  engine: EnginePublic,
  id: string,
  newName: string,
): Promise<boolean> {
  const trimmed = newName.trim()
  if (trimmed === '') {
    useNotificationStore.getState().notify(RENAME_FAILED_MESSAGE)
    return false
  }
  try {
    // When renaming the currently open project, mutate in-memory first
    // and persist the live blob (preserves dirty unsaved changes).
    if (engine.project?.id === id) {
      try {
        engine.renameProject(trimmed)
      } catch {
        useNotificationStore.getState().notify(RENAME_FAILED_MESSAGE)
        return false
      }
      const blob2 = JSON.stringify(engine.toJSON())
      await projectsApi.upsert(blob2)
      await refreshProjects()
      return true
    }
    const blob = await projectsApi.get(id)
    const json = JSON.parse(blob) as LessonJSON
    if (typeof json.project !== 'object' || json.project === null) {
      throw new Error('Invalid lesson JSON: missing project')
    }
    ;(json.project as { name: string }).name = trimmed
    ;(json.project as { modifiedAt: string }).modifiedAt = new Date().toISOString()
    const blob2 = JSON.stringify(json)
    await projectsApi.upsert(blob2)
    await refreshProjects()
    return true
  } catch {
    useNotificationStore.getState().notify(RENAME_FAILED_MESSAGE)
    return false
  }
}

export function createAndOpenFreshProject(engine: EnginePublic, name: string): boolean {
  try {
    const { project, clips } = createBlankProject(name)
    openProjectInEditor(engine, project, clips)
    return true
  } catch {
    useNotificationStore.getState().notify(OPEN_FAILED_MESSAGE)
    return false
  }
}
