import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetDefinition } from '../api'
import { openProjectInEditor } from '../app/openProjectActions'
import type { Engine } from '../engine/internal'
import { createEngine } from '../engine/internal'
import { createEmptyScenarioSection, withScenarioBindings } from '../engine/scenarioSection'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'
import { useMissingAssetsStore } from '../stores/missingAssetsStore'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'

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
  useAssetLibraryStore.setState({
    definitions,
    allDefinitions: definitions,
    loaded: true,
    unavailable: false,
  })
}

function flushReconcile(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function setupEditor(): Engine {
  const engine = createEngine()
  engine.createProject({ name: 'Current' })
  engine.createSlide('Old A')
  return engine
}

describe('scenario bindings surface the Missing Assets Report flow', () => {
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
    vi.spyOn(useAssetLibraryStore.getState(), 'loadAllDefinitions').mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    usePlaybackController.getState().reset()
    useMissingAssetsStore.setState({ report: null, dialogVisible: false })
  })

  it('reports unresolvable scenario bindings alongside scene refs', async () => {
    const engine = setupEditor()
    const project = engine.project!
    project.setScenario(
      withScenarioBindings(createEmptyScenarioSection('## Step 1 — One\n\nHi.\n'), {
        'young-doctor-smiling': 'def-missing-scenario',
      }),
    )
    setLibraryDefinitions([])

    openProjectInEditor(engine, project)
    await flushReconcile()

    const state = useMissingAssetsStore.getState()
    expect(state.report?.names).toContain('Scenario “young-doctor-smiling”')
    expect(state.report?.missing.map((m) => m.assetDefinitionId)).toContain('def-missing-scenario')
    expect(state.dialogVisible).toBe(true)
  })

  it('stays quiet when scenario bindings resolve via embedded or library', async () => {
    const engine = setupEditor()
    const project = engine.project!
    project.embedAsset({ id: 'def-doctor', name: 'Doctor', data: 'QUJD', mimeType: 'image/png' })
    project.setScenario(
      withScenarioBindings(createEmptyScenarioSection('md'), {
        'young-doctor-smiling': 'def-doctor',
      }),
    )
    setLibraryDefinitions([])

    openProjectInEditor(engine, project)
    await flushReconcile()

    expect(useMissingAssetsStore.getState().report).toBeNull()
    expect(useMissingAssetsStore.getState().dialogVisible).toBe(false)
  })
})
