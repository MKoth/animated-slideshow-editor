import type { EnginePublic, MissingAssetsReport, Project } from '../engine'
import { reconcileMissingAssets } from '../engine'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'
import { useMissingAssetsStore } from '../stores/missingAssetsStore'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'

export function openProjectInEditor(engine: EnginePublic, project: Project): void {
  engine.openProject(project)
  usePlaybackController.getState().reset()
  useSelectionStore.getState().clear()
  const report = reconcileAgainstLibrary(project)
  useMissingAssetsStore.getState().setReport(report)
}

function reconcileAgainstLibrary(project: Project): MissingAssetsReport {
  const definitions = useAssetLibraryStore.getState().definitions
  const availableDefinitionIds = new Set(definitions.map((definition) => definition.id))
  return reconcileMissingAssets(project, availableDefinitionIds)
}
