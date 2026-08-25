import { act } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { InspectorPanel } from '../components/panels/InspectorPanel'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { useMeshPreviewStore } from '../stores/meshPreviewStore'
import { useSelectionStore } from '../stores/selectionStore'
import { useNotificationStore } from '../stores/notificationStore'
import { usePlaybackController } from '../stores/playbackStore'
import { noopPersistence } from './contextHarness'

vi.mock('../engine/imageDataLoader', () => ({
  loadImageDataFromAsset: vi
    .fn()
    .mockResolvedValue({ data: new Uint8ClampedArray(0), width: 0, height: 0, colorSpace: 'srgb' }),
  hasTransparentPixels: vi.fn().mockReturnValue(false),
}))

const mockLoadImageData = vi.mocked(
  (await import('../engine/imageDataLoader')).loadImageDataFromAsset,
)
const mockHasTransparentPixels = vi.mocked(
  (await import('../engine/imageDataLoader')).hasTransparentPixels,
)

function createTransparentImageData(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 255
    data[i * 4 + 1] = 0
    data[i * 4 + 2] = 0
    data[i * 4 + 3] = 128
  }
  return { data, width, height, colorSpace: 'srgb' }
}

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
  useMeshPreviewStore.setState({ previewMesh: null, nodeId: null })
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

describe('MeshGenerationSection density preview', () => {
  it('sets preview mesh when density changes and mesh exists', async () => {
    const imageData = createTransparentImageData(4, 4)
    mockLoadImageData.mockResolvedValue(imageData)
    mockHasTransparentPixels.mockReturnValue(true)

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

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    const slider = screen.getByRole('slider', { name: 'Density' })
    act(() => {
      fireEvent.change(slider, { target: { value: '75' } })
    })

    const state = useMeshPreviewStore.getState()
    expect(state.previewMesh).not.toBeNull()
    expect(state.nodeId).toBe(nodeId)
  })

  it('does not set preview mesh when no mesh exists', async () => {
    const imageData = createTransparentImageData(4, 4)
    mockLoadImageData.mockResolvedValue(imageData)
    mockHasTransparentPixels.mockReturnValue(true)

    const { engine } = renderPanel()
    const { nodeId } = createAssetInstance(engine)
    select(nodeId)

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    const slider = screen.getByRole('slider', { name: 'Density' })
    act(() => {
      fireEvent.change(slider, { target: { value: '75' } })
    })

    const state = useMeshPreviewStore.getState()
    expect(state.previewMesh).toBeNull()
    expect(state.nodeId).toBeNull()
  })

  it('clears preview mesh on pointer up', async () => {
    const imageData = createTransparentImageData(4, 4)
    mockLoadImageData.mockResolvedValue(imageData)
    mockHasTransparentPixels.mockReturnValue(true)

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

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    const slider = screen.getByRole('slider', { name: 'Density' })
    act(() => {
      fireEvent.change(slider, { target: { value: '75' } })
    })
    expect(useMeshPreviewStore.getState().previewMesh).not.toBeNull()

    act(() => {
      fireEvent.pointerUp(slider)
    })
    expect(useMeshPreviewStore.getState().previewMesh).toBeNull()
  })

  it('clears preview mesh on component unmount', async () => {
    const imageData = createTransparentImageData(4, 4)
    mockLoadImageData.mockResolvedValue(imageData)
    mockHasTransparentPixels.mockReturnValue(true)

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

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    const slider = screen.getByRole('slider', { name: 'Density' })
    act(() => {
      fireEvent.change(slider, { target: { value: '75' } })
    })
    expect(useMeshPreviewStore.getState().previewMesh).not.toBeNull()

    act(() => {
      useSelectionStore.getState().select(null as unknown as string)
    })

    expect(useMeshPreviewStore.getState().previewMesh).toBeNull()
  })

  it('does not mutate committed mesh during preview', async () => {
    const imageData = createTransparentImageData(4, 4)
    mockLoadImageData.mockResolvedValue(imageData)
    mockHasTransparentPixels.mockReturnValue(true)

    const { engine } = renderPanel()
    const { nodeId } = createAssetInstance(engine)
    select(nodeId)

    const originalMesh = {
      vertices: [{ x: 0, y: 0 }],
      faces: [{ v0: 0, v1: 0, v2: 0 }],
      uvs: [{ u: 0, v: 0 }],
    }
    act(() => {
      engine.setMeshData(nodeId, originalMesh)
    })

    const nodeBefore = engine.getNode(nodeId)
    const meshBefore = nodeBefore.components.mesh?.mesh

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    const slider = screen.getByRole('slider', { name: 'Density' })
    act(() => {
      fireEvent.change(slider, { target: { value: '75' } })
    })

    const nodeAfter = engine.getNode(nodeId)
    const meshAfter = nodeAfter.components.mesh?.mesh
    expect(meshAfter).toBe(meshBefore)
  })

  it('preview mesh is not added to undo history', async () => {
    const imageData = createTransparentImageData(4, 4)
    mockLoadImageData.mockResolvedValue(imageData)
    mockHasTransparentPixels.mockReturnValue(true)

    const { engine, undoStack } = renderPanel()
    const { nodeId } = createAssetInstance(engine)
    select(nodeId)

    act(() => {
      engine.setMeshData(nodeId, {
        vertices: [{ x: 0, y: 0 }],
        faces: [{ v0: 0, v1: 0, v2: 0 }],
        uvs: [{ u: 0, v: 0 }],
      })
    })

    const undoCountBefore = undoStack.entries.length

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    const slider = screen.getByRole('slider', { name: 'Density' })
    act(() => {
      fireEvent.change(slider, { target: { value: '75' } })
    })

    expect(undoStack.entries.length).toBe(undoCountBefore)
  })

  it('clears preview mesh when error occurs during preview generation', async () => {
    mockLoadImageData.mockResolvedValue({
      data: new Uint8ClampedArray(0),
      width: 0,
      height: 0,
      colorSpace: 'srgb',
    })
    mockHasTransparentPixels.mockReturnValue(false)

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

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    mockHasTransparentPixels.mockReturnValue(true)
    mockLoadImageData.mockRejectedValue(new Error('Generation failed'))

    const slider = screen.getByRole('slider', { name: 'Density' })
    act(() => {
      fireEvent.change(slider, { target: { value: '75' } })
    })

    expect(useMeshPreviewStore.getState().previewMesh).toBeNull()
  })
})
