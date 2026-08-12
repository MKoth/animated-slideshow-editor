import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import App from '../app/App'
import type { AssetDefinition } from '../api'
import { ASSET_DEFINITION_MIME } from '../pixi/renderer/dropPlacement'
import { useNotificationStore } from '../stores/notificationStore'
import {
  DEFAULT_INSPECTOR_WIDTH,
  DEFAULT_LEFT_SIDEBAR_WIDTH,
  DEFAULT_TIMELINE_HEIGHT,
} from '../stores/uiPrefs'
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
  useUiStore.setState({
    theme: 'light',
    leftSidebarWidth: DEFAULT_LEFT_SIDEBAR_WIDTH,
    inspectorWidth: DEFAULT_INSPECTOR_WIDTH,
    timelineHeight: DEFAULT_TIMELINE_HEIGHT,
    visiblePanels: { leftSidebar: true, inspector: true, timeline: true },
    activeSidebarTab: 'assets',
  })
  useNotificationStore.setState({ notifications: [] })
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
    expect(
      await screen.findByText('No assets imported. Import images to build your library.'),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(container.querySelector('.canvas-host canvas')).not.toBeNull()
    })
    expect(screen.getByText('Nothing selected.')).toBeInTheDocument()
    expect(screen.getByText('No animation loaded.')).toBeInTheDocument()
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
    expect(useUiStore.getState().timelineHeight).toBe(350)
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
})
