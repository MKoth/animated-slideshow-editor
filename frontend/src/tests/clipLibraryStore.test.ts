import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClipLibraryEntry } from '../api'
import { useClipLibraryStore } from '../stores/clipLibraryStore'
import { libraryEventBus, type LibraryEvent } from '../stores/libraryEvents'
import { useNotificationStore } from '../stores/notificationStore'

function makeClipEntry(overrides: Partial<ClipLibraryEntry> = {}): ClipLibraryEntry {
  return {
    id: 'clip-1',
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

function makeClipDefinition(
  overrides: Partial<
    ReturnType<import('../api').ClipLibraryEntry & { toJSON: () => unknown }['toJSON']>
  > = {},
): { toJSON: () => Record<string, unknown> } {
  return {
    toJSON: () => ({
      id: 'clip-1',
      name: 'Fade In',
      duration: 1,
      category: 'transition',
      params: [],
      channels: [],
      channelAnimations: {},
      ...overrides,
    }),
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

describe('clipLibraryStore', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    useClipLibraryStore.setState({
      definitions: [],
      loaded: false,
      loading: false,
      error: null,
      unavailable: false,
      selectedId: null,
    })
    useNotificationStore.setState({ notifications: [] })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('loadLibrary', () => {
    it('loads the library and exposes the definitions', async () => {
      stubFetch(() =>
        Promise.resolve(new Response(JSON.stringify([makeClipEntry()]), { status: 200 })),
      )

      await useClipLibraryStore.getState().loadLibrary()

      const state = useClipLibraryStore.getState()
      expect(state.definitions).toEqual([makeClipEntry()])
      expect(state.loaded).toBe(true)
      expect(state.loading).toBe(false)
      expect(state.unavailable).toBe(false)
    })

    it('marks the library unavailable and clears definitions when the backend is down', async () => {
      stubFetch(() => Promise.reject(new Error('connection refused')))

      await useClipLibraryStore.getState().loadLibrary()

      const state = useClipLibraryStore.getState()
      expect(state.unavailable).toBe(true)
      expect(state.definitions).toEqual([])
      expect(state.selectedId).toBeNull()
    })

    it('ignores stale list responses that resolve after a newer request', async () => {
      let releaseFirst: (response: Response) => void = () => undefined
      const firstGate = new Promise<Response>((resolve) => {
        releaseFirst = resolve
      })
      const urls: string[] = []
      stubFetch((url) => {
        if (!url.includes('/api/clips/library')) {
          return Promise.reject(new Error(url))
        }
        urls.push(url)
        if (urls.length === 1) {
          return firstGate
        }
        return Promise.resolve(
          new Response(JSON.stringify([makeClipEntry({ id: 'clip-2', name: 'Fade Out' })]), {
            status: 200,
          }),
        )
      })
      const store = useClipLibraryStore.getState()

      const first = store.loadLibrary()
      const second = store.loadLibrary()
      await second
      releaseFirst(new Response(JSON.stringify([makeClipEntry()]), { status: 200 }))
      await first

      expect(useClipLibraryStore.getState().definitions.map((d) => d.id)).toEqual(['clip-2'])
    })
  })

  describe('saveToLibrary', () => {
    it('saves a clip, adds it to the library, and emits ClipSaved', async () => {
      const entry = makeClipEntry()
      stubFetch((_url, init) => {
        if (init.method === 'POST') {
          return Promise.resolve(new Response(JSON.stringify(entry), { status: 200 }))
        }
        return Promise.reject(new Error(_url))
      })
      const events = listen()
      const clip = makeClipDefinition()

      const result = await useClipLibraryStore.getState().saveToLibrary(clip as never)

      expect(result).toEqual(entry)
      expect(useClipLibraryStore.getState().definitions).toEqual([entry])
      expect(events).toEqual([{ type: 'ClipSaved', clip: entry }])
    })

    it('notifies but keeps the library available when the create is rejected with an HTTP error', async () => {
      stubFetch(() => Promise.resolve(new Response('{}', { status: 422 })))
      const clip = makeClipDefinition()

      const result = await useClipLibraryStore.getState().saveToLibrary(clip as never)

      expect(result).toBeNull()
      expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
        'Failed to save clip to library.',
      ])
      expect(useClipLibraryStore.getState().unavailable).toBe(false)
    })

    it('notifies and marks the library unavailable when the backend is down during save', async () => {
      stubFetch(() => Promise.reject(new Error('connection refused')))
      const clip = makeClipDefinition()

      const result = await useClipLibraryStore.getState().saveToLibrary(clip as never)

      expect(result).toBeNull()
      expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
        'Failed to save clip to library — backend unavailable.',
      ])
      expect(useClipLibraryStore.getState().unavailable).toBe(true)
    })
  })

  describe('updateInLibrary', () => {
    it('updates a clip, updates the library, and emits ClipUpdated', async () => {
      const updated = makeClipEntry({ name: 'Updated Fade' })
      stubFetch((_url, init) => {
        if (init.method === 'PUT') {
          return Promise.resolve(new Response(JSON.stringify(updated), { status: 200 }))
        }
        return Promise.resolve(new Response(JSON.stringify([makeClipEntry()]), { status: 200 }))
      })
      await useClipLibraryStore.getState().loadLibrary()
      const events = listen()
      const clip = makeClipDefinition({ name: 'Updated Fade' })

      await useClipLibraryStore.getState().updateInLibrary(clip as never)

      expect(useClipLibraryStore.getState().definitions).toEqual([updated])
      expect(events).toEqual([{ type: 'ClipUpdated', clip: updated }])
    })

    it('notifies but keeps the library available when the update is rejected', async () => {
      stubFetch((_url, init) => {
        if (init.method === 'PUT') {
          return Promise.resolve(new Response('{}', { status: 404 }))
        }
        return Promise.resolve(new Response(JSON.stringify([makeClipEntry()]), { status: 200 }))
      })
      await useClipLibraryStore.getState().loadLibrary()
      const clip = makeClipDefinition()

      await useClipLibraryStore.getState().updateInLibrary(clip as never)

      expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
        'Failed to update clip in library.',
      ])
      expect(useClipLibraryStore.getState().unavailable).toBe(false)
    })

    it('marks the library unavailable when the backend is down during update', async () => {
      stubFetch((_url, init) => {
        if (init.method === 'PUT') {
          return Promise.reject(new Error('connection refused'))
        }
        return Promise.resolve(new Response(JSON.stringify([makeClipEntry()]), { status: 200 }))
      })
      await useClipLibraryStore.getState().loadLibrary()
      const clip = makeClipDefinition()

      await useClipLibraryStore.getState().updateInLibrary(clip as never)

      expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
        'Failed to update clip in library — backend unavailable.',
      ])
      expect(useClipLibraryStore.getState().unavailable).toBe(true)
    })
  })

  describe('deleteFromLibrary', () => {
    it('deletes a clip, updates the library, and emits ClipDeleted', async () => {
      stubFetch((_url, init) => {
        if (init.method === 'DELETE') {
          return Promise.resolve(new Response(null, { status: 204 }))
        }
        return Promise.resolve(
          new Response(
            JSON.stringify([makeClipEntry(), makeClipEntry({ id: 'clip-2', name: 'Fade Out' })]),
            { status: 200 },
          ),
        )
      })
      await useClipLibraryStore.getState().loadLibrary()
      useClipLibraryStore.getState().selectClip('clip-1')
      const events = listen()

      await useClipLibraryStore.getState().deleteFromLibrary('clip-1')

      expect(useClipLibraryStore.getState().definitions.map((d) => d.id)).toEqual(['clip-2'])
      expect(useClipLibraryStore.getState().selectedId).toBeNull()
      expect(events).toEqual([{ type: 'ClipDeleted', id: 'clip-1' }])
    })

    it('notifies when the backend rejects the delete and keeps the library unchanged', async () => {
      stubFetch((_url, init) => {
        if (init.method === 'DELETE') {
          return Promise.resolve(new Response('{}', { status: 500 }))
        }
        return Promise.resolve(new Response(JSON.stringify([makeClipEntry()]), { status: 200 }))
      })
      await useClipLibraryStore.getState().loadLibrary()

      await useClipLibraryStore.getState().deleteFromLibrary('clip-1')

      expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
        'Failed to delete clip from library.',
      ])
      expect(useClipLibraryStore.getState().definitions).toEqual([makeClipEntry()])
      expect(useClipLibraryStore.getState().unavailable).toBe(false)
    })

    it('marks the library unavailable when the backend is down during delete', async () => {
      stubFetch((_url, init) => {
        if (init.method === 'DELETE') {
          return Promise.reject(new Error('connection refused'))
        }
        return Promise.resolve(new Response(JSON.stringify([makeClipEntry()]), { status: 200 }))
      })
      await useClipLibraryStore.getState().loadLibrary()

      await useClipLibraryStore.getState().deleteFromLibrary('clip-1')

      expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
        'Failed to delete clip from library — backend unavailable.',
      ])
      expect(useClipLibraryStore.getState().unavailable).toBe(true)
    })
  })
})
