import { projectsApi } from '../api'
import { createBlankProject, deserialize } from '../engine'
import type { EnginePublic } from '../engine'
import { useNotificationStore } from '../stores/notificationStore'
import { usePersistenceStore } from '../stores/persistenceStore'
import { useProjectBrowserStore } from '../stores/projectBrowserStore'
import { openProjectInEditor } from './openProjectActions'

export const OPEN_FAILED_MESSAGE = 'Could not open the project.'
export const DELETE_FAILED_MESSAGE = 'Could not delete the project.'

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
    const project = deserialize(blob)
    openProjectInEditor(engine, project)
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

export function createAndOpenFreshProject(engine: EnginePublic, name: string): boolean {
  try {
    openProjectInEditor(engine, createBlankProject(name))
    return true
  } catch {
    useNotificationStore.getState().notify(OPEN_FAILED_MESSAGE)
    return false
  }
}
