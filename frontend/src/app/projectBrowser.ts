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
export const FOLDER_FAILED_MESSAGE = 'Could not save the folder.'
export const FOLDER_DELETE_FAILED_MESSAGE = 'Could not delete the folder.'
export const MOVE_FAILED_MESSAGE = 'Could not move the project.'
export const BACKUP_FAILED_MESSAGE = 'Could not build the backup.'

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
    let folders: Awaited<ReturnType<typeof projectsApi.listFolders>> = []
    try {
      folders = await projectsApi.listFolders()
    } catch {
      folders = []
    }
    const state = useProjectBrowserStore.getState()
    state.setProjects(projects)
    state.setFolders(folders)
    // Drop a stale selection if its folder was deleted elsewhere.
    const selected = state.selectedFolder
    if (
      selected !== 'all' &&
      selected !== 'root' &&
      !folders.some((folder) => folder.id === selected)
    ) {
      state.setSelectedFolder('all')
    }
  } catch {
    useProjectBrowserStore.getState().setProjects([])
    useProjectBrowserStore.getState().setFolders([])
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
    const state = useProjectBrowserStore.getState()
    const existingNames = state.projects.map((p) => p.name)
    const duplicated = duplicateLessonJSON(json, existingNames)
    const blob2 = JSON.stringify(duplicated)
    // Duplicates land in the currently selected folder (root when All/Root is active).
    const selected = state.selectedFolder
    const targetFolder =
      selected === 'all' || selected === 'root'
        ? null
        : state.folders.some((folder) => folder.id === selected)
          ? selected
          : null
    const source = state.projects.find((p) => p.id === sourceId)
    await projectsApi.upsert(blob2, targetFolder ?? source?.folder_id ?? null)
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

export function getSelectedFolderIdForNew(): string | null {
  const state = useProjectBrowserStore.getState()
  const selected = state.selectedFolder
  if (selected === 'all' || selected === 'root') return null
  return state.folders.some((folder) => folder.id === selected) ? selected : null
}

export function isDuplicateFolderName(name: string, existingNames: readonly string[]): boolean {
  const trimmed = name.trim().toLowerCase()
  return existingNames.some((n) => n.trim().toLowerCase() === trimmed)
}

export async function createLibraryFolder(name: string): Promise<boolean> {
  const trimmed = name.trim()
  if (trimmed === '') {
    useNotificationStore.getState().notify(FOLDER_FAILED_MESSAGE)
    return false
  }
  const existing = useProjectBrowserStore.getState().folders.map((f) => f.name)
  if (isDuplicateFolderName(trimmed, existing)) {
    useNotificationStore.getState().notify('A folder with this name already exists')
    return false
  }
  try {
    const folder = await projectsApi.createFolder(trimmed)
    const state = useProjectBrowserStore.getState()
    state.setFolders([...state.folders, folder])
    state.setSelectedFolder(folder.id)
    return true
  } catch {
    useNotificationStore.getState().notify(FOLDER_FAILED_MESSAGE)
    return false
  }
}

export async function renameLibraryFolder(id: string, name: string): Promise<boolean> {
  const trimmed = name.trim()
  if (trimmed === '') {
    useNotificationStore.getState().notify(FOLDER_FAILED_MESSAGE)
    return false
  }
  const state = useProjectBrowserStore.getState()
  const existing = state.folders.filter((f) => f.id !== id).map((f) => f.name)
  if (isDuplicateFolderName(trimmed, existing)) {
    useNotificationStore.getState().notify('A folder with this name already exists')
    return false
  }
  try {
    const folder = await projectsApi.renameFolder(id, trimmed)
    state.setFolders(state.folders.map((f) => (f.id === id ? folder : f)))
    return true
  } catch {
    useNotificationStore.getState().notify(FOLDER_FAILED_MESSAGE)
    return false
  }
}

export async function deleteLibraryFolder(id: string, deleteProjects: boolean): Promise<boolean> {
  try {
    await projectsApi.deleteFolder(id, deleteProjects)
    await refreshProjects()
    return true
  } catch {
    useNotificationStore.getState().notify(FOLDER_DELETE_FAILED_MESSAGE)
    return false
  }
}

export async function moveLibraryProject(id: string, folderId: string | null): Promise<boolean> {
  try {
    await projectsApi.move(id, folderId)
  } catch {
    useNotificationStore.getState().notify(MOVE_FAILED_MESSAGE)
    return false
  }
  useProjectBrowserStore.getState().updateProjectFolder(id, folderId)
  return true
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '-').trim()
  return cleaned === '' ? 'Untitled lesson' : cleaned
}

export async function downloadBackupZip(): Promise<boolean> {
  const state = useProjectBrowserStore.getState()
  try {
    const { zipSync, strToU8 } = await import('fflate')
    const folderById = new Map(state.folders.map((folder) => [folder.id, folder.name]))
    const usedNames = new Set<string>()
    const files: Record<string, Uint8Array> = {}
    for (const project of state.projects) {
      const blob = await projectsApi.get(project.id)
      const folderName =
        project.folder_id != null ? (folderById.get(project.folder_id) ?? 'Unknown folder') : null
      const base = `${sanitizeFileName(project.name)}.lesson`
      const key = folderName != null ? `${sanitizeFileName(folderName)}/${base}` : base
      let uniqueKey = key
      let counter = 2
      while (usedNames.has(uniqueKey)) {
        const suffixed = `${sanitizeFileName(project.name)} (${counter}).lesson`
        uniqueKey = folderName != null ? `${sanitizeFileName(folderName)}/${suffixed}` : suffixed
        counter += 1
      }
      usedNames.add(uniqueKey)
      files[uniqueKey] = strToU8(blob)
    }
    const zipped = zipSync(files)
    const blob = new Blob([zipped as unknown as BlobPart], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'projects-backup.zip'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    return true
  } catch {
    useNotificationStore.getState().notify(BACKUP_FAILED_MESSAGE)
    return false
  }
}
