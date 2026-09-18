import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetDefinition } from '../api'
import type { AssetFolder } from '../api/assetsApi'
import { AssetsPanel } from '../components/panels/AssetsPanel'
import { ASSET_FOLDER_MIME } from '../components/assets/folders'
import { ASSET_DEFINITION_MIME } from '../pixi/renderer/dropPlacement'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'
import { useNotificationStore } from '../stores/notificationStore'

function makeAsset(overrides: Partial<AssetDefinition> = {}): AssetDefinition {
  return {
    id: 'a1',
    name: 'Boy',
    description: '',
    category: 'Character',
    tags: [],
    ai_description: '',
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
    folder_id: null,
    ...overrides,
  }
}

function makeFolder(overrides: Partial<AssetFolder> = {}): AssetFolder {
  return {
    id: 'f1',
    name: 'Set',
    parent_id: null,
    created_at: '2026-08-11T12:00:00',
    updated_at: '2026-08-11T12:00:00',
    ...overrides,
  }
}

interface FakeBackend {
  folders: AssetFolder[]
  assets: AssetDefinition[]
  requests: Array<{ url: string; method?: string }>
}

/** In-memory fake for the asset + folder API surface used by the panel. */
function stubBackend(initial?: Partial<Pick<FakeBackend, 'folders' | 'assets'>>): FakeBackend {
  const backend: FakeBackend = {
    folders: initial?.folders ?? [],
    assets: initial?.assets ?? [],
    requests: [],
  }
  let folderSeq = 100
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    backend.requests.push({ url, method })

    if (url.startsWith('/api/assets/folders')) {
      const suffix = url.slice('/api/assets/folders'.length)
      if (method === 'GET' && (suffix === '' || suffix.startsWith('?'))) {
        return Promise.resolve(new Response(JSON.stringify(backend.folders), { status: 200 }))
      }
      if (method === 'POST') {
        const body = JSON.parse(init?.body as string) as { name: string; parent_id?: string | null }
        const name = body.name.trim()
        const parentId = body.parent_id ?? null
        if (!name) {
          return Promise.resolve(new Response(JSON.stringify({ detail: 'blank' }), { status: 422 }))
        }
        const dup = backend.folders.some(
          (f) => f.parent_id === parentId && f.name.toLowerCase() === name.toLowerCase(),
        )
        if (dup) {
          return Promise.resolve(
            new Response(JSON.stringify({ detail: 'exists' }), { status: 409 }),
          )
        }
        const folder = makeFolder({ id: `f${folderSeq++}`, name, parent_id: parentId })
        backend.folders.push(folder)
        return Promise.resolve(new Response(JSON.stringify(folder), { status: 201 }))
      }
      const id = suffix.split('?')[0].replace(/^\//, '')
      const folder = backend.folders.find((f) => f.id === id)
      if (!folder) {
        return Promise.resolve(new Response(JSON.stringify({ detail: 'missing' }), { status: 404 }))
      }
      if (method === 'PATCH') {
        const body = JSON.parse(init?.body as string) as {
          name?: string
          parent_id?: string | null
        }
        if (body.name !== undefined) folder.name = body.name
        if ('parent_id' in body) folder.parent_id = body.parent_id ?? null
        return Promise.resolve(new Response(JSON.stringify(folder), { status: 200 }))
      }
      if (method === 'DELETE') {
        backend.folders = backend.folders.filter((f) => f.id !== id)
        for (const child of backend.folders) {
          if (child.parent_id === id) child.parent_id = folder.parent_id
        }
        for (const asset of backend.assets) {
          if (asset.folder_id === id) asset.folder_id = folder.parent_id
        }
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(new Response(JSON.stringify(folder), { status: 200 }))
    }

    if (url.startsWith('/api/assets')) {
      if (method === 'GET' && !url.match(/\/api\/assets\/[^?/]+/)) {
        const params = Object.fromEntries(new URLSearchParams(url.split('?')[1] ?? ''))
        let assets = [...backend.assets]
        if (params.folder_id === 'root' || params.folder_id === '') {
          assets = assets.filter((a) => a.folder_id == null)
        } else if (params.folder_id) {
          assets = assets.filter((a) => a.folder_id === params.folder_id)
        }
        if (params.search) {
          assets = assets.filter((a) => a.name.toLowerCase().includes(params.search.toLowerCase()))
        }
        return Promise.resolve(new Response(JSON.stringify(assets), { status: 200 }))
      }
      if (method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ created: [], errors: [] }), { status: 200 }),
        )
      }
      const match = url.match(/\/api\/assets\/([^/?]+)/)
      if (match && method === 'PATCH') {
        const asset = backend.assets.find((a) => a.id === match[1])
        if (!asset) {
          return Promise.resolve(
            new Response(JSON.stringify({ detail: 'missing' }), { status: 404 }),
          )
        }
        const body = JSON.parse(init?.body as string) as { folder_id?: string | null }
        asset.folder_id = body.folder_id ?? null
        return Promise.resolve(new Response(JSON.stringify(asset), { status: 200 }))
      }
      if (match && method === 'DELETE') {
        backend.assets = backend.assets.filter((a) => a.id !== match[1])
        return Promise.resolve(new Response(null, { status: 204 }))
      }
    }
    return Promise.reject(new Error(`unexpected fetch: ${method} ${url}`))
  })
  return backend
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  useAssetLibraryStore.setState({
    definitions: [],
    folders: [],
    currentFolderId: null,
    loading: false,
    error: null,
    unavailable: false,
    search: '',
    sort: 'import_date',
    order: 'desc',
    selectedId: null,
  })
  useNotificationStore.setState({ notifications: [] })
})

describe('AssetsPanel folders', () => {
  it('lists folders before assets with a root breadcrumb', async () => {
    stubBackend({
      folders: [makeFolder()],
      assets: [makeAsset()],
    })
    render(<AssetsPanel />)

    expect(await screen.findByRole('button', { name: 'Folder Set' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select Boy' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Root')
  })

  it('navigates into a folder on double click and back via Root', async () => {
    const backend = stubBackend({
      folders: [makeFolder()],
      assets: [makeAsset(), makeAsset({ id: 'a2', name: 'Girl', folder_id: 'f1' })],
    })
    const user = userEvent.setup()
    render(<AssetsPanel />)
    await screen.findByRole('button', { name: 'Folder Set' })

    await user.dblClick(screen.getByRole('button', { name: 'Folder Set' }))

    await waitFor(() => {
      expect(screen.queryByText('Boy')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Girl')).toBeInTheDocument()
    expect(backend.requests.some((r) => r.url.includes('folder_id=f1'))).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Go to root folder' }))
    expect(await screen.findByText('Boy')).toBeInTheDocument()
  })

  it('creates a folder with the New folder flow', async () => {
    stubBackend({ folders: [], assets: [] })
    const user = userEvent.setup()
    render(<AssetsPanel />)
    await screen.findByText('No assets imported. Import images to build your library.')

    await user.click(screen.getByRole('button', { name: 'New folder' }))
    await user.type(screen.getByRole('textbox', { name: 'New folder name' }), 'Heroes')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByRole('button', { name: 'Folder Heroes' })).toBeInTheDocument()
  })

  it('renames the selected folder inline', async () => {
    stubBackend({ folders: [makeFolder()], assets: [] })
    const user = userEvent.setup()
    render(<AssetsPanel />)
    await screen.findByRole('button', { name: 'Folder Set' })

    await user.click(screen.getByRole('button', { name: 'Folder Set' }))
    await user.click(screen.getByRole('button', { name: 'Rename Set' }))

    const input = screen.getByRole('textbox', { name: 'Rename Set' })
    await user.clear(input)
    await user.type(input, 'Cast{Enter}')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Folder Cast' })).toBeInTheDocument()
    })
  })

  it('deletes a folder after confirmation and keeps its assets at the parent', async () => {
    stubBackend({
      folders: [makeFolder()],
      assets: [makeAsset({ folder_id: 'f1' })],
    })
    const user = userEvent.setup()
    render(<AssetsPanel />)
    // Enter the folder to see the asset, then go back and delete it.
    await screen.findByRole('button', { name: 'Folder Set' })
    await user.dblClick(screen.getByRole('button', { name: 'Folder Set' }))
    expect(await screen.findByText('Boy')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Go to root folder' }))
    await screen.findByRole('button', { name: 'Folder Set' })

    await user.click(screen.getByRole('button', { name: 'Folder Set' }))
    await user.click(screen.getByRole('button', { name: 'Delete Set' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete Set' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Folder / })).not.toBeInTheDocument()
    })
    expect(await screen.findByText('Boy')).toBeInTheDocument()
  })

  it('moves an asset onto a folder via drag and drop', async () => {
    const backend = stubBackend({
      folders: [makeFolder()],
      assets: [makeAsset()],
    })
    render(<AssetsPanel />)
    await screen.findByRole('button', { name: 'Folder Set' })

    const assetCell = screen.getByRole('button', { name: 'Select Boy' })
    const folderCell = screen.getByRole('button', { name: 'Folder Set' })
    const dataTransfer = new DataTransfer()
    fireEvent.dragStart(assetCell, { dataTransfer })
    expect(dataTransfer.getData(ASSET_DEFINITION_MIME)).toBe('a1')
    fireEvent.drop(folderCell, { dataTransfer })

    await waitFor(() => {
      expect(backend.requests.some((r) => r.url === '/api/assets/a1' && r.method === 'PATCH')).toBe(
        true,
      )
    })
    expect(backend.assets[0].folder_id).toBe('f1')
  })

  it('moves a folder onto another folder via drag and drop', async () => {
    const backend = stubBackend({
      folders: [makeFolder(), makeFolder({ id: 'f2', name: 'Props' })],
      assets: [],
    })
    render(<AssetsPanel />)
    await screen.findByRole('button', { name: 'Folder Props' })

    const source = screen.getByRole('button', { name: 'Folder Set' })
    const target = screen.getByRole('button', { name: 'Folder Props' })
    const dataTransfer = new DataTransfer()
    fireEvent.dragStart(source, { dataTransfer })
    expect(dataTransfer.getData(ASSET_FOLDER_MIME)).toBe('f1')
    fireEvent.drop(target, { dataTransfer })

    await waitFor(() => {
      expect(
        backend.requests.some((r) => r.url === '/api/assets/folders/f1' && r.method === 'PATCH'),
      ).toBe(true)
    })
    expect(backend.folders.find((f) => f.id === 'f1')?.parent_id).toBe('f2')
  })

  it('moves an asset to a folder from the preview', async () => {
    const backend = stubBackend({
      folders: [makeFolder({ name: 'Cast' })],
      assets: [makeAsset()],
    })
    const user = userEvent.setup()
    render(<AssetsPanel />)
    await screen.findByRole('button', { name: 'Folder Cast' })

    await user.click(screen.getByRole('button', { name: 'Select Boy' }))
    const preview = screen.getByRole('region', { name: 'Asset preview' })
    await user.selectOptions(
      within(preview).getByRole('combobox', { name: 'Move asset to folder' }),
      'f1',
    )
    await user.click(within(preview).getByRole('button', { name: 'Move' }))

    await waitFor(() => {
      expect(backend.assets[0].folder_id).toBe('f1')
    })
  })

  it('keeps asset preview and scene drag payload working inside folders', async () => {
    stubBackend({
      folders: [makeFolder()],
      assets: [makeAsset({ folder_id: 'f1' })],
    })
    const user = userEvent.setup()
    render(<AssetsPanel />)
    await user.dblClick(await screen.findByRole('button', { name: 'Folder Set' }))

    const cell = await screen.findByRole('button', { name: 'Select Boy' })
    const dataTransfer = new DataTransfer()
    fireEvent.dragStart(cell, { dataTransfer })
    expect(dataTransfer.getData(ASSET_DEFINITION_MIME)).toBe('a1')

    await user.click(cell)
    expect(screen.getByRole('region', { name: 'Asset preview' })).toBeInTheDocument()
  })
})
