import type { AssetDefinition, EnginePublic, MissingAssetsReport, Project } from '../engine'
import { reconcileMissingAssets } from '../engine'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'
import { useMissingAssetsStore } from '../stores/missingAssetsStore'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'

export function openProjectInEditor(engine: EnginePublic, project: Project): void {
  engine.openProject(project)
  usePlaybackController.getState().reset()
  useSelectionStore.getState().clear()
  reconcileWhenLibraryReady(engine, project)
}

function reconcileWhenLibraryReady(engine: EnginePublic, project: Project): void {
  const library = useAssetLibraryStore.getState()
  if (library.unavailable) {
    useMissingAssetsStore.getState().setReport(null)
    return
  }
  if (library.loaded) {
    useMissingAssetsStore
      .getState()
      .setReport(reconcileAgainstLibrary(engine, project, library.definitions))
    return
  }
  let settled = false
  const unsubscribe = useAssetLibraryStore.subscribe((state, prev) => {
    if (settled || prev.loaded || prev.unavailable) {
      return
    }
    if (!state.loaded && !state.unavailable) {
      return
    }
    settled = true
    unsubscribe()
    if (state.unavailable) {
      useMissingAssetsStore.getState().setReport(null)
    } else {
      useMissingAssetsStore
        .getState()
        .setReport(reconcileAgainstLibrary(engine, project, state.definitions))
    }
  })
}

function reconcileAgainstLibrary(
  engine: EnginePublic,
  project: Project,
  definitions: readonly AssetDefinition[],
): MissingAssetsReport {
  const availableDefinitionIds = new Set(
    engine.embeddedAssets.map((asset) => asset.id).concat(definitions.map((d) => d.id)),
  )
  return reconcileMissingAssets(project, availableDefinitionIds)
}
