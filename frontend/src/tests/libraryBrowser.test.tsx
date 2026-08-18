import { render, screen, waitFor, within } from '@testing-library/react'
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

function makeClipEntry(overrides: Partial<ClipLibraryEntry> = {}): ClipLibraryEntry {
  return {
    id: 'lib-1',
    name: 'Fade In',
    duration: 1,
    category: 'transition',
    params: [],
    channels: [],
    channelAnimations: null,
    created_at: '2026-08-15T12:00:00',
    updated_at: '2026-08-15T12:00:00',
    ...overrides,
  }
}

function stubFetch(handler: (url: string, init: RequestInit) => Promise<Response>): void {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init ?? {}),
  )
}

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
    libraryBrowserVisible: false,
    definitions: [],
    loaded: false,
    loading: false,
    unavailable: false,
  })
  useNotificationStore.setState({ notifications: [] })
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LibraryBrowser', () => {
  describe('Browse Library button', () => {
    it('renders a Browse Library button in the Animations panel', async () => {
      renderPanel()
      expect(await screen.findByRole('button', { name: 'Browse Library' })).toBeInTheDocument()
    })

    it('opens the library browser modal when Browse Library is clicked', async () => {
      stubFetch(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })))
      const user = userEvent.setup()
      renderPanel()
      await screen.findByRole('button', { name: 'Browse Library' })

      await user.click(screen.getByRole('button', { name: 'Browse Library' }))

      expect(screen.getByRole('dialog', { name: 'Browse Library' })).toBeInTheDocument()
    })
  })

  describe('Library content', () => {
    it('shows loading state while fetching clips', async () => {
      let release: (value: Response) => void = () => {}
      stubFetch(
        () =>
          new Promise((resolve) => {
            release = resolve
          }),
      )
      const user = userEvent.setup()
      renderPanel()
      await screen.findByRole('button', { name: 'Browse Library' })

      await user.click(screen.getByRole('button', { name: 'Browse Library' }))

      expect(screen.getByText('Loading library...')).toBeInTheDocument()
      release(new Response(JSON.stringify([]), { status: 200 }))
    })

    it('shows empty state when library has no clips', async () => {
      stubFetch(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })))
      const user = userEvent.setup()
      renderPanel()
      await screen.findByRole('button', { name: 'Browse Library' })

      await user.click(screen.getByRole('button', { name: 'Browse Library' }))

      await waitFor(() => {
        expect(
          screen.getByText(
            'Library is empty. Save clips from the Animations panel to populate it.',
          ),
        ).toBeInTheDocument()
      })
    })

    it('shows all library clips with name, duration, category, and channel count', async () => {
      stubFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              makeClipEntry({
                id: 'lib-1',
                name: 'Fade In',
                duration: 1,
                category: 'transition',
                channels: [],
              }),
              makeClipEntry({
                id: 'lib-2',
                name: 'Bounce',
                duration: 2,
                category: 'motion',
                channels: [{ property: 'positionX' }, { property: 'positionY' }],
              }),
            ]),
            { status: 200 },
          ),
        ),
      )
      const user = userEvent.setup()
      renderPanel()
      await screen.findByRole('button', { name: 'Browse Library' })

      await user.click(screen.getByRole('button', { name: 'Browse Library' }))

      await waitFor(() => {
        expect(screen.getByText('Fade In')).toBeInTheDocument()
        expect(screen.getByText('Bounce')).toBeInTheDocument()
        expect(screen.getByText('1s')).toBeInTheDocument()
        expect(screen.getByText('2s')).toBeInTheDocument()
        expect(screen.getAllByText('transition').length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText('motion').length).toBeGreaterThanOrEqual(1)
        expect(screen.getByText('0 ch')).toBeInTheDocument()
        expect(screen.getByText('2 ch')).toBeInTheDocument()
      })
    })

    it('shows backend unavailable message when the backend is down', async () => {
      stubFetch(() => Promise.reject(new Error('connection refused')))
      const user = userEvent.setup()
      renderPanel()
      await screen.findByRole('button', { name: 'Browse Library' })

      await user.click(screen.getByRole('button', { name: 'Browse Library' }))

      await waitFor(() => {
        expect(
          screen.getByText('Backend unavailable. Library cannot be loaded.'),
        ).toBeInTheDocument()
      })
    })
  })

  describe('Search and filter', () => {
    async function openBrowserWithClips() {
      stubFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              makeClipEntry({ id: 'lib-1', name: 'Fade In', category: 'transition', channels: [] }),
              makeClipEntry({ id: 'lib-2', name: 'Bounce', category: 'motion', channels: [] }),
              makeClipEntry({
                id: 'lib-3',
                name: 'Fade Out',
                category: 'transition',
                channels: [{ property: 'opacity' }],
              }),
            ]),
            { status: 200 },
          ),
        ),
      )
      const user = userEvent.setup()
      renderPanel()
      await screen.findByRole('button', { name: 'Browse Library' })
      await user.click(screen.getByRole('button', { name: 'Browse Library' }))
      await waitFor(() => {
        expect(screen.getByText('Fade In')).toBeInTheDocument()
      })
    }

    it('filters clips by name as the user types', async () => {
      await openBrowserWithClips()
      const user = userEvent.setup()

      await user.type(screen.getByRole('searchbox', { name: 'Search library clips' }), 'fade')

      expect(screen.getByText('Fade In')).toBeInTheDocument()
      expect(screen.getByText('Fade Out')).toBeInTheDocument()
      expect(screen.queryByText('Bounce')).not.toBeInTheDocument()
    })

    it('filters clips by category', async () => {
      await openBrowserWithClips()
      const user = userEvent.setup()

      await user.selectOptions(
        screen.getByRole('combobox', { name: 'Filter by category' }),
        'motion',
      )

      expect(screen.getByText('Bounce')).toBeInTheDocument()
      expect(screen.queryByText('Fade In')).not.toBeInTheDocument()
      expect(screen.queryByText('Fade Out')).not.toBeInTheDocument()
    })

    it('shows no-match message when search filters everything out', async () => {
      await openBrowserWithClips()
      const user = userEvent.setup()

      await user.type(screen.getByRole('searchbox', { name: 'Search library clips' }), 'zzz')

      expect(screen.getByText('No clips match your search.')).toBeInTheDocument()
    })
  })

  describe('Import', () => {
    it('imports a clip into the project and shows a notification', async () => {
      stubFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              makeClipEntry({
                id: 'lib-1',
                name: 'Fade In',
                duration: 1,
                category: 'transition',
                params: [],
                channels: [],
                channelAnimations: null,
              }),
            ]),
            { status: 200 },
          ),
        ),
      )
      const user = userEvent.setup()
      renderPanelWithClips()
      await screen.findByRole('button', { name: 'Browse Library' })
      await user.click(screen.getByRole('button', { name: 'Browse Library' }))
      await waitFor(() => {
        expect(screen.getByText('Fade In')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'Import Fade In into project' }))

      await waitFor(() => {
        expect(screen.getByText('Clip "Fade In" imported into project')).toBeInTheDocument()
      })
    })

    it('imported clip appears in the project clip list', async () => {
      stubFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              makeClipEntry({
                id: 'lib-1',
                name: 'Library Clip',
                duration: 3,
                category: 'special',
                params: [],
                channels: [],
                channelAnimations: null,
              }),
            ]),
            { status: 200 },
          ),
        ),
      )
      const user = userEvent.setup()
      renderPanelWithClips()
      await screen.findByText('Bounce In')
      await user.click(screen.getByRole('button', { name: 'Browse Library' }))
      await waitFor(() => {
        expect(screen.getByText('Library Clip')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'Import Library Clip into project' }))

      await waitFor(() => {
        expect(screen.getAllByText('Library Clip').length).toBeGreaterThanOrEqual(2)
      })
    })
  })

  describe('Delete', () => {
    it('shows a confirmation dialog when Delete is clicked', async () => {
      stubFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([makeClipEntry({ id: 'lib-1', name: 'Fade In', channels: [] })]),
            { status: 200 },
          ),
        ),
      )
      const user = userEvent.setup()
      renderPanel()
      await screen.findByRole('button', { name: 'Browse Library' })
      await user.click(screen.getByRole('button', { name: 'Browse Library' }))
      await waitFor(() => {
        expect(screen.getByText('Fade In')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'Delete Fade In from library' }))

      expect(
        screen.getByText((content) => content.includes('Fade In') && content.includes('Delete')),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    })

    it('closes the confirmation dialog when Cancel is clicked', async () => {
      stubFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([makeClipEntry({ id: 'lib-1', name: 'Fade In', channels: [] })]),
            { status: 200 },
          ),
        ),
      )
      const user = userEvent.setup()
      renderPanel()
      await screen.findByRole('button', { name: 'Browse Library' })
      await user.click(screen.getByRole('button', { name: 'Browse Library' }))
      await waitFor(() => {
        expect(screen.getByText('Fade In')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'Delete Fade In from library' }))
      await user.click(screen.getByRole('button', { name: /cancel/i }))

      expect(screen.queryByRole('dialog', { name: 'Confirm delete' })).not.toBeInTheDocument()
    })

    it('deletes the clip from the library and shows a notification', async () => {
      stubFetch((_url, init) => {
        if (init.method === 'DELETE') {
          return Promise.resolve(new Response(null, { status: 204 }))
        }
        return Promise.resolve(
          new Response(
            JSON.stringify([
              makeClipEntry({ id: 'lib-1', name: 'Fade In', channels: [] }),
              makeClipEntry({ id: 'lib-2', name: 'Bounce', channels: [] }),
            ]),
            { status: 200 },
          ),
        )
      })
      const user = userEvent.setup()
      renderPanel()
      await screen.findByRole('button', { name: 'Browse Library' })
      await user.click(screen.getByRole('button', { name: 'Browse Library' }))
      await waitFor(() => {
        expect(screen.getByText('Fade In')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'Delete Fade In from library' }))
      const confirmDialog = screen.getByRole('dialog', { name: 'Confirm delete' })
      await user.click(within(confirmDialog).getByRole('button', { name: /delete/i }))

      await waitFor(() => {
        expect(screen.getByText('Clip "Fade In" deleted from library')).toBeInTheDocument()
        expect(screen.queryByText('Fade In')).not.toBeInTheDocument()
        expect(screen.getByText('Bounce')).toBeInTheDocument()
      })
    })
  })

  describe('Close', () => {
    it('closes the browser when Close is clicked', async () => {
      stubFetch(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })))
      const user = userEvent.setup()
      renderPanel()
      await screen.findByRole('button', { name: 'Browse Library' })
      await user.click(screen.getByRole('button', { name: 'Browse Library' }))
      await waitFor(() => {
        expect(screen.getByRole('dialog', { name: 'Browse Library' })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'Close' }))

      expect(screen.queryByRole('dialog', { name: 'Browse Library' })).not.toBeInTheDocument()
    })
  })

  describe('Error handling', () => {
    it('dismisses error when Dismiss is clicked', async () => {
      stubFetch(() => Promise.reject(new Error('connection refused')))
      const user = userEvent.setup()
      renderPanel()
      await screen.findByRole('button', { name: 'Browse Library' })
      await user.click(screen.getByRole('button', { name: 'Browse Library' }))
      await waitFor(() => {
        const dialog = screen.getByRole('dialog', { name: 'Browse Library' })
        expect(within(dialog).getByRole('alert')).toBeInTheDocument()
      })

      const dialog = screen.getByRole('dialog', { name: 'Browse Library' })
      await user.click(within(dialog).getByRole('button', { name: 'Dismiss error' }))

      expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    })
  })
})
