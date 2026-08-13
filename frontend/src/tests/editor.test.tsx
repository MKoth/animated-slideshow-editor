import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import App from '../app/App'
import type { AssetDefinition } from '../api'
import { ASSET_DEFINITION_MIME } from '../pixi/renderer/dropPlacement'
import { useNotificationStore } from '../stores/notificationStore'
import { usePlaybackController } from '../stores/playbackStore'
import { useClipboardStore } from '../stores/clipboardStore'
import { useSelectionStore } from '../stores/selectionStore'
import {
  DEFAULT_INSPECTOR_WIDTH,
  DEFAULT_LEFT_SIDEBAR_WIDTH,
  DEFAULT_TIMELINE_HEIGHT,
} from '../stores/uiPrefs'
import { useTimelineViewStore } from '../stores/timelineViewStore'
import { useUiStore } from '../stores/uiStore'
import {
  FakeTexture,
  pixiRegistry,
  resetTextureRegistries,
  textureLoads,
} from './renderer/pixiFake'
import { findByLabel, worldOf } from './renderer/testUtils'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./renderer/pixiFake')
  return createPixiFake()
})

const BOY: AssetDefinition = {
  id: 'a1',
  name: 'Boy',
  description: '',
  category: 'Character',
  tags: [],
  ai_description: '',
  original_filename: 'boy.png',
  import_date: '2026-08-12T10:00:00',
  width: 100,
  height: 80,
  file_size: 1024,
  aspect_ratio: 1.25,
  default_scale: 1,
  default_rotation: 0,
  pivot: { x: 0.5, y: 0.5 },
  anchors: [],
  original_url: '/api/assets/originals/a1.png',
  thumbnail_url: '/api/assets/thumbnails/a1.png',
}

const BOY_IMAGE = new FakeTexture('boy.png', { width: 100, height: 80 })

function renderEditor() {
  return render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  )
}

function sidebar() {
  return within(screen.getByRole('complementary'))
}

function stubLibraryResponse() {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    if (String(input).startsWith('/api/assets')) {
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    }
    return Promise.reject(new Error('connection refused'))
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  useUiStore.persist.clearStorage()
  useTimelineViewStore.persist.clearStorage()
  useUiStore.setState({
    theme: 'light',
    leftSidebarWidth: DEFAULT_LEFT_SIDEBAR_WIDTH,
    inspectorWidth: DEFAULT_INSPECTOR_WIDTH,
    visiblePanels: { leftSidebar: true, inspector: true, timeline: true },
    activeSidebarTab: 'assets',
  })
  useTimelineViewStore.setState({ zoomLevel: 1, scrollTime: 0, height: DEFAULT_TIMELINE_HEIGHT })
  useNotificationStore.setState({ notifications: [] })
  useSelectionStore.setState({ selectedIds: [] })
  useClipboardStore.setState({ items: [] })
  usePlaybackController.setState({ currentTimes: {} })
  pixiRegistry.reset()
  resetTextureRegistries()
})

describe('editor shell', () => {
  it('renders the full editor layout', async () => {
    stubLibraryResponse()
    const { container } = renderEditor()

    expect(screen.getByText('AI Slideshow Editor')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New Project' })).toBeInTheDocument()
    expect(sidebar().getByRole('button', { name: 'Assets' })).toBeInTheDocument()
    expect(sidebar().getByRole('button', { name: 'Slides' })).toBeInTheDocument()
    expect(sidebar().getByRole('button', { name: 'Scene' })).toBeInTheDocument()
    expect(
      await screen.findByText('No assets imported. Import images to build your library.'),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(container.querySelector('.canvas-host canvas')).not.toBeNull()
    })
    expect(
      screen.getByText('Nothing selected. Select an object to edit its properties.'),
    ).toBeInTheDocument()
    const timelinePanel = container.querySelector('.timeline-panel')
    expect(timelinePanel).not.toBeNull()
    expect(
      within(timelinePanel as HTMLElement).getByText('No project. Create one to get started.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
  })

  it('switches the theme, updates the data-theme attribute, and persists the choice', async () => {
    const user = userEvent.setup()
    renderEditor()

    expect(document.documentElement.dataset.theme).toBe('light')

    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }))

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument()
    expect(useUiStore.getState().theme).toBe('dark')
    expect(localStorage.getItem('editor-ui-prefs')).toContain('"dark"')
  })

  it('switches between the Assets and Slides sidebar tabs', async () => {
    stubLibraryResponse()
    const user = userEvent.setup()
    renderEditor()

    await user.click(sidebar().getByRole('button', { name: 'Slides' }))

    expect(screen.getByText('No slides created.')).toBeInTheDocument()
    expect(
      screen.queryByText('No assets imported. Import images to build your library.'),
    ).not.toBeInTheDocument()
    expect(useUiStore.getState().activeSidebarTab).toBe('slides')

    await user.click(sidebar().getByRole('button', { name: 'Assets' }))

    expect(
      await screen.findByText('No assets imported. Import images to build your library.'),
    ).toBeInTheDocument()
    expect(useUiStore.getState().activeSidebarTab).toBe('assets')
  })

  it('switches to the Scene sidebar tab showing the scene hierarchy', async () => {
    stubLibraryResponse()
    const user = userEvent.setup()
    renderEditor()

    await user.click(sidebar().getByRole('button', { name: 'Scene' }))

    expect(sidebar().getByText('No project. Create one to get started.')).toBeInTheDocument()
    expect(useUiStore.getState().activeSidebarTab).toBe('scene')
  })

  it('resizes the left sidebar by dragging its splitter and clamps to the minimum size', () => {
    renderEditor()
    const splitter = screen.getByRole('separator', { name: 'Resize left sidebar' })

    fireEvent.mouseDown(splitter, { clientX: 300 })
    fireEvent.mouseMove(window, { clientX: 380 })
    fireEvent.mouseUp(window)

    expect(useUiStore.getState().leftSidebarWidth).toBe(320)

    fireEvent.mouseDown(splitter, { clientX: 380 })
    fireEvent.mouseMove(window, { clientX: 0 })
    fireEvent.mouseUp(window)

    expect(useUiStore.getState().leftSidebarWidth).toBe(200)
  })

  it('accumulates multiple drag moves without over-scaling the panel', () => {
    renderEditor()
    const splitter = screen.getByRole('separator', { name: 'Resize left sidebar' })

    fireEvent.mouseDown(splitter, { clientX: 300 })
    fireEvent.mouseMove(window, { clientX: 380 })
    fireEvent.mouseMove(window, { clientX: 440 })
    fireEvent.mouseUp(window)

    expect(useUiStore.getState().leftSidebarWidth).toBe(380)
  })

  it('resizes the inspector and timeline via their splitters', () => {
    renderEditor()

    const inspectorSplitter = screen.getByRole('separator', { name: 'Resize inspector' })
    fireEvent.mouseDown(inspectorSplitter, { clientX: 700 })
    fireEvent.mouseMove(window, { clientX: 650 })
    fireEvent.mouseUp(window)
    expect(useUiStore.getState().inspectorWidth).toBe(220)

    const timelineSplitter = screen.getByRole('separator', { name: 'Resize timeline' })
    fireEvent.mouseDown(timelineSplitter, { clientY: 400 })
    fireEvent.mouseMove(window, { clientY: 550 })
    fireEvent.mouseUp(window)
    expect(useTimelineViewStore.getState().height).toBe(350)
  })

  it('renders the status bar with backend status, zoom and fps placeholders', () => {
    renderEditor()

    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('Zoom: 100%')).toBeInTheDocument()
    expect(screen.getByText('FPS: --')).toBeInTheDocument()
  })

  it('shows a notification when a toolbar button is clicked', async () => {
    const user = userEvent.setup()
    renderEditor()

    await user.click(screen.getByRole('button', { name: 'Play' }))

    expect(screen.getByText('Not implemented yet.')).toBeInTheDocument()
  })

  it('shows a notification for provisional keyboard shortcuts', async () => {
    const user = userEvent.setup()
    renderEditor()

    await user.keyboard('{Control>}n{/Control}')

    expect(screen.getByText('Not implemented yet.')).toBeInTheDocument()
  })

  it('opens the import file picker from the Assets menu', async () => {
    stubLibraryResponse()
    const user = userEvent.setup()
    const { container } = renderEditor()
    await screen.findByText('No assets imported. Import images to build your library.')

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const clickSpy = vi.spyOn(input, 'click')

    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Assets' }))
    await user.click(screen.getByRole('menuitem', { name: 'Import Assets' }))

    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('disables the Import Assets menu item while the backend is down', async () => {
    const user = userEvent.setup()
    renderEditor()
    await screen.findByText('Asset library unavailable — start the backend')

    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Assets' }))

    expect(screen.getByRole('menuitem', { name: 'Import Assets' })).toBeDisabled()
  })

  it('shows the too-small message below the minimum supported width', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
    renderEditor()

    expect(
      screen.getByText('The editor is intended for larger screens (minimum 1400px width).'),
    ).toBeInTheDocument()
  })
})

describe('drag & drop placement', () => {
  function stubLibraryWithBoy() {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      if (String(input).startsWith('/api/assets')) {
        return Promise.resolve(new Response(JSON.stringify([BOY]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${String(input)}`))
    })
  }

  async function mountSceneWithAsset(): Promise<{
    container: HTMLElement
    cell: HTMLElement
    canvas: HTMLCanvasElement
  }> {
    stubLibraryWithBoy()
    const { container } = renderEditor()
    const cell = await screen.findByRole('button', { name: 'Select Boy' })
    await waitFor(() => {
      const canvas = container.querySelector('.canvas-host canvas') as HTMLCanvasElement | null
      if (!canvas) {
        throw new Error('Canvas not mounted')
      }
    })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Create Project' }))
    await user.click(screen.getByRole('button', { name: 'Add Slide' }))
    const canvas = container.querySelector('.canvas-host canvas') as HTMLCanvasElement
    return { container, cell, canvas }
  }

  function placeholderOf(container: {
    children: { kind: string; children: { kind: string; texture?: unknown }[] }[]
  }) {
    return container.children[0]?.children.find((child) => child.kind === 'sprite')
  }

  async function flushAsync(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  it('places a dragged asset at the drop point, under the slide, with its real texture', async () => {
    textureLoads.set(BOY.original_url, BOY_IMAGE)
    const { cell, canvas } = await mountSceneWithAsset()
    const dataTransfer = new DataTransfer()
    fireEvent.dragStart(cell, { dataTransfer })
    expect(dataTransfer.getData(ASSET_DEFINITION_MIME)).toBe(BOY.id)

    fireEvent.drop(canvas, { dataTransfer, clientX: 300, clientY: 200 })
    await flushAsync()

    const app = pixiRegistry.applications.at(-1)
    if (!app) {
      throw new Error('No pixi application created')
    }
    const root = findByLabel(worldOf(app), 'Root')
    const boy = findByLabel(root ?? { children: [] }, 'Boy')
    expect(boy).toBeDefined()
    expect(boy?.position.x).toBe(300)
    expect(boy?.position.y).toBe(200)
    expect(placeholderOf(boy as never)?.texture).toBe(BOY_IMAGE)
  })

  it('auto-suffixes a second drop of the same asset and keeps the definition intact', async () => {
    textureLoads.set(BOY.original_url, BOY_IMAGE)
    const { container, cell, canvas } = await mountSceneWithAsset()
    const dropOf = () => {
      const dataTransfer = new DataTransfer()
      dataTransfer.setData(ASSET_DEFINITION_MIME, BOY.id)
      fireEvent.drop(canvas, { dataTransfer, clientX: 100, clientY: 100 })
    }
    dropOf()
    dropOf()
    await flushAsync()

    const app = pixiRegistry.applications.at(-1)
    if (!app) {
      throw new Error('No pixi application created')
    }
    const root = findByLabel(worldOf(app), 'Root')
    expect(findByLabel(root ?? { children: [] }, 'Boy')).toBeDefined()
    expect(findByLabel(root ?? { children: [] }, 'Boy (2)')).toBeDefined()
    expect(cell).toHaveTextContent('Boy')
    const debugTree = container.querySelector('.debug-panel')
    expect(within(debugTree as HTMLElement).getByText('Boy (2)')).toBeInTheDocument()
  })

  it('drags the debug panel by its header and pins the new position', () => {
    const { container } = renderEditor()
    const panel = container.querySelector('.debug-panel') as HTMLElement
    expect(panel).toBeInTheDocument()
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      left: 400,
      top: 90,
      width: 340,
      height: 400,
      right: 740,
      bottom: 490,
      x: 400,
      y: 90,
      toJSON: () => ({}),
    })
    const header = within(panel).getByText('Debug')

    fireEvent.pointerDown(header, { clientX: 400, clientY: 90 })
    fireEvent.pointerMove(window, { clientX: 420, clientY: 150 })
    fireEvent.pointerUp(window)

    expect(panel.style.left).toBe('420px')
    expect(panel.style.top).toBe('150px')
    expect(panel.style.right).toBe('auto')
    fireEvent.pointerDown(header, { clientX: 420, clientY: 150 })
    fireEvent.pointerMove(window, { clientX: 1000, clientY: 150 })
    expect(panel.style.left).toBe('980px')
    fireEvent.pointerUp(window)
  })

  it('ignores a drop without asset data, leaving the scene empty', async () => {
    const { canvas } = await mountSceneWithAsset()

    fireEvent.drop(canvas, { dataTransfer: new DataTransfer(), clientX: 100, clientY: 100 })

    const app = pixiRegistry.applications.at(-1)
    if (!app) {
      throw new Error('No pixi application created')
    }
    const root = findByLabel(worldOf(app), 'Root')
    expect(findByLabel(root ?? { children: [] }, 'Boy')).toBeUndefined()
    expect(findByLabel(root ?? { children: [] }, 'Boy (2)')).toBeUndefined()
  })

  it('syncs selection between the canvas and the Scene hierarchy', async () => {
    textureLoads.set(BOY.original_url, BOY_IMAGE)
    const { cell, canvas } = await mountSceneWithAsset()
    const dataTransfer = new DataTransfer()
    fireEvent.dragStart(cell, { dataTransfer })
    fireEvent.drop(canvas, { dataTransfer, clientX: 300, clientY: 200 })
    await flushAsync()
    const user = userEvent.setup()
    await user.click(sidebar().getByRole('button', { name: 'Scene' }))
    const tree = within(sidebar().getByRole('tree', { name: 'Scene tree of Slide 1' }))
    const boyRow = await tree.findByRole('treeitem', { name: 'Boy' })

    fireEvent.mouseDown(canvas, { button: 0, buttons: 1, clientX: 300, clientY: 200 })
    fireEvent.mouseUp(canvas, { clientX: 300, clientY: 200 })

    await waitFor(() => expect(boyRow).toHaveAttribute('aria-selected', 'true'))

    fireEvent.mouseDown(canvas, { button: 0, buttons: 1, clientX: 40, clientY: 40 })
    fireEvent.mouseUp(canvas, { clientX: 40, clientY: 40 })

    await waitFor(() => expect(boyRow).toHaveAttribute('aria-selected', 'false'))

    await user.click(boyRow)

    await waitFor(() => expect(boyRow).toHaveAttribute('aria-selected', 'true'))
  })
})

describe('clipboard, duplicate and delete', () => {
  function stubLibraryWithBoy() {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      if (String(input).startsWith('/api/assets')) {
        return Promise.resolve(new Response(JSON.stringify([BOY]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${String(input)}`))
    })
  }

  async function mountSceneWithAsset(): Promise<{
    container: HTMLElement
    canvas: HTMLCanvasElement
  }> {
    stubLibraryWithBoy()
    const { container } = renderEditor()
    await screen.findByRole('button', { name: 'Select Boy' })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Create Project' }))
    await user.click(screen.getByRole('button', { name: 'Add Slide' }))
    await waitFor(() => {
      const canvas = container.querySelector('.canvas-host canvas') as HTMLCanvasElement | null
      if (!canvas) {
        throw new Error('Canvas not mounted')
      }
    })
    const canvas = container.querySelector('.canvas-host canvas') as HTMLCanvasElement
    return { container, canvas }
  }

  function dropBoyAt(canvas: HTMLCanvasElement, x: number, y: number): void {
    const dataTransfer = new DataTransfer()
    dataTransfer.setData(ASSET_DEFINITION_MIME, BOY.id)
    fireEvent.drop(canvas, { dataTransfer, clientX: x, clientY: y })
  }

  async function flushAsync(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  function debugTree(container: HTMLElement): HTMLElement {
    const tree = container.querySelector('.debug-panel')
    if (!tree) {
      throw new Error('Debug panel not found')
    }
    return tree as HTMLElement
  }

  function selectAt(canvas: HTMLCanvasElement, x: number, y: number): void {
    fireEvent.mouseDown(canvas, { button: 0, buttons: 1, clientX: x, clientY: y })
    fireEvent.mouseUp(canvas, { clientX: x, clientY: y })
  }

  it('copies with Ctrl+C and pastes with Ctrl+V, suffixing the name and offsetting by +20/+20', async () => {
    textureLoads.set(BOY.original_url, BOY_IMAGE)
    const { container, canvas } = await mountSceneWithAsset()
    dropBoyAt(canvas, 300, 200)
    await flushAsync()
    selectAt(canvas, 300, 200)
    const user = userEvent.setup()

    await user.keyboard('{Control>}c{/Control}')
    await user.keyboard('{Control>}v{/Control}')
    await flushAsync()

    const tree = within(debugTree(container))
    expect(tree.getByText('Boy')).toBeInTheDocument()
    expect(tree.getByText('Boy (2)')).toBeInTheDocument()
    const app = pixiRegistry.applications.at(-1)
    if (!app) {
      throw new Error('No pixi application created')
    }
    const root = findByLabel(worldOf(app), 'Root')
    const ghost = findByLabel(root ?? { children: [] }, 'Boy (2)')
    expect(ghost?.position.x).toBe(320)
    expect(ghost?.position.y).toBe(220)
  })

  it('duplicates with Ctrl+D at a +20/+20 offset and prevents the default browser action', async () => {
    textureLoads.set(BOY.original_url, BOY_IMAGE)
    const { container, canvas } = await mountSceneWithAsset()
    dropBoyAt(canvas, 300, 200)
    await flushAsync()
    selectAt(canvas, 300, 200)

    const event = new KeyboardEvent('keydown', {
      key: 'd',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    const keydownResult = window.dispatchEvent(event)

    await flushAsync()

    expect(keydownResult).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    const tree = within(debugTree(container))
    expect(tree.getByText('Boy (2)')).toBeInTheDocument()
    expect(tree.queryByText('Not implemented yet.')).not.toBeInTheDocument()
    const app = pixiRegistry.applications.at(-1)
    if (!app) {
      throw new Error('No pixi application created')
    }
    const root = findByLabel(worldOf(app), 'Root')
    const ghost = findByLabel(root ?? { children: [] }, 'Boy (2)')
    expect(ghost?.position.x).toBe(320)
    expect(ghost?.position.y).toBe(220)
  })

  it('deletes the selected node with the Delete key', async () => {
    textureLoads.set(BOY.original_url, BOY_IMAGE)
    const { container, canvas } = await mountSceneWithAsset()
    dropBoyAt(canvas, 300, 200)
    await flushAsync()
    selectAt(canvas, 300, 200)

    fireEvent.keyDown(window, { key: 'Delete' })
    await flushAsync()

    const tree = within(debugTree(container))
    expect(tree.queryByText('Boy')).not.toBeInTheDocument()
    expect(tree.getByText('Root')).toBeInTheDocument()
  })

  it('deletes the selected node with the Backspace key', async () => {
    textureLoads.set(BOY.original_url, BOY_IMAGE)
    const { container, canvas } = await mountSceneWithAsset()
    dropBoyAt(canvas, 300, 200)
    await flushAsync()
    selectAt(canvas, 300, 200)

    fireEvent.keyDown(window, { key: 'Backspace' })
    await flushAsync()

    expect(within(debugTree(container)).queryByText('Boy')).not.toBeInTheDocument()
  })

  it('does not delete the selected node while editing a text input', async () => {
    textureLoads.set(BOY.original_url, BOY_IMAGE)
    const { container, canvas } = await mountSceneWithAsset()
    dropBoyAt(canvas, 300, 200)
    await flushAsync()
    selectAt(canvas, 300, 200)
    const search = screen.getByRole('searchbox', { name: 'Search assets' })
    search.focus()
    fireEvent.change(search, { target: { value: 'bo' } })

    fireEvent.keyDown(search, { key: 'Backspace' })
    fireEvent.keyDown(search, { key: 'Delete' })
    await flushAsync()

    expect(within(debugTree(container)).getByText('Boy')).toBeInTheDocument()
  })

  it('cannot delete the root from the hierarchy', async () => {
    textureLoads.set(BOY.original_url, BOY_IMAGE)
    const { container, canvas } = await mountSceneWithAsset()
    dropBoyAt(canvas, 300, 200)
    await flushAsync()
    const user = userEvent.setup()
    await user.click(sidebar().getByRole('button', { name: 'Scene' }))
    const tree = within(sidebar().getByRole('tree', { name: 'Scene tree of Slide 1' }))
    const rootRow = await tree.findByRole('treeitem', { name: 'Root' })
    await user.click(rootRow)

    fireEvent.keyDown(window, { key: 'Delete' })
    await flushAsync()

    expect(rootRow).toBeInTheDocument()
    expect(tree.getByText('Boy')).toBeInTheDocument()
    expect(within(debugTree(container)).getByText('Root')).toBeInTheDocument()
  })

  it('disables Copy/Paste/Duplicate/Delete in the Edit menu without a selection or clipboard, and enables paste after a copy', async () => {
    textureLoads.set(BOY.original_url, BOY_IMAGE)
    stubLibraryWithBoy()
    const { container } = renderEditor()
    await screen.findByRole('button', { name: 'Select Boy' })
    const user = userEvent.setup()
    const openEditMenu = async () => {
      await user.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Edit' }))
    }

    await openEditMenu()
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Paste' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeDisabled()
    await user.click(screen.getByRole('menuitem', { name: 'Undo' }))
    expect(screen.queryByRole('menuitem', { name: 'Copy' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Create Project' }))
    await user.click(screen.getByRole('button', { name: 'Add Slide' }))
    await waitFor(() => {
      const canvas = container.querySelector('.canvas-host canvas') as HTMLCanvasElement | null
      if (!canvas) {
        throw new Error('Canvas not mounted')
      }
    })
    const canvas = container.querySelector('.canvas-host canvas') as HTMLCanvasElement
    dropBoyAt(canvas, 100, 100)
    await flushAsync()
    selectAt(canvas, 100, 100)

    await openEditMenu()
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Paste' })).toBeDisabled()
    await user.click(screen.getByRole('menuitem', { name: 'Copy' }))

    await openEditMenu()
    expect(screen.getByRole('menuitem', { name: 'Paste' })).toBeEnabled()
    await user.click(screen.getByRole('menuitem', { name: 'Paste' }))
    await flushAsync()

    expect(within(debugTree(container)).getByText('Boy (2)')).toBeInTheDocument()
  })
})
