import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import App from '../app/App'
import { useNotificationStore } from '../stores/notificationStore'
import {
  DEFAULT_INSPECTOR_WIDTH,
  DEFAULT_LEFT_SIDEBAR_WIDTH,
  DEFAULT_TIMELINE_HEIGHT,
} from '../stores/uiPrefs'
import { useUiStore } from '../stores/uiStore'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./renderer/pixiFake')
  return createPixiFake()
})

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
})

describe('editor shell', () => {
  it('renders the full editor layout', async () => {
    const { container } = renderEditor()

    expect(screen.getByText('AI Slideshow Editor')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New Project' })).toBeInTheDocument()
    expect(sidebar().getByRole('button', { name: 'Assets' })).toBeInTheDocument()
    expect(sidebar().getByRole('button', { name: 'Slides' })).toBeInTheDocument()
    expect(screen.getByText('No assets imported.')).toBeInTheDocument()
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
    const user = userEvent.setup()
    renderEditor()

    await user.click(sidebar().getByRole('button', { name: 'Slides' }))

    expect(screen.getByText('No slides created.')).toBeInTheDocument()
    expect(screen.queryByText('No assets imported.')).not.toBeInTheDocument()
    expect(useUiStore.getState().activeSidebarTab).toBe('slides')

    await user.click(sidebar().getByRole('button', { name: 'Assets' }))

    expect(screen.getByText('No assets imported.')).toBeInTheDocument()
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

  it('shows the too-small message below the minimum supported width', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
    renderEditor()

    expect(
      screen.getByText('The editor is intended for larger screens (minimum 1400px width).'),
    ).toBeInTheDocument()
  })
})
