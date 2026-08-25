import { act } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { InspectorPanel } from '../components/panels/InspectorPanel'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { useSelectionStore } from '../stores/selectionStore'
import { useNotificationStore } from '../stores/notificationStore'
import { usePlaybackController } from '../stores/playbackStore'
import { noopPersistence } from './contextHarness'

vi.mock('../engine/imageDataLoader', () => ({
  loadImageDataFromAsset: vi.fn(),
  hasTransparentPixels: vi.fn(),
}))

function renderPanel(): { engine: Engine; undoStack: UndoStack; dispatcher: CommandDispatcher } {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: (command) => dispatcher.dispatch(command),
    persistence: noopPersistence,
  }
  render(
    <EngineContext.Provider value={value}>
      <InspectorPanel width={300} />
    </EngineContext.Provider>,
  )
  return { engine, undoStack, dispatcher }
}

function createAssetInstance(engine: Engine): { nodeId: string; slideId: string } {
  engine.createProject({ name: 'Demo' })
  const slide = engine.createSlide('Slide 1')
  const definition = engine.defineAsset('Character')
  engine.embedAsset({
    id: definition.id,
    name: 'Character',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    mimeType: 'image/png',
  })
  const node = engine.createAssetInstance(
    slide.scene.id,
    slide.scene.root.id,
    definition.id,
    'Character',
  )
  return { nodeId: node.id, slideId: slide.id }
}

function select(nodeId: string): void {
  act(() => {
    useSelectionStore.getState().select(nodeId)
  })
}

function selectMany(nodeIds: string[]): void {
  act(() => {
    useSelectionStore.getState().selectMany(nodeIds)
  })
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  useNotificationStore.setState({ notifications: [] })
  usePlaybackController.setState({ currentTimes: {} })
  localStorage.clear()
  vi.clearAllMocks()
})

describe('MeshGenerationSection visibility', () => {
  it('shows for a selected asset instance with embedded PNG', () => {
    const { engine } = renderPanel()
    const { nodeId } = createAssetInstance(engine)
    select(nodeId)

    expect(screen.getByRole('heading', { name: 'Mesh Generation' })).toBeInTheDocument()
  })

  it('hides for a non-asset node', () => {
    const { engine } = renderPanel()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Plain Node')
    select(node.id)

    expect(screen.queryByRole('heading', { name: 'Mesh Generation' })).not.toBeInTheDocument()
  })

  it('hides when multiple nodes are selected', () => {
    const { engine } = renderPanel()
    const { nodeId } = createAssetInstance(engine)
    const slide = engine.project!.slides[0]
    const node2 = engine.createNode(slide.scene.id, slide.scene.root.id, 'Other')
    selectMany([nodeId, node2.id])

    expect(screen.queryByRole('heading', { name: 'Mesh Generation' })).not.toBeInTheDocument()
  })
})

describe('MeshGenerationSection controls', () => {
  it('shows density slider with default value 50%', () => {
    const { engine } = renderPanel()
    const { nodeId } = createAssetInstance(engine)
    select(nodeId)

    const slider = screen.getByRole('slider', { name: 'Density' })
    expect(slider).toHaveValue('50')
  })

  it('shows Generate Mesh button when no mesh exists', () => {
    const { engine } = renderPanel()
    const { nodeId } = createAssetInstance(engine)
    select(nodeId)

    expect(screen.getByRole('button', { name: 'Generate Mesh' })).toBeInTheDocument()
  })

  it('shows Regenerate button when mesh exists', () => {
    const { engine } = renderPanel()
    const { nodeId } = createAssetInstance(engine)
    select(nodeId)

    act(() => {
      engine.setMeshData(nodeId, {
        vertices: [{ x: 0, y: 0 }],
        faces: [{ v0: 0, v1: 0, v2: 0 }],
        uvs: [{ u: 0, v: 0 }],
      })
    })

    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument()
  })
})
