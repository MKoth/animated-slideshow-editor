import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MaterialDefinition } from '../api'
import { useMaterialLibraryStore } from '../stores/materialLibraryStore'
import { libraryEventBus, type LibraryEvent } from '../stores/libraryEvents'
import { useNotificationStore } from '../stores/notificationStore'

const BUILTIN_PARAMETERS = [
  { key: 'tint', kind: 'color' as const, default: '#ffffff' },
  { key: 'opacityMultiplier', kind: 'number' as const, default: 1 },
]

function makeMaterial(overrides: Partial<MaterialDefinition> = {}): MaterialDefinition {
  return {
    id: 'm1',
    name: 'Red Slime',
    description: '',
    tags: [],
    created_at: '2026-08-15T12:00:00',
    updated_at: '2026-08-15T12:00:00',
    shader_id: null,
    parameters: [...BUILTIN_PARAMETERS],
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

describe('materialLibraryStore', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    useMaterialLibraryStore.setState({
      definitions: [],
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

  it('loads the library and exposes the definitions', async () => {
    stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify([makeMaterial()]), { status: 200 })),
    )

    await useMaterialLibraryStore.getState().loadLibrary()

    const state = useMaterialLibraryStore.getState()
    expect(state.definitions).toEqual([makeMaterial()])
    expect(state.loading).toBe(false)
    expect(state.unavailable).toBe(false)
  })

  it('marks the library unavailable and clears definitions when the backend is down', async () => {
    stubFetch(() => Promise.reject(new Error('connection refused')))

    await useMaterialLibraryStore.getState().loadLibrary()

    const state = useMaterialLibraryStore.getState()
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
      if (!url.includes('/api/materials')) {
        return Promise.reject(new Error(url))
      }
      urls.push(url)
      if (urls.length === 1) {
        return firstGate
      }
      return Promise.resolve(
        new Response(JSON.stringify([makeMaterial({ id: 'm2', name: 'Blue Slime' })]), {
          status: 200,
        }),
      )
    })
    const store = useMaterialLibraryStore.getState()

    const first = store.loadLibrary()
    const second = store.loadLibrary()
    await second
    releaseFirst(new Response(JSON.stringify([makeMaterial()]), { status: 200 }))
    await first

    expect(useMaterialLibraryStore.getState().definitions.map((d) => d.id)).toEqual(['m2'])
  })

  it('creates a material, adds it to the library, and emits MaterialCreated', async () => {
    const created = makeMaterial()
    stubFetch((_url, init) => {
      if (init.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify(created), { status: 200 }))
      }
      return Promise.reject(new Error(_url))
    })
    const events = listen()

    const result = await useMaterialLibraryStore.getState().createMaterial({ name: 'Red Slime' })

    expect(result).toEqual(created)
    expect(useMaterialLibraryStore.getState().definitions).toEqual([created])
    expect(events).toEqual([{ type: 'MaterialCreated', material: created }])
  })

  it('duplicates a material, adds the copy, and emits MaterialCreated', async () => {
    const copy = makeMaterial({ id: 'm2', name: 'Red Slime Copy' })
    stubFetch((_url, init) => {
      if (init.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify(copy), { status: 200 }))
      }
      return Promise.reject(new Error(_url))
    })
    const events = listen()

    const result = await useMaterialLibraryStore
      .getState()
      .duplicateMaterial('m1', 'Red Slime Copy')

    expect(result).toEqual(copy)
    expect(useMaterialLibraryStore.getState().definitions).toEqual([copy])
    expect(events).toEqual([{ type: 'MaterialCreated', material: copy }])
  })

  it('renames a material, updates the library, and emits MaterialRenamed', async () => {
    const renamed = makeMaterial({ name: 'Renamed Slime' })
    stubFetch((_url, init) => {
      if (init.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify(renamed), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([makeMaterial()]), { status: 200 }))
    })
    await useMaterialLibraryStore.getState().loadLibrary()
    const events = listen()

    await useMaterialLibraryStore.getState().renameMaterial('m1', 'Renamed Slime')

    expect(useMaterialLibraryStore.getState().definitions).toEqual([renamed])
    expect(events).toEqual([{ type: 'MaterialRenamed', material: renamed }])
  })

  it('updates parameter defaults, updates the library, and emits MaterialUpdated', async () => {
    const updated = makeMaterial({
      parameters: [
        { key: 'tint', kind: 'color', default: '#00ff00' },
        { key: 'opacityMultiplier', kind: 'number', default: 0.5 },
      ],
    })
    stubFetch((_url, init) => {
      if (init.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify(updated), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([makeMaterial()]), { status: 200 }))
    })
    await useMaterialLibraryStore.getState().loadLibrary()
    const events = listen()

    await useMaterialLibraryStore
      .getState()
      .updateMaterial('m1', { parameters: updated.parameters })

    expect(useMaterialLibraryStore.getState().definitions).toEqual([updated])
    expect(events).toEqual([{ type: 'MaterialUpdated', material: updated }])
  })

  it('deletes a material, updates the library, and emits MaterialRemoved', async () => {
    stubFetch((_url, init) => {
      if (init.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(
        new Response(
          JSON.stringify([makeMaterial(), makeMaterial({ id: 'm2', name: 'Blue Slime' })]),
          { status: 200 },
        ),
      )
    })
    await useMaterialLibraryStore.getState().loadLibrary()
    useMaterialLibraryStore.getState().selectMaterial('m1')
    const events = listen()

    await useMaterialLibraryStore.getState().deleteMaterial('m1')

    expect(useMaterialLibraryStore.getState().definitions.map((d) => d.id)).toEqual(['m2'])
    expect(useMaterialLibraryStore.getState().selectedId).toBeNull()
    expect(events).toEqual([{ type: 'MaterialRemoved', id: 'm1' }])
  })

  it('assigns a shader to a material, updates the library, and emits MaterialUpdated', async () => {
    const withShader = makeMaterial({
      shader_id: 'shader-1',
      parameters: [...BUILTIN_PARAMETERS, { key: 'uIntensity', kind: 'float', default: 0.5 }],
    })
    stubFetch((_url, init) => {
      if (init.method === 'PUT' && String(_url).endsWith('/shader')) {
        return Promise.resolve(new Response(JSON.stringify(withShader), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([makeMaterial()]), { status: 200 }))
    })
    await useMaterialLibraryStore.getState().loadLibrary()
    const events = listen()

    await useMaterialLibraryStore.getState().assignShader('m1', 'shader-1')

    expect(useMaterialLibraryStore.getState().definitions).toEqual([withShader])
    expect(events).toEqual([{ type: 'MaterialUpdated', material: withShader }])
  })

  it('removes a shader from a material by assigning null and emits MaterialUpdated', async () => {
    const withoutShader = makeMaterial()
    stubFetch((_url, init) => {
      if (init.method === 'PUT' && String(_url).endsWith('/shader')) {
        return Promise.resolve(new Response(JSON.stringify(withoutShader), { status: 200 }))
      }
      return Promise.resolve(
        new Response(JSON.stringify([makeMaterial({ shader_id: 'shader-1' })]), { status: 200 }),
      )
    })
    await useMaterialLibraryStore.getState().loadLibrary()
    const events = listen()

    await useMaterialLibraryStore.getState().assignShader('m1', null)

    expect(useMaterialLibraryStore.getState().definitions).toEqual([withoutShader])
    expect(events).toEqual([{ type: 'MaterialUpdated', material: withoutShader }])
  })

  it('notifies but keeps the library available when the shader assign is rejected', async () => {
    stubFetch((_url, init) => {
      if (init.method === 'PUT' && String(_url).endsWith('/shader')) {
        return Promise.resolve(new Response('{}', { status: 404 }))
      }
      return Promise.resolve(new Response(JSON.stringify([makeMaterial()]), { status: 200 }))
    })
    await useMaterialLibraryStore.getState().loadLibrary()

    await useMaterialLibraryStore.getState().assignShader('m1', 'ghost')

    expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
      'Material update failed.',
    ])
    expect(useMaterialLibraryStore.getState().unavailable).toBe(false)
    expect(useMaterialLibraryStore.getState().definitions).toEqual([makeMaterial()])
  })

  it('refreshes materials after a shader uniform update and emits MaterialUpdated for changed ones', async () => {
    const unchanged = makeMaterial({ id: 'm2', name: 'Blue Slime' })
    const reseeded = makeMaterial({
      parameters: [...BUILTIN_PARAMETERS, { key: 'uIntensity', kind: 'float', default: 0.9 }],
    })
    let listCalls = 0
    stubFetch((_url, init) => {
      if (init.method === undefined) {
        listCalls += 1
        const body = listCalls === 1 ? [makeMaterial(), unchanged] : [reseeded, unchanged]
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
      }
      return Promise.reject(new Error(_url))
    })
    await useMaterialLibraryStore.getState().loadLibrary()
    const events = listen()

    await useMaterialLibraryStore.getState().refreshAfterShaderUniformUpdate()

    expect(useMaterialLibraryStore.getState().definitions).toEqual([reseeded, unchanged])
    expect(events).toEqual([{ type: 'MaterialUpdated', material: reseeded }])
  })

  it('marks the library unavailable when the refresh after a uniform update fails', async () => {
    stubFetch(() => Promise.reject(new Error('connection refused')))
    await useMaterialLibraryStore.getState().loadLibrary()

    await useMaterialLibraryStore.getState().refreshAfterShaderUniformUpdate()

    expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
      'Material update failed — backend unavailable.',
    ])
    expect(useMaterialLibraryStore.getState().unavailable).toBe(true)
  })

  it('deletes a material referenced by the open project without refusal', async () => {
    const deletions: number[] = []
    stubFetch((_url, init) => {
      if (init.method === 'DELETE') {
        deletions.push(1)
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(new Response(JSON.stringify([makeMaterial()]), { status: 200 }))
    })
    await useMaterialLibraryStore.getState().loadLibrary()
    const events = listen()

    await useMaterialLibraryStore.getState().deleteMaterial('m1')

    expect(useNotificationStore.getState().notifications).toEqual([])
    expect(useMaterialLibraryStore.getState().definitions).toEqual([])
    expect(events).toEqual([{ type: 'MaterialRemoved', id: 'm1' }])
    expect(deletions).toEqual([1])
  })

  it('notifies but keeps the library available when the create is rejected with an HTTP error', async () => {
    stubFetch(() => Promise.resolve(new Response('{}', { status: 422 })))

    const result = await useMaterialLibraryStore.getState().createMaterial({ name: 'Bad' })

    expect(result).toBeNull()
    expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
      'Material create failed.',
    ])
    expect(useMaterialLibraryStore.getState().unavailable).toBe(false)
  })

  it('notifies and marks the library unavailable when the backend is down during create', async () => {
    stubFetch(() => Promise.reject(new Error('connection refused')))

    const result = await useMaterialLibraryStore.getState().createMaterial({ name: 'Bad' })

    expect(result).toBeNull()
    expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
      'Material create failed — backend unavailable.',
    ])
    expect(useMaterialLibraryStore.getState().unavailable).toBe(true)
  })

  it('notifies when the backend rejects the delete and keeps the library unchanged', async () => {
    stubFetch((_url, init) => {
      if (init.method === 'DELETE') {
        return Promise.resolve(new Response('{}', { status: 500 }))
      }
      return Promise.resolve(new Response(JSON.stringify([makeMaterial()]), { status: 200 }))
    })
    await useMaterialLibraryStore.getState().loadLibrary()

    await useMaterialLibraryStore.getState().deleteMaterial('m1')

    expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
      'Material delete failed.',
    ])
    expect(useMaterialLibraryStore.getState().definitions).toEqual([makeMaterial()])
    expect(useMaterialLibraryStore.getState().unavailable).toBe(false)
  })

  it('marks the library unavailable when the backend is down during delete', async () => {
    stubFetch((_url, init) => {
      if (init.method === 'DELETE') {
        return Promise.reject(new Error('connection refused'))
      }
      return Promise.resolve(new Response(JSON.stringify([makeMaterial()]), { status: 200 }))
    })
    await useMaterialLibraryStore.getState().loadLibrary()

    await useMaterialLibraryStore.getState().deleteMaterial('m1')

    expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
      'Material delete failed — backend unavailable.',
    ])
    expect(useMaterialLibraryStore.getState().unavailable).toBe(true)
  })
})
