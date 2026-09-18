import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetFolder } from '../api/assetsApi'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'
import { useNotificationStore } from '../stores/notificationStore'

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

function resetStore() {
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
}

describe('assetLibraryStore folders', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn())
    resetStore()
    useNotificationStore.setState({ notifications: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function stubFetch(handler: (url: string, init: RequestInit) => Promise<Response>): void {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      handler(String(input), init ?? {}),
    )
  }

  it('scopes the library to root when browsing without search', async () => {
    const urls: string[] = []
    stubFetch((url) => {
      urls.push(url)
      if (url.startsWith('/api/assets/folders')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    })

    await useAssetLibraryStore.getState().loadLibrary()

    const params = Object.fromEntries(new URLSearchParams(urls[0].split('?')[1]))
    expect(params.folder_id).toBe('root')
  })

  it('searches globally at root but scoped inside a folder', async () => {
    const urls: string[] = []
    stubFetch((url) => {
      urls.push(url)
      if (url.startsWith('/api/assets/folders')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    })

    useAssetLibraryStore.getState().setSearch('fox')
    await vi.advanceTimersByTimeAsync(300)
    const globalParams = Object.fromEntries(
      new URLSearchParams(urls[urls.length - 1].split('?')[1]),
    )
    expect(globalParams.search).toBe('fox')
    expect('folder_id' in globalParams).toBe(false)

    urls.length = 0
    useAssetLibraryStore.getState().setCurrentFolder('f1')
    await vi.advanceTimersByTimeAsync(0)
    const scopedParams = Object.fromEntries(
      new URLSearchParams(urls[urls.length - 1].split('?')[1]),
    )
    expect(scopedParams.folder_id).toBe('f1')
    expect(scopedParams.search).toBe('fox')
  })

  it('loads folders into the store', async () => {
    stubFetch((url) => {
      if (url.startsWith('/api/assets/folders')) {
        return Promise.resolve(new Response(JSON.stringify([makeFolder()]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    })

    await useAssetLibraryStore.getState().loadFolders()

    expect(useAssetLibraryStore.getState().folders).toEqual([makeFolder()])
  })

  it('uploads into the current folder', async () => {
    const postedForms: FormData[] = []
    stubFetch((_url, init) => {
      if (init.method === 'POST') {
        postedForms.push(init.body as FormData)
        return Promise.resolve(
          new Response(JSON.stringify({ created: [], errors: [] }), { status: 200 }),
        )
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    })
    useAssetLibraryStore.setState({ currentFolderId: 'f1' })

    await useAssetLibraryStore
      .getState()
      .importFiles([new File(['x'], 'boy.png', { type: 'image/png' })])

    expect(postedForms[0]?.get('folder_id')).toBe('f1')
  })

  it('creates a folder under the current folder and reloads', async () => {
    const calls: Array<{ url: string; method?: string }> = []
    stubFetch((url, init) => {
      calls.push({ url, method: init.method })
      if (url === '/api/assets/folders' && init.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify(makeFolder({ name: 'New' })), { status: 201 }),
        )
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    })
    useAssetLibraryStore.setState({ currentFolderId: 'f1' })

    const folder = await useAssetLibraryStore.getState().createFolder('New')

    expect(folder?.name).toBe('New')
    const post = calls.find((call) => call.method === 'POST')
    expect(post?.url).toBe('/api/assets/folders')
  })

  it('moves an asset and refreshes the library', async () => {
    const patched: Array<{ url: string; body: unknown }> = []
    stubFetch((url, init) => {
      if (init.method === 'PATCH') {
        patched.push({ url, body: JSON.parse(init.body as string) })
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'a1', folder_id: 'f1' }), { status: 200 }),
        )
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    })

    await useAssetLibraryStore.getState().moveAsset('a1', 'f1')

    expect(patched).toEqual([{ url: '/api/assets/a1', body: { folder_id: 'f1' } }])
  })

  it('deletes the current folder and navigates to its parent', async () => {
    stubFetch((_url, init) => {
      if (init.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    })
    useAssetLibraryStore.setState({
      folders: [makeFolder({ id: 'parent' }), makeFolder({ id: 'f1', parent_id: 'parent' })],
      currentFolderId: 'f1',
    })

    await useAssetLibraryStore.getState().deleteFolder('f1')

    expect(useAssetLibraryStore.getState().currentFolderId).toBe('parent')
  })

  it('notifies on folder failure without marking unavailable for HTTP errors', async () => {
    stubFetch(() => Promise.resolve(new Response('{}', { status: 409 })))

    const folder = await useAssetLibraryStore.getState().createFolder('Dup')

    expect(folder).toBeNull()
    expect(useNotificationStore.getState().notifications.map((n) => n.message)[0]).toMatch(
      /Folder operation failed/,
    )
    expect(useAssetLibraryStore.getState().unavailable).toBe(false)
  })
})
