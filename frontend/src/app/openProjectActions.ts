import type {
  AssetDefinition,
  ClipDefinition,
  EnginePublic,
  MissingAssetsReport,
  Project,
} from '../engine'
import { reconcileMissingAssets } from '../engine'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'
import { useKeyframeClipboardStore } from '../stores/keyframeClipboardStore'
import { useMissingAssetsStore } from '../stores/missingAssetsStore'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'

export function openProjectInEditor(
  engine: EnginePublic,
  project: Project,
  clips?: readonly ClipDefinition[],
): void {
  engine.openProject(project, clips)
  usePlaybackController.getState().reset()
  useSelectionStore.getState().clear()
  useKeyframeClipboardStore.getState().clear()
  reconcileWhenLibraryReady(engine, project)
}

export function restoreProjectInEditor(engine: EnginePublic): void {
  const project = engine.project
  if (!project) {
    return
  }
  usePlaybackController.getState().reset()
  useSelectionStore.getState().clear()
  useKeyframeClipboardStore.getState().clear()
  reconcileWhenLibraryReady(engine, project)
}

function reconcileWhenLibraryReady(engine: EnginePublic, project: Project): void {
  // Drop any previous project's report so a stale dialog never lingers over
  // the newly opened project; the fresh verdict arrives below.
  useMissingAssetsStore.getState().setReport(null)
  const library = useAssetLibraryStore.getState()
  if (library.unavailable) {
    return
  }
  if (library.loaded) {
    void reconcileAgainstFullLibrary(engine, project)
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
    if (!state.unavailable) {
      void reconcileAgainstFullLibrary(engine, project)
    }
  })
}

async function reconcileAgainstFullLibrary(engine: EnginePublic, project: Project): Promise<void> {
  // The panel-scoped `definitions` only mirror what the Assets panel is
  // browsing (the root listing by default), so reconciling against them
  // reports live library assets as missing. Refresh the global mirror and
  // reconcile against the full picture — the same one script Check/Run
  // resolve `create asset` against.
  await useAssetLibraryStore.getState().loadAllDefinitions()
  if (engine.project?.id !== project.id) {
    return
  }
  const definitions = useAssetLibraryStore.getState().allDefinitions
  useMissingAssetsStore.getState().setReport(reconcileAgainstLibrary(engine, project, definitions))
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
