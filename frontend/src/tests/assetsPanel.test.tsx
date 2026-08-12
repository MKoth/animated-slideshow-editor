import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetDefinition } from '../api'
import { AssetsPanel } from '../components/panels/AssetsPanel'
import { ASSET_DEFINITION_MIME } from '../pixi/renderer/dropPlacement'
import { registerAssetUsageCounter, useAssetLibraryStore } from '../stores/assetLibraryStore'
import { useNotificationStore } from '../stores/notificationStore'

const BOY: AssetDefinition = {
  id: 'a1',
  name: 'Boy',
  description: 'A friendly boy character',
  category: 'Character',
  tags: ['kid'],
  ai_description: 'AI summary of the boy',
  original_filename: 'boy.png',
  import_date: '2026-08-11T12:00:00',
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

const GIRL: AssetDefinition = { ...BOY, id: 'a2', name: 'Girl', category: 'Character' }

function stubLibrary(definitions: AssetDefinition[]): void {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('/api/assets') && init?.method === 'POST') {
      return Promise.resolve(
        new Response(JSON.stringify({ created: [], errors: [] }), { status: 200 }),
      )
    }
    if (url.startsWith('/api/assets')) {
      const params = Object.fromEntries(new URLSearchParams(url.split('?')[1]))
      if (params.search) {
        return Promise.resolve(
          new Response(
            JSON.stringify(definitions.filter((d) => d.name.toLowerCase().includes(params.search))),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response(JSON.stringify(definitions), { status: 200 }))
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  })
}

function stubBackendDown(): void {
  vi.mocked(fetch).mockRejectedValue(new Error('connection refused'))
}

function renderPanel() {
  return render(<AssetsPanel />)
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  useAssetLibraryStore.setState({
    definitions: [],
    loading: false,
    error: null,
    unavailable: false,
    search: '',
    sort: 'import_date',
    order: 'desc',
    selectedId: null,
  })
  useNotificationStore.setState({ notifications: [] })
  registerAssetUsageCounter(() => 0)
})

describe('AssetsPanel', () => {
  it('shows the empty state with the canonical message when the library is empty', async () => {
    stubLibrary([])
    renderPanel()

    expect(
      await screen.findByText('No assets imported. Import images to build your library.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import Assets' })).toBeEnabled()
  })

  it('shows the unavailable state and disables import, search, and sort when the backend is down', async () => {
    stubBackendDown()
    renderPanel()

    expect(
      await screen.findByText('Asset library unavailable — start the backend'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import Assets' })).toBeDisabled()
    expect(screen.getByRole('searchbox', { name: 'Search assets' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Sort assets' })).toBeDisabled()
    expect(screen.queryByText('Boy')).not.toBeInTheDocument()
  })

  it('renders the grid with thumbnail, name, and category per asset', async () => {
    stubLibrary([BOY, GIRL])
    const { container } = renderPanel()

    const grid = await waitFor(() => {
      const element = container.querySelector('.asset-grid')
      expect(element).not.toBeNull()
      return element as HTMLElement
    })
    const boyCell = within(grid).getByRole('button', { name: 'Select Boy' })
    expect(boyCell).toHaveTextContent('Boy')
    expect(boyCell).toHaveTextContent('Character')
    expect(within(boyCell).getByRole('img', { name: 'Boy' })).toHaveAttribute(
      'src',
      '/api/assets/thumbnails/a1.png',
    )
    expect(within(grid).getAllByRole('img')).toHaveLength(2)
  })

  it('makes asset cells draggable and carries the definition id in the drag payload', async () => {
    stubLibrary([BOY, GIRL])
    renderPanel()
    await screen.findByText('Girl')

    const boyCell = screen.getByRole('button', { name: 'Select Boy' })
    expect(boyCell).toHaveAttribute('draggable', 'true')

    const dataTransfer = new DataTransfer()
    fireEvent.dragStart(boyCell, { dataTransfer })

    expect(dataTransfer.getData(ASSET_DEFINITION_MIME)).toBe(BOY.id)
    expect(dataTransfer.effectAllowed).toBe('copy')
  })

  it('exposes the same drag payload from the list view rows', async () => {
    stubLibrary([BOY])
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Boy')
    await user.click(screen.getByRole('button', { name: 'List view' }))

    const row = screen.getByRole('button', { name: 'Select Boy' })
    const dataTransfer = new DataTransfer()
    fireEvent.dragStart(row, { dataTransfer })

    expect(dataTransfer.getData(ASSET_DEFINITION_MIME)).toBe(BOY.id)
    expect(row).toHaveAttribute('draggable', 'true')
  })

  it('switches to the list view and back', async () => {
    stubLibrary([BOY])
    const user = userEvent.setup()
    const { container } = renderPanel()
    await screen.findByText('Boy')

    await user.click(screen.getByRole('button', { name: 'List view' }))

    expect(container.querySelector('.asset-list')).not.toBeNull()
    expect(container.querySelector('.asset-grid')).toBeNull()
    expect(screen.getByText('Boy')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Grid view' }))

    expect(container.querySelector('.asset-grid')).not.toBeNull()
  })

  it('reloads the library when the sort selection changes', async () => {
    stubLibrary([BOY])
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Boy')

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort assets' }), 'Name (A–Z)')

    await waitFor(() => {
      expect(useAssetLibraryStore.getState().sort).toBe('name')
      expect(useAssetLibraryStore.getState().order).toBe('asc')
    })
  })

  it('filters the library by name after a debounce while typing', async () => {
    stubLibrary([BOY, GIRL])
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Girl')

    await user.type(screen.getByRole('searchbox', { name: 'Search assets' }), 'boy')

    expect(useAssetLibraryStore.getState().search).toBe('boy')
    expect(await screen.findByText('Boy')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Girl')).not.toBeInTheDocument())
  })

  it('opens the native file picker from the Import Assets button', async () => {
    stubLibrary([])
    const user = userEvent.setup()
    const { container } = renderPanel()
    await screen.findByText('No assets imported. Import images to build your library.')

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const clickSpy = vi.spyOn(input, 'click')

    await user.click(screen.getByRole('button', { name: 'Import Assets' }))

    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('uploads selected files and shows the imported asset in the library', async () => {
    const created = BOY
    let libraryCalls = 0
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/assets') && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ created: [created], errors: [] }), { status: 200 }),
        )
      }
      if (url.startsWith('/api/assets')) {
        libraryCalls += 1
        return Promise.resolve(
          new Response(JSON.stringify(libraryCalls === 1 ? [] : [created]), { status: 200 }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const { container } = renderPanel()
    await screen.findByText('No assets imported. Import images to build your library.')

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['image-bytes'], 'boy.png', { type: 'image/png' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    fireEvent.change(input)

    expect(await screen.findByText('Boy')).toBeInTheDocument()
    const uploadCall = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')
    expect(uploadCall).toBeDefined()
  })

  it('surfaces per-file import errors as notifications', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/assets') && init?.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              created: [],
              errors: [{ filename: 'broken.png', error: 'corrupt or unreadable image file' }],
            }),
            { status: 200 },
          ),
        )
      }
      if (url.startsWith('/api/assets')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const { container } = renderPanel()
    await screen.findByText('No assets imported. Import images to build your library.')

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['x'], 'broken.png', { type: 'image/png' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    fireEvent.change(input)

    await waitFor(() => {
      expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
        'broken.png: corrupt or unreadable image file',
      ])
    })
  })

  it('opens the read-only preview for a selected asset and closes it', async () => {
    stubLibrary([BOY])
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Boy')

    await user.click(screen.getByRole('button', { name: 'Select Boy' }))

    const preview = screen.getByRole('region', { name: 'Asset preview' })
    expect(within(preview).getByRole('img')).toHaveAttribute('src', '/api/assets/originals/a1.png')
    expect(within(preview).getByText('Character')).toBeInTheDocument()
    expect(within(preview).getByText('100 × 80')).toBeInTheDocument()
    expect(within(preview).getByText('1.0 KB')).toBeInTheDocument()
    expect(within(preview).getByText('2026-08-11')).toBeInTheDocument()
    expect(within(preview).getByText('A friendly boy character')).toBeInTheDocument()
    expect(within(preview).getByText('AI summary of the boy')).toBeInTheDocument()

    await user.click(within(preview).getByRole('button', { name: 'Close preview' }))

    expect(screen.queryByRole('region', { name: 'Asset preview' })).not.toBeInTheDocument()
  })

  it('deletes an unreferenced asset from the preview and closes it', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/assets') && init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url.startsWith('/api/assets')) {
        return Promise.resolve(new Response(JSON.stringify([BOY, GIRL]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Girl')

    await user.click(screen.getByRole('button', { name: 'Select Boy' }))
    await user.click(
      within(screen.getByRole('region', { name: 'Asset preview' })).getByRole('button', {
        name: 'Delete asset',
      }),
    )

    expect(screen.queryByRole('region', { name: 'Asset preview' })).not.toBeInTheDocument()
    expect(screen.queryByText('Boy')).not.toBeInTheDocument()
    expect(screen.getByText('Girl')).toBeInTheDocument()
    expect(useNotificationStore.getState().notifications).toEqual([])
  })

  it('refuses to delete a referenced asset with the usage named', async () => {
    registerAssetUsageCounter(() => 3)
    let deleteCalls = 0
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/assets') && init?.method === 'DELETE') {
        deleteCalls += 1
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url.startsWith('/api/assets')) {
        return Promise.resolve(new Response(JSON.stringify([BOY]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Boy')

    await user.click(screen.getByRole('button', { name: 'Select Boy' }))
    await user.click(
      within(screen.getByRole('region', { name: 'Asset preview' })).getByRole('button', {
        name: 'Delete asset',
      }),
    )

    expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
      'Used by 3 objects',
    ])
    expect(screen.getByRole('region', { name: 'Asset preview' })).toBeInTheDocument()
    expect(screen.getAllByText('Boy')).toHaveLength(2)
    expect(deleteCalls).toBe(0)
  })
})
