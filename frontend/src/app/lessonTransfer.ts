import type { EnginePublic, LessonJSON } from '../engine'
import { newId } from '../engine/ids'
import { validate } from '../engine/lessonSerializer'
import { useNotificationStore } from '../stores/notificationStore'
import { ensureReferencedEmbedded, ensureReferencedAudioEmbedded } from './assetSnapshot'
import { ensureReferencedMaterialAndShaderSnapshots } from './definitionSnapshot'
import { restoreProjectInEditor } from './openProjectActions'

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
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    useNotificationStore.getState().notify('Invalid lesson JSON: the file is not valid JSON')
    return false
  }
  const errors = validate(parsed)
  if (errors.length > 0) {
    useNotificationStore.getState().notify(errors.join('; '))
    return false
  }
  const json = parsed as LessonJSON
  try {
    const freshProjectJson = withFreshProjectId(json)
    engine.restoreFromJSON(freshProjectJson)
    restoreProjectInEditor(engine)
    return true
  } catch {
    useNotificationStore.getState().notify(IMPORT_FAILED_MESSAGE)
    return false
  }
}

function withFreshProjectId(json: LessonJSON): LessonJSON {
  return {
    ...json,
    project: {
      ...json.project,
      id: newId('project'),
    },
  }
}

export async function downloadLessonCopy(engine: EnginePublic): Promise<boolean> {
  const project = engine.project
  if (!project) {
    return false
  }
  try {
    await ensureReferencedEmbedded(engine)
    await ensureReferencedAudioEmbedded(engine)
    ensureReferencedMaterialAndShaderSnapshots(engine)
    const blob = new Blob([JSON.stringify(engine.toJSON())], { type: 'application/json' })
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
