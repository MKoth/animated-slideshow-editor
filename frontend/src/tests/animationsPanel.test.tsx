import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineProvider } from '../app/EngineProvider'
import { useEngine } from '../app/useEngine'
import { AnimationsPanel } from '../components/panels/AnimationsPanel'
import { Notifications } from '../components/notifications/Notifications'
import { useClipLibraryStore } from '../stores/clipLibraryStore'
import { useNotificationStore } from '../stores/notificationStore'
import { CreateProjectCommand } from '../engine/commands/createProjectCommand'
import { CreateClipCommand } from '../engine/commands/createClipCommand'
import type { ClipLibraryEntry } from '../api'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./renderer/pixiFake')
  return createPixiFake()
})

function SetupProject() {
  const { engine, dispatch } = useEngine()
  if (!engine.project) {
    dispatch(new CreateProjectCommand({ name: 'Test Project' }))
  }
  return null
}

function SetupClips() {
  const { engine, dispatch } = useEngine()
  if (!engine.project) {
    dispatch(new CreateProjectCommand({ name: 'Test Project' }))
  }
  if (engine.clips.length === 0) {
    dispatch(new CreateClipCommand({ name: 'Bounce In', duration: 2, category: 'motion' }))
    dispatch(new CreateClipCommand({ name: 'Fade Out', duration: 1.5, category: 'transition' }))
  }
  return null
}

function renderPanel() {
  return render(
    <EngineProvider>
      <SetupProject />
      <AnimationsPanel />
      <Notifications />
    </EngineProvider>,
  )
}

function renderPanelWithClips() {
  return render(
    <EngineProvider>
      <SetupClips />
      <AnimationsPanel />
      <Notifications />
    </EngineProvider>,
  )
}

beforeEach(() => {
  useClipLibraryStore.setState({
    selectedId: null,
    error: null,
  })
  useNotificationStore.setState({ notifications: [] })
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AnimationsPanel', () => {
  it('shows the empty state when no clips exist', async () => {
    renderPanel()

    expect(
      await screen.findByText('No clips created. Create one to get started.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create Clip' })).toBeEnabled()
  })

  it('renders the grid with clip name, duration, and category', async () => {
    renderPanelWithClips()

    expect(await screen.findByText('Bounce In')).toBeInTheDocument()
    expect(screen.getByText('Fade Out')).toBeInTheDocument()
    expect(screen.getByText('2s')).toBeInTheDocument()
    expect(screen.getByText('1.5s')).toBeInTheDocument()
    expect(screen.getByText('motion')).toBeInTheDocument()
    expect(screen.getByText('transition')).toBeInTheDocument()
  })

  it('filters the grid by name as the user types', async () => {
    renderPanelWithClips()
    const user = userEvent.setup()
    await screen.findByText('Bounce In')

    await user.type(screen.getByRole('searchbox', { name: 'Search clips' }), 'bounce')

    expect(screen.getByText('Bounce In')).toBeInTheDocument()
    expect(screen.queryByText('Fade Out')).not.toBeInTheDocument()
  })

  it('shows a no-match message when the search filters everything out', async () => {
    renderPanelWithClips()
    const user = userEvent.setup()
    await screen.findByText('Bounce In')

    await user.type(screen.getByRole('searchbox', { name: 'Search clips' }), 'zzz')

    expect(screen.getByText('No clips match your search.')).toBeInTheDocument()
    expect(
      screen.queryByText('No clips created. Create one to get started.'),
    ).not.toBeInTheDocument()
  })

  it('selects a clip when its cell is clicked', async () => {
    renderPanelWithClips()
    const user = userEvent.setup()
    await screen.findByText('Bounce In')

    await user.click(screen.getByRole('button', { name: 'Select Bounce In' }))

    expect(useClipLibraryStore.getState().selectedId).toBeTruthy()
  })

  it('renames a clip from the cell and updates the grid', async () => {
    renderPanelWithClips()
    const user = userEvent.setup()
    await screen.findByText('Bounce In')

    await user.click(screen.getByRole('button', { name: 'Rename Bounce In' }))
    const input = screen.getByRole('textbox', { name: 'Clip name' })
    await user.clear(input)
    await user.type(input, 'Spring Bounce{Enter}')

    expect(await screen.findByText('Spring Bounce')).toBeInTheDocument()
    expect(screen.queryByText('Bounce In')).not.toBeInTheDocument()
  })

  it('does not rename a clip to an empty name', async () => {
    renderPanelWithClips()
    const user = userEvent.setup()
    await screen.findByText('Bounce In')

    await user.click(screen.getByRole('button', { name: 'Rename Bounce In' }))
    const input = screen.getByRole('textbox', { name: 'Clip name' })
    await user.clear(input)
    await user.keyboard('{Enter}')

    expect(screen.getByText('Bounce In')).toBeInTheDocument()
  })

  it('duplicates a clip with a suffixed name and shows both in the grid', async () => {
    renderPanelWithClips()
    const user = userEvent.setup()
    await screen.findByText('Bounce In')

    await user.click(screen.getByRole('button', { name: 'Duplicate Bounce In' }))

    await waitFor(() => {
      expect(screen.getByText('Bounce In (2)')).toBeInTheDocument()
    })
    expect(screen.getByText('Bounce In')).toBeInTheDocument()
  })

  it('deletes an unreferenced clip and removes it from the grid', async () => {
    renderPanelWithClips()
    const user = userEvent.setup()
    await screen.findByText('Bounce In')

    await user.click(screen.getByRole('button', { name: 'Delete Bounce In' }))

    await waitFor(() => {
      expect(screen.queryByText('Bounce In')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Fade Out')).toBeInTheDocument()
  })

  it('blocks deletion of a clip that is referenced by a node and shows the blocking node name', async () => {
    useClipLibraryStore.setState({
      error: 'Cannot delete clip: it is referenced by nodes: Hero Image',
    })
    renderPanelWithClips()
    await screen.findByText('Bounce In')

    expect(
      screen.getByText('Cannot delete clip: it is referenced by nodes: Hero Image'),
    ).toBeInTheDocument()
  })

  it('clears the error when the user dismisses it', async () => {
    useClipLibraryStore.setState({
      error: 'Cannot delete clip: it is referenced by nodes: Hero Image',
    })
    const user = userEvent.setup()
    renderPanelWithClips()
    await screen.findByText('Bounce In')

    await user.click(screen.getByRole('button', { name: 'Dismiss error' }))

    expect(
      screen.queryByText('Cannot delete clip: it is referenced by nodes: Hero Image'),
    ).not.toBeInTheDocument()
  })

  it('shows newly created clips in the grid', async () => {
    renderPanelWithClips()
    const user = userEvent.setup()
    await screen.findByText('Bounce In')

    await user.click(screen.getByRole('button', { name: 'Create Clip' }))

    await waitFor(() => {
      expect(screen.getByText('New Clip')).toBeInTheDocument()
    })
  })

  it('removes a deleted clip from the grid', async () => {
    renderPanelWithClips()
    const user = userEvent.setup()
    await screen.findByText('Bounce In')

    await user.click(screen.getByRole('button', { name: 'Delete Bounce In' }))

    await waitFor(() => {
      expect(screen.queryByText('Bounce In')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Fade Out')).toBeInTheDocument()
  })

  describe('Save to Library', () => {
    function makeLibraryEntry(overrides: Partial<ClipLibraryEntry> = {}): ClipLibraryEntry {
      return {
        id: 'lib-1',
        name: 'Bounce In',
        duration: 2,
        category: 'motion',
        params: [],
        channels: [],
        channelAnimations: null,
        created_at: '2026-01-01T00:00:00',
        updated_at: '2026-01-01T00:00:00',
        ...overrides,
      }
    }

    it('renders a Save to Library button on each clip card', async () => {
      renderPanelWithClips()
      await screen.findByText('Bounce In')

      expect(screen.getByRole('button', { name: 'Save Bounce In to Library' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save Fade Out to Library' })).toBeInTheDocument()
    })

    it('saves a clip to the library and shows a success toast when no duplicate exists', async () => {
      const entry = makeLibraryEntry()
      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(entry), { status: 200 }))
      const user = userEvent.setup()
      renderPanelWithClips()
      await screen.findByText('Bounce In')

      await user.click(screen.getByRole('button', { name: 'Save Bounce In to Library' }))

      await waitFor(() => {
        expect(screen.getByText('Clip "Bounce In" saved to library')).toBeInTheDocument()
      })
    })

    it('shows a confirmation dialog when a clip with the same name exists in the library', async () => {
      useClipLibraryStore.setState({ definitions: [makeLibraryEntry()] })
      const user = userEvent.setup()
      renderPanelWithClips()
      await screen.findByText('Bounce In')

      await user.click(screen.getByRole('button', { name: 'Save Bounce In to Library' }))

      expect(
        screen.getByText(
          (content) =>
            content.includes('Bounce In') && content.includes('already exists in the library'),
        ),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /save as new/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /overwrite/i })).toBeInTheDocument()
    })

    it('closes the confirmation dialog when Cancel is clicked', async () => {
      useClipLibraryStore.setState({ definitions: [makeLibraryEntry()] })
      const user = userEvent.setup()
      renderPanelWithClips()
      await screen.findByText('Bounce In')

      await user.click(screen.getByRole('button', { name: 'Save Bounce In to Library' }))
      await user.click(screen.getByRole('button', { name: /cancel/i }))

      expect(
        screen.queryByText(
          (content) =>
            content.includes('Bounce In') && content.includes('already exists in the library'),
        ),
      ).not.toBeInTheDocument()
    })

    it('saves as a new clip with a unique name when Save as New is clicked in the confirmation dialog', async () => {
      useClipLibraryStore.setState({ definitions: [makeLibraryEntry()] })
      const newEntry = makeLibraryEntry({ id: 'lib-2', name: 'Bounce In (2)' })
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(newEntry), { status: 200 }),
      )
      const user = userEvent.setup()
      renderPanelWithClips()
      await screen.findByText('Bounce In')

      await user.click(screen.getByRole('button', { name: 'Save Bounce In to Library' }))
      await user.click(screen.getByRole('button', { name: /save as new/i }))

      await waitFor(() => {
        expect(screen.getByText('Clip "Bounce In (2)" saved to library')).toBeInTheDocument()
      })
    })

    it('overwrites the existing clip when Overwrite is clicked in the confirmation dialog', async () => {
      useClipLibraryStore.setState({ definitions: [makeLibraryEntry()] })
      const updatedEntry = makeLibraryEntry({ name: 'Bounce In Updated' })
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(updatedEntry), { status: 200 }),
      )
      const user = userEvent.setup()
      renderPanelWithClips()
      await screen.findByText('Bounce In')

      await user.click(screen.getByRole('button', { name: 'Save Bounce In to Library' }))
      await user.click(screen.getByRole('button', { name: /overwrite/i }))

      await waitFor(() => {
        expect(screen.getByText('Clip "Bounce In" updated in library')).toBeInTheDocument()
      })
    })

    it('shows an error notification when save to library fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 500 }))
      const user = userEvent.setup()
      renderPanelWithClips()
      await screen.findByText('Bounce In')

      await user.click(screen.getByRole('button', { name: 'Save Bounce In to Library' }))

      await waitFor(() => {
        expect(screen.getByText('Failed to save clip to library.')).toBeInTheDocument()
      })
    })
  })
})
