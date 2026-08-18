import type { EnginePublic } from '../engine'
import { newId } from '../engine/ids'
import { deserializeWithClips, serialize } from '../engine/lessonSerializer'
import { Project } from '../engine/project'
import { useNotificationStore } from '../stores/notificationStore'
import { ensureReferencedEmbedded } from './assetSnapshot'
import { ensureReferencedMaterialAndShaderSnapshots } from './definitionSnapshot'
import { openProjectInEditor } from './openProjectActions'

export const IMPORT_FAILED_MESSAGE = 'Could not import the lesson.'
export const DOWNLOAD_FAILED_MESSAGE = 'Could not download the lesson copy.'

export async function importLessonFile(engine: EnginePublic, file: File): Promise<boolean> {
  let text: string
  try {
    text = await file.text()
  } catch {
    useNotificationStore.getState().notify(IMPORT_FAILED_MESSAGE)
    return false
  }
  let imported: {
    project: Project
    clips: readonly import('../engine/clipDefinition').ClipDefinition[]
  }
  try {
    imported = deserializeWithClips(text)
  } catch (error) {
    useNotificationStore
      .getState()
      .notify(error instanceof Error ? error.message : IMPORT_FAILED_MESSAGE)
    return false
  }
  try {
    openProjectInEditor(engine, withFreshProjectId(imported.project), imported.clips)
    return true
  } catch {
    useNotificationStore.getState().notify(IMPORT_FAILED_MESSAGE)
    return false
  }
}

function withFreshProjectId(project: Project): Project {
  return new Project(
    {
      id: newId('project'),
      name: project.name,
      description: project.description,
      author: project.author,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
    project.slides,
    project.settings,
    project.embeddedAssets,
    project.embeddedMaterials,
    project.embeddedShaders,
  )
}

export async function downloadLessonCopy(engine: EnginePublic): Promise<boolean> {
  const project = engine.project
  if (!project) {
    return false
  }
  try {
    await ensureReferencedEmbedded(engine)
    ensureReferencedMaterialAndShaderSnapshots(engine)
    const blob = new Blob([serialize(project, engine.clips)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${project.name}.lesson`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    return true
  } catch {
    useNotificationStore.getState().notify(DOWNLOAD_FAILED_MESSAGE)
    return false
  }
}
