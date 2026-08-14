import type { EnginePublic, Project } from '../engine'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'

export function openProjectInEditor(engine: EnginePublic, project: Project): void {
  engine.openProject(project)
  usePlaybackController.getState().reset()
  useSelectionStore.getState().clear()
}
