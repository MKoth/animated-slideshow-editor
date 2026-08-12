import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetDefinition } from '../api'
import { useAssetLibraryStore, registerAssetUsageCounter } from '../stores/assetLibraryStore'
import { libraryEventBus, type LibraryEvent } from '../stores/libraryEvents'
import { useNotificationStore } from '../stores/notificationStore'

function makeDefinition(overrides: Partial<AssetDefinition> = {}): AssetDefinition {
  return {
    id: 'a1',
    name: 'Boy',
    description: '',
    category: 'Uncategorized',
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
    ...overrides,
  }
}

function stubFetch(handler: (url: string, init: RequestInit) => Promise<Response>): void {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init ?? {}),
  )
}

function listen(): LibraryEvent[] {
  const received: LibraryEvent[] = []
  libraryEventBus.subscribe((event) => received.push(event))
  return received
}

describe('assetLibraryStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
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

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('loads the library and exposes the definitions', async () => {
    stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify([makeDefinition()]), { status: 200 })),
    )

    await useAssetLibraryStore.getState().loadLibrary()

    const state = useAssetLibraryStore.getState()
    expect(state.definitions).toEqual([makeDefinition()])
    expect(state.loading).toBe(false)
    expect(state.unavailable).toBe(false)
  })

  it('marks the library unavailable and clears definitions when the backend is down', async () => {
    stubFetch(() => Promise.reject(new Error('connection refused')))

    await useAssetLibraryStore.getState().loadLibrary()

    const state = useAssetLibraryStore.getState()
    expect(state.unavailable).toBe(true)
    expect(state.definitions).toEqual([])
    expect(state.selectedId).toBeNull()
  })

  it('applies the search after a debounce and reloads from the server', async () => {
    const urls: string[] = []
    stubFetch((url) => {
      if (url.includes('/api/assets')) {
        urls.push(url)
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.reject(new Error(url))
    })
    await useAssetLibraryStore.getState().loadLibrary()

    useAssetLibraryStore.getState().setSearch('boy')

    expect(useAssetLibraryStore.getState().search).toBe('boy')
    expect(urls).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(300)

    expect(urls).toHaveLength(2)
    const params = Object.fromEntries(new URLSearchParams(urls[1].split('?')[1]))
    expect(params.search).toBe('boy')
  })

  it('collapses rapid search input into a single reload', async () => {
    const urls: string[] = []
    stubFetch((url) => {
      if (url.includes('/api/assets')) {
        urls.push(url)
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.reject(new Error(url))
    })
    await useAssetLibraryStore.getState().loadLibrary()

    useAssetLibraryStore.getState().setSearch('b')
    await vi.advanceTimersByTimeAsync(100)
    useAssetLibraryStore.getState().setSearch('bo')
    await vi.advanceTimersByTimeAsync(100)
    useAssetLibraryStore.getState().setSearch('boy')
    await vi.advanceTimersByTimeAsync(300)

    expect(urls).toHaveLength(2)
  })

  it('reloads once with the new sort key and order', async () => {
    const urls: string[] = []
    stubFetch((url) => {
      if (url.includes('/api/assets')) {
        urls.push(url)
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.reject(new Error(url))
    })
    await useAssetLibraryStore.getState().loadLibrary()

    useAssetLibraryStore.getState().setSorting('name', 'asc')

    await vi.advanceTimersByTimeAsync(0)
    expect(urls).toHaveLength(2)
    const params = Object.fromEntries(new URLSearchParams(urls[1].split('?')[1]))
    expect(params.sort).toBe('name')
    expect(params.order).toBe('asc')
    expect(useAssetLibraryStore.getState().sort).toBe('name')
    expect(useAssetLibraryStore.getState().order).toBe('asc')
  })

  it('ignores stale list responses that resolve after a newer request', async () => {
    let releaseFirst: (response: Response) => void = () => undefined
    const firstGate = new Promise<Response>((resolve) => {
      releaseFirst = resolve
    })
    const urls: string[] = []
    stubFetch((url) => {
      if (!url.includes('/api/assets')) {
        return Promise.reject(new Error(url))
      }
      urls.push(url)
      if (urls.length === 1) {
        return firstGate
      }
      return Promise.resolve(
        new Response(JSON.stringify([makeDefinition({ id: 'a2', name: 'Girl' })]), {
          status: 200,
        }),
      )
    })
    const store = useAssetLibraryStore.getState()

    const first = store.loadLibrary()
    const second = store.loadLibrary()
    await second
    releaseFirst(new Response(JSON.stringify([makeDefinition()]), { status: 200 }))
    await first

    expect(useAssetLibraryStore.getState().definitions.map((d) => d.id)).toEqual(['a2'])
  })

  it('imports files, emits AssetImported per created asset, and refreshes the library', async () => {
    const created = makeDefinition()
    stubFetch((_url, init) => {
      if (init.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ created: [created], errors: [] }), { status: 200 }),
        )
      }
      return Promise.resolve(new Response(JSON.stringify([created]), { status: 200 }))
    })
    const events = listen()

    const result = await useAssetLibraryStore
      .getState()
      .importFiles([new File(['x'], 'boy.png', { type: 'image/png' })])

    expect(result.created).toEqual([created])
    expect(events).toEqual([{ type: 'AssetImported', asset: created }])
    expect(useAssetLibraryStore.getState().definitions).toEqual([created])
  })

  it('surfaces per-file import errors as notifications', async () => {
    stubFetch((_url, init) => {
      if (init.method === 'POST') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              created: [],
              errors: [
                {
                  filename: 'broken.png',
                  error: 'corrupt or unreadable image file',
                },
              ],
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    })

    await useAssetLibraryStore
      .getState()
      .importFiles([new File(['x'], 'broken.png', { type: 'image/png' })])

    expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
      'broken.png: corrupt or unreadable image file',
    ])
    expect(useAssetLibraryStore.getState().definitions).toEqual([])
  })

  it('notifies but keeps the library available when the upload is rejected with an HTTP error', async () => {
    stubFetch(() => Promise.resolve(new Response('{}', { status: 422 })))

    const result = await useAssetLibraryStore
      .getState()
      .importFiles([new File(['x'], 'boy.png', { type: 'image/png' })])

    expect(result).toEqual({ created: [], errors: [] })
    expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
      'Asset import failed.',
    ])
    expect(useAssetLibraryStore.getState().unavailable).toBe(false)
  })

  it('notifies and marks the library unavailable when the backend is down during import', async () => {
    stubFetch(() => Promise.reject(new Error('connection refused')))

    const result = await useAssetLibraryStore
      .getState()
      .importFiles([new File(['x'], 'boy.png', { type: 'image/png' })])

    expect(result).toEqual({ created: [], errors: [] })
    expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
      'Asset import failed — backend unavailable.',
    ])
    expect(useAssetLibraryStore.getState().unavailable).toBe(true)
  })

  it('deletes an asset, updates the library, and emits AssetDeleted', async () => {
    stubFetch((_url, init) => {
      if (init.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(
        new Response(
          JSON.stringify([makeDefinition(), makeDefinition({ id: 'a2', name: 'Girl' })]),
          {
            status: 200,
          },
        ),
      )
    })
    await useAssetLibraryStore.getState().loadLibrary()
    useAssetLibraryStore.getState().selectAsset('a1')
    const events = listen()

    await useAssetLibraryStore.getState().deleteAsset('a1')

    expect(useAssetLibraryStore.getState().definitions.map((d) => d.id)).toEqual(['a2'])
    expect(useAssetLibraryStore.getState().selectedId).toBeNull()
    expect(events).toEqual([{ type: 'AssetDeleted', id: 'a1' }])
  })

  it('refuses to delete an asset referenced by the open project and names the usage', async () => {
    const deletions: number[] = []
    stubFetch((_url, init) => {
      if (init.method === 'DELETE') {
        deletions.push(1)
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(new Response(JSON.stringify([makeDefinition()]), { status: 200 }))
    })
    await useAssetLibraryStore.getState().loadLibrary()
    useAssetLibraryStore.getState().selectAsset('a1')
    registerAssetUsageCounter(() => 3)
    const events = listen()

    await useAssetLibraryStore.getState().deleteAsset('a1')

    expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
      'Used by 3 objects',
    ])
    expect(useAssetLibraryStore.getState().definitions).toEqual([makeDefinition()])
    expect(useAssetLibraryStore.getState().selectedId).toBe('a1')
    expect(events).toEqual([])
    expect(deletions).toEqual([])
  })

  it('refuses deletion of a single reference with singular wording', async () => {
    stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify([makeDefinition()]), { status: 200 })),
    )
    await useAssetLibraryStore.getState().loadLibrary()
    registerAssetUsageCounter(() => 1)

    await useAssetLibraryStore.getState().deleteAsset('a1')

    expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
      'Used by 1 object',
    ])
    expect(useAssetLibraryStore.getState().definitions).toEqual([makeDefinition()])
  })

  it('notifies when the backend rejects the delete and keeps the library unchanged', async () => {
    stubFetch((_url, init) => {
      if (init.method === 'DELETE') {
        return Promise.resolve(new Response('{}', { status: 500 }))
      }
      return Promise.resolve(new Response(JSON.stringify([makeDefinition()]), { status: 200 }))
    })
    await useAssetLibraryStore.getState().loadLibrary()

    await useAssetLibraryStore.getState().deleteAsset('a1')

    expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
      'Asset delete failed.',
    ])
    expect(useAssetLibraryStore.getState().definitions).toEqual([makeDefinition()])
    expect(useAssetLibraryStore.getState().unavailable).toBe(false)
  })

  it('marks the library unavailable when the backend is down during delete', async () => {
    stubFetch((_url, init) => {
      if (init.method === 'DELETE') {
        return Promise.reject(new Error('connection refused'))
      }
      return Promise.resolve(new Response(JSON.stringify([makeDefinition()]), { status: 200 }))
    })
    await useAssetLibraryStore.getState().loadLibrary()

    await useAssetLibraryStore.getState().deleteAsset('a1')

    expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
      'Asset delete failed — backend unavailable.',
    ])
    expect(useAssetLibraryStore.getState().unavailable).toBe(true)
  })
})
