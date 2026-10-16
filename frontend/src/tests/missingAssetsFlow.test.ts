import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetDefinition } from '../api'
import { openProjectInEditor } from '../app/openProjectActions'
import type { Engine } from '../engine/internal'
import { createEngine } from '../engine/internal'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'
import { useMissingAssetsStore } from '../stores/missingAssetsStore'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'
import { makeProjectWithAssets } from './engine/helpers'

function setLibraryDefinitions(ids: readonly string[]): void {
  const definitions = ids.map((id): AssetDefinition => ({
    id,
    name: `${id}.png`,
    description: '',
    category: 'Uncategorized',
    tags: [],
    ai_description: '',
    original_filename: `${id}.png`,
    import_date: '2026-01-01T00:00:00Z',
    width: 1,
    height: 1,
    file_size: 1,
    aspect_ratio: 1,
    default_scale: 1,
    default_rotation: 0,
    pivot: { x: 0.5, y: 0.5 },
    anchors: [],
    original_url: '',
    thumbnail_url: '',
  }))
  // Reconciliation reads the global mirror, not the folder-scoped listing.
  useAssetLibraryStore.setState({
    definitions,
    allDefinitions: definitions,
    loaded: true,
    unavailable: false,
  })
}

// Reconciliation refreshes the global mirror over the network, so flush the
// async verdict before asserting on the report.
function flushReconcile(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function setupEditor(): Engine {
  const engine = createEngine()
  engine.createProject({ name: 'Current' })
  engine.createSlide('Old A')
  return engine
}

describe('openProjectInEditor missing-assets reconciliation', () => {
  beforeEach(() => {
    usePlaybackController.setState({
      currentTimes: {},
      status: 'stopped',
      playbackSpeed: 1,
      loopEnabled: false,
    })
    useSelectionStore.setState({ selectedIds: [], selectedKeyframeIds: [] })
    useMissingAssetsStore.setState({ report: null, dialogVisible: false })
    useAssetLibraryStore.setState({
      definitions: [],
      allDefinitions: [],
      loaded: false,
      unavailable: false,
    })
    // Keep reconciliation offline: the verdict must come from the stubbed
    // mirror, never from a real backend fetch.
    vi.spyOn(useAssetLibraryStore.getState(), 'loadAllDefinitions').mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    usePlaybackController.getState().reset()
    useMissingAssetsStore.setState({ report: null, dialogVisible: false })
  })

  it('reports nothing and shows no dialog when every definition is in the library', async () => {
    const engine = setupEditor()
    const { project } = makeProjectWithAssets('New', [{ name: 'Boy', definitionId: 'def-boy' }])
    setLibraryDefinitions(['def-boy'])

    openProjectInEditor(engine, project)
    await flushReconcile()

    expect(useMissingAssetsStore.getState().report).toBeNull()
    expect(useMissingAssetsStore.getState().dialogVisible).toBe(false)
  })

  it('reports the missing asset names against the live library and shows the dialog', async () => {
    const engine = setupEditor()
    const { project, placed } = makeProjectWithAssets('New', [
      { name: 'Boy', definitionId: 'def-boy' },
      { name: 'Cat', definitionId: 'def-cat' },
    ])
    setLibraryDefinitions(['def-boy'])

    openProjectInEditor(engine, project)
    await flushReconcile()

    const state = useMissingAssetsStore.getState()
    expect(state.report?.names).toEqual(['Cat'])
    expect(state.report?.affectedNodeIds).toEqual([placed[1].nodeId])
    expect(state.report?.missing).toEqual([
      { assetDefinitionId: 'def-cat', nodeIds: [placed[1].nodeId] },
    ])
    expect(state.dialogVisible).toBe(true)
  })

  it('keeps the report as the marking source after the dialog is dismissed', async () => {
    setLibraryDefinitions([])
    const engine = setupEditor()
    const { project } = makeProjectWithAssets('New', [{ name: 'Boy', definitionId: 'def-boy' }])

    openProjectInEditor(engine, project)
    await flushReconcile()

    useMissingAssetsStore.getState().dismissDialog()

    expect(useMissingAssetsStore.getState().dialogVisible).toBe(false)
    expect(useMissingAssetsStore.getState().report?.names).toEqual(['Boy'])
  })

  it('reconciles every open through the flow, replacing the previous report', async () => {
    const engine = setupEditor()
    const first = makeProjectWithAssets('First', [{ name: 'Boy', definitionId: 'def-boy' }])
    const second = makeProjectWithAssets('Second', [
      { name: 'Cat', definitionId: 'def-cat' },
      { name: 'Dog', definitionId: 'def-dog' },
    ])
    setLibraryDefinitions(['def-cat'])

    openProjectInEditor(engine, first.project)
    await flushReconcile()
    expect(useMissingAssetsStore.getState().report?.names).toEqual(['Boy'])

    openProjectInEditor(engine, second.project)
    await flushReconcile()

    const state = useMissingAssetsStore.getState()
    expect(state.report?.names).toEqual(['Dog'])
    expect(state.dialogVisible).toBe(true)
  })

  it('shows no report while the library has not loaded, instead of a false "all missing" report', () => {
    const engine = setupEditor()
    const { project } = makeProjectWithAssets('New', [{ name: 'Boy', definitionId: 'def-boy' }])

    openProjectInEditor(engine, project)

    expect(useMissingAssetsStore.getState().report).toBeNull()
    expect(useMissingAssetsStore.getState().dialogVisible).toBe(false)
  })

  it('reports the missing assets once the library finishes loading after the open', async () => {
    const engine = setupEditor()
    const { project } = makeProjectWithAssets('New', [{ name: 'Boy', definitionId: 'def-boy' }])

    openProjectInEditor(engine, project)
    expect(useMissingAssetsStore.getState().report).toBeNull()

    setLibraryDefinitions([])
    await flushReconcile()

    const state = useMissingAssetsStore.getState()
    expect(state.report?.names).toEqual(['Boy'])
    expect(state.dialogVisible).toBe(true)
  })

  it('reports nothing for references satisfied by the embedded snapshot when the library asset is gone', async () => {
    const engine = setupEditor()
    const { project } = makeProjectWithAssets('New', [{ name: 'Boy', definitionId: 'def-boy' }])
    project.embedAsset({
      id: 'def-boy',
      name: 'Boy',
      data: 'QUJD',
      mimeType: 'image/png',
    })
    setLibraryDefinitions([])

    openProjectInEditor(engine, project)
    await flushReconcile()

    expect(useMissingAssetsStore.getState().report).toBeNull()
    expect(useMissingAssetsStore.getState().dialogVisible).toBe(false)
  })

  it('reports only references missing from both the embedded snapshot and the live library', async () => {
    const engine = setupEditor()
    const { project, placed } = makeProjectWithAssets('New', [
      { name: 'Boy', definitionId: 'def-boy' },
      { name: 'Cat', definitionId: 'def-cat' },
      { name: 'Dog', definitionId: 'def-dog' },
    ])
    project.embedAsset({
      id: 'def-boy',
      name: 'Boy',
      data: 'QUJD',
      mimeType: 'image/png',
    })
    setLibraryDefinitions(['def-cat'])

    openProjectInEditor(engine, project)
    await flushReconcile()

    const state = useMissingAssetsStore.getState()
    expect(state.report?.names).toEqual(['Dog'])
    expect(state.report?.missing).toEqual([
      { assetDefinitionId: 'def-dog', nodeIds: [placed[2].nodeId] },
    ])
    expect(state.dialogVisible).toBe(true)
  })

  it('clears the report instead of reporting when the loaded library holds every definition', async () => {
    const engine = setupEditor()
    const { project } = makeProjectWithAssets('New', [{ name: 'Boy', definitionId: 'def-boy' }])

    openProjectInEditor(engine, project)
    expect(useMissingAssetsStore.getState().report).toBeNull()

    setLibraryDefinitions(['def-boy'])
    await flushReconcile()

    expect(useMissingAssetsStore.getState().report).toBeNull()
    expect(useMissingAssetsStore.getState().dialogVisible).toBe(false)
  })

  it('shows no report when the library settles as unavailable (degraded mode)', () => {
    useAssetLibraryStore.setState({ definitions: [], loaded: false, unavailable: true })
    const engine = setupEditor()
    const { project } = makeProjectWithAssets('New', [{ name: 'Boy', definitionId: 'def-boy' }])

    openProjectInEditor(engine, project)

    expect(useMissingAssetsStore.getState().report).toBeNull()
    expect(useMissingAssetsStore.getState().dialogVisible).toBe(false)
  })
})
