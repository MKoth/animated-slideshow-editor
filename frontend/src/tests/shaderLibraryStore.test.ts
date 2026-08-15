import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShaderDefinition } from '../api'
import { useShaderLibraryStore } from '../stores/shaderLibraryStore'
import { libraryEventBus, type LibraryEvent } from '../stores/libraryEvents'
import { useNotificationStore } from '../stores/notificationStore'

const SOURCE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
out vec4 fragColor;
void main() {
  vec4 color = texture(uTexture, vUv);
  fragColor = color;
}
`

function makeShader(overrides: Partial<ShaderDefinition> = {}): ShaderDefinition {
  return {
    id: 's1',
    name: 'Ink Wash',
    description: '',
    tags: [],
    created_at: '2026-08-15T12:00:00',
    updated_at: '2026-08-15T12:00:00',
    source: SOURCE,
    default_uniforms: [],
    is_builtin: false,
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

describe('shaderLibraryStore', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    useShaderLibraryStore.setState({
      definitions: [],
      loading: false,
      error: null,
      unavailable: false,
      selectedId: null,
      compileStatus: {},
    })
    useNotificationStore.setState({ notifications: [] })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the library and exposes the definitions', async () => {
    stubFetch(() => Promise.resolve(new Response(JSON.stringify([makeShader()]), { status: 200 })))

    await useShaderLibraryStore.getState().loadLibrary()

    const state = useShaderLibraryStore.getState()
    expect(state.definitions).toEqual([makeShader()])
    expect(state.loading).toBe(false)
    expect(state.unavailable).toBe(false)
  })

  it('marks the library unavailable and clears definitions when the backend is down', async () => {
    stubFetch(() => Promise.reject(new Error('connection refused')))

    await useShaderLibraryStore.getState().loadLibrary()

    const state = useShaderLibraryStore.getState()
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
      if (!url.includes('/api/shaders')) {
        return Promise.reject(new Error(url))
      }
      urls.push(url)
      if (urls.length === 1) {
        return firstGate
      }
      return Promise.resolve(
        new Response(JSON.stringify([makeShader({ id: 's2', name: 'Blue Wash' })]), {
          status: 200,
        }),
      )
    })
    const store = useShaderLibraryStore.getState()

    const first = store.loadLibrary()
    const second = store.loadLibrary()
    await second
    releaseFirst(new Response(JSON.stringify([makeShader()]), { status: 200 }))
    await first

    expect(useShaderLibraryStore.getState().definitions.map((d) => d.id)).toEqual(['s2'])
  })

  it('imports a shader, adds it to the library, and emits ShaderCreated', async () => {
    const created = makeShader()
    stubFetch((_url, init) => {
      if (init.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify(created), { status: 200 }))
      }
      return Promise.reject(new Error(_url))
    })
    const events = listen()

    const result = await useShaderLibraryStore
      .getState()
      .importShader(new File([SOURCE], 'wash.glsl'))

    expect(result).toEqual(created)
    expect(useShaderLibraryStore.getState().definitions).toEqual([created])
    expect(events).toEqual([{ type: 'ShaderCreated', shader: created }])
  })

  it('duplicates a shader, adds the copy, and emits ShaderCreated', async () => {
    const copy = makeShader({ id: 's2', name: 'Ink Wash Copy' })
    stubFetch((_url, init) => {
      if (init.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify(copy), { status: 200 }))
      }
      return Promise.reject(new Error(_url))
    })
    const events = listen()

    const result = await useShaderLibraryStore.getState().duplicateShader('s1', 'Ink Wash Copy')

    expect(result).toEqual(copy)
    expect(useShaderLibraryStore.getState().definitions).toEqual([copy])
    expect(events).toEqual([{ type: 'ShaderCreated', shader: copy }])
  })

  it('renames a shader, updates the library, and emits ShaderRenamed', async () => {
    const renamed = makeShader({ name: 'Renamed Wash' })
    stubFetch((_url, init) => {
      if (init.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify(renamed), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([makeShader()]), { status: 200 }))
    })
    await useShaderLibraryStore.getState().loadLibrary()
    const events = listen()

    await useShaderLibraryStore.getState().renameShader('s1', 'Renamed Wash')

    expect(useShaderLibraryStore.getState().definitions).toEqual([renamed])
    expect(events).toEqual([{ type: 'ShaderRenamed', shader: renamed }])
  })

  it('re-uploads the source, replaces the definition, and emits ShaderUpdated', async () => {
    const replacement = SOURCE.replace(
      'fragColor = color;',
      'fragColor = vec4(1.0 - color.rgb, color.a);',
    )
    const updated = makeShader({ source: replacement })
    stubFetch((_url, init) => {
      if (init.method === 'PUT' && String(_url).endsWith('/source')) {
        return Promise.resolve(new Response(JSON.stringify(updated), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify([makeShader()]), { status: 200 }))
    })
    await useShaderLibraryStore.getState().loadLibrary()
    const events = listen()

    await useShaderLibraryStore.getState().reuploadSource('s1', new File([replacement], 'w.glsl'))

    expect(useShaderLibraryStore.getState().definitions).toEqual([updated])
    expect(useShaderLibraryStore.getState().definitions[0].source).toBe(replacement)
    expect(events).toEqual([{ type: 'ShaderUpdated', shader: updated }])
  })

  it('deletes a shader, updates the library, and emits ShaderRemoved', async () => {
    stubFetch((_url, init) => {
      if (init.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(
        new Response(JSON.stringify([makeShader(), makeShader({ id: 's2', name: 'Blue Wash' })]), {
          status: 200,
        }),
      )
    })
    await useShaderLibraryStore.getState().loadLibrary()
    useShaderLibraryStore.getState().selectShader('s1')
    const events = listen()

    await useShaderLibraryStore.getState().deleteShader('s1')

    expect(useShaderLibraryStore.getState().definitions.map((d) => d.id)).toEqual(['s2'])
    expect(useShaderLibraryStore.getState().selectedId).toBeNull()
    expect(events).toEqual([{ type: 'ShaderRemoved', id: 's1' }])
  })

  it('notifies but keeps the library available when the import is rejected with an HTTP error', async () => {
    stubFetch(() => Promise.resolve(new Response('{}', { status: 422 })))

    const result = await useShaderLibraryStore
      .getState()
      .importShader(new File([SOURCE], 'bad.glsl'))

    expect(result).toBeNull()
    expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
      'Shader import failed.',
    ])
    expect(useShaderLibraryStore.getState().unavailable).toBe(false)
  })

  it('notifies and marks the library unavailable when the backend is down during import', async () => {
    stubFetch(() => Promise.reject(new Error('connection refused')))

    const result = await useShaderLibraryStore
      .getState()
      .importShader(new File([SOURCE], 'bad.glsl'))

    expect(result).toBeNull()
    expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
      'Shader import failed — backend unavailable.',
    ])
    expect(useShaderLibraryStore.getState().unavailable).toBe(true)
  })

  it('notifies when the backend rejects the delete and keeps the library unchanged', async () => {
    stubFetch((_url, init) => {
      if (init.method === 'DELETE') {
        return Promise.resolve(new Response('{}', { status: 500 }))
      }
      return Promise.resolve(new Response(JSON.stringify([makeShader()]), { status: 200 }))
    })
    await useShaderLibraryStore.getState().loadLibrary()

    await useShaderLibraryStore.getState().deleteShader('s1')

    expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
      'Shader delete failed.',
    ])
    expect(useShaderLibraryStore.getState().definitions).toEqual([makeShader()])
    expect(useShaderLibraryStore.getState().unavailable).toBe(false)
  })

  it('marks the library unavailable when the backend is down during delete', async () => {
    stubFetch((_url, init) => {
      if (init.method === 'DELETE') {
        return Promise.reject(new Error('connection refused'))
      }
      return Promise.resolve(new Response(JSON.stringify([makeShader()]), { status: 200 }))
    })
    await useShaderLibraryStore.getState().loadLibrary()

    await useShaderLibraryStore.getState().deleteShader('s1')

    expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual([
      'Shader delete failed — backend unavailable.',
    ])
    expect(useShaderLibraryStore.getState().unavailable).toBe(true)
  })
})
