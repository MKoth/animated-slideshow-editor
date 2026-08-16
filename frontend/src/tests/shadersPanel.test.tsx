import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetDefinition, ShaderDefinition } from '../api'
import { ShadersPanel } from '../components/panels/ShadersPanel'
import { setWebGL2ContextFactory } from '../shaders/compiler'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'
import { useNotificationStore } from '../stores/notificationStore'
import { useShaderLibraryStore } from '../stores/shaderLibraryStore'
import type { FakeApplication, FakeContainer, FakeSprite } from './renderer/pixiFake'
import { pixiRegistry, resetShaderRegistries } from './renderer/pixiFake'
import { createWebGLFake, type FakeWebGL2Context } from './shaders/webglFake'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./renderer/pixiFake')
  return createPixiFake()
})

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

const SOURCE_WITH_UNIFORMS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
uniform float uIntensity;
uniform vec3 uTint;
out vec4 fragColor;
void main() {
  vec4 color = texture(uTexture, vUv);
  fragColor = color * uIntensity * vec4(uTint, 1.0);
}
`

const ASSET: AssetDefinition = {
  id: 'asset-1',
  name: 'Portrait',
  description: '',
  category: 'Character',
  tags: [],
  ai_description: '',
  original_filename: 'portrait.png',
  import_date: '2026-08-15',
  width: 100,
  height: 100,
  file_size: 1000,
  aspect_ratio: 1,
  default_scale: 1,
  default_rotation: 0,
  pivot: { x: 0.5, y: 0.5 },
  anchors: [],
  original_url: '/media/portrait.png',
  thumbnail_url: '/media/portrait-thumb.png',
}

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

function stubLibrary(definitions: ShaderDefinition[]): void {
  stubFetch((url) => {
    if (url.includes('/api/shaders')) {
      return Promise.resolve(new Response(JSON.stringify(definitions), { status: 200 }))
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  })
}

function stubBackendDown(): void {
  stubFetch(() => Promise.reject(new Error('connection refused')))
}

function renderPanel() {
  return render(<ShadersPanel />)
}

function previewLayer(app: FakeApplication): FakeContainer {
  const layer = app.stage.children.find((child) => child.label === 'shader-preview-layer')
  if (!layer) {
    throw new Error('expected the shader preview layer')
  }
  return layer as FakeContainer
}

function previewSprite(layer: FakeContainer, id: string): FakeSprite | undefined {
  return layer.children.find((child) => child.label === `shader-preview:${id}`) as
    FakeSprite | undefined
}

async function waitForStageApp(): Promise<FakeApplication> {
  return waitFor(() => {
    const app = pixiRegistry.applications[0]
    if (!app) {
      throw new Error('expected the preview stage to start')
    }
    return app
  })
}

let gl: FakeWebGL2Context

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  pixiRegistry.reset()
  resetShaderRegistries()
  gl = createWebGLFake()
  setWebGL2ContextFactory(() => gl)
  useShaderLibraryStore.setState({
    definitions: [],
    compileStatus: {},
    reflections: {},
    loaded: false,
    loading: false,
    error: null,
    unavailable: false,
    selectedId: null,
  })
  useAssetLibraryStore.setState({
    definitions: [],
    loaded: false,
    loading: false,
    error: null,
    unavailable: false,
    selectedId: null,
    search: '',
    sort: 'name',
    order: 'asc',
  })
  useNotificationStore.setState({ notifications: [] })
})

afterEach(() => {
  setWebGL2ContextFactory(null)
  vi.unstubAllGlobals()
})

describe('ShadersPanel states', () => {
  it('shows the empty state with the canonical message when the library is empty', async () => {
    stubLibrary([])
    renderPanel()

    expect(
      await screen.findByText(
        'No shaders imported. Import a .glsl fragment shader to get started.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import Shader' })).toBeEnabled()
  })

  it('shows the unavailable state and disables import and search when the backend is down', async () => {
    stubBackendDown()
    renderPanel()

    expect(
      await screen.findByText('Shader library unavailable — start the backend'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import Shader' })).toBeDisabled()
    expect(screen.getByRole('searchbox', { name: 'Search shaders' })).toBeDisabled()
  })

  it('shows the loading state while the library loads', async () => {
    let release!: (response: Response) => void
    const gate = new Promise<Response>((resolve) => {
      release = resolve
    })
    stubFetch(() => gate)
    renderPanel()

    expect(await screen.findByText('Loading library…')).toBeInTheDocument()

    release(new Response(JSON.stringify([]), { status: 200 }))
    expect(
      await screen.findByText(
        'No shaders imported. Import a .glsl fragment shader to get started.',
      ),
    ).toBeInTheDocument()
  })

  it('recovers from the unavailable state when the backend returns', async () => {
    stubFetch(() => Promise.reject(new Error('connection refused')))
    renderPanel()
    expect(
      await screen.findByText('Shader library unavailable — start the backend'),
    ).toBeInTheDocument()

    stubLibrary([makeShader()])
    await useShaderLibraryStore.getState().loadLibrary()

    expect(await screen.findByRole('button', { name: 'Select Ink Wash' })).toBeInTheDocument()
  })
})

describe('ShadersPanel grid and badges', () => {
  it('renders a cell per definition with its name and a Compiled badge', async () => {
    stubLibrary([
      makeShader({ id: 's1', name: 'Ink Wash' }),
      makeShader({ id: 's2', name: 'Sepia Glow' }),
    ])
    renderPanel()

    expect(await screen.findByRole('button', { name: 'Select Ink Wash' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select Sepia Glow' })).toBeInTheDocument()
    expect(screen.getAllByText('Compiled')).toHaveLength(2)
  })

  it('shows a Failed badge with the error count and skips the mini-render for failed shaders', async () => {
    stubLibrary([
      makeShader({ id: 's1', name: 'Broken' }),
      makeShader({ id: 's2', name: 'Working' }),
    ])
    renderPanel()
    await waitFor(() => expect(screen.getAllByText('Compiled')).toHaveLength(2))

    useShaderLibraryStore.setState({
      compileStatus: {
        ...useShaderLibraryStore.getState().compileStatus,
        s1: {
          status: 'Failed',
          errors: [
            { line: 3, message: 'oops' },
            { line: 5, message: 'nope' },
          ],
        },
      },
    })

    expect(await screen.findByText('Failed (2)')).toBeInTheDocument()
    const app = await waitForStageApp()
    const layer = previewLayer(app)
    await waitFor(() => expect(previewSprite(layer, 's2')).toBeDefined())
    expect(previewSprite(layer, 's1')).toBeUndefined()
  })

  it('renders a live mini-render quad per compiled shader with its compiled program', async () => {
    stubLibrary([
      makeShader({ id: 's1', name: 'Ink Wash', source: SOURCE_WITH_UNIFORMS }),
      makeShader({ id: 's2', name: 'Sepia Glow' }),
    ])
    renderPanel()
    await screen.findByRole('button', { name: 'Select Ink Wash' })

    const app = await waitForStageApp()
    const layer = previewLayer(app)
    await waitFor(() => expect(previewSprite(layer, 's1')).toBeDefined())
    await waitFor(() => expect(previewSprite(layer, 's2')).toBeDefined())

    const filter = previewSprite(layer, 's1')?.filters[0]
    expect(filter?.glProgram.fragment).toBe(SOURCE_WITH_UNIFORMS)
    expect(previewSprite(layer, 's2')?.filters[0]?.glProgram.fragment).toBe(SOURCE)
  })

  it('filters the grid by name as the user types', async () => {
    stubLibrary([
      makeShader({ id: 's1', name: 'Ink Wash' }),
      makeShader({ id: 's2', name: 'Sepia Glow' }),
    ])
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Ink Wash')

    await user.type(screen.getByRole('searchbox', { name: 'Search shaders' }), 'sepia')

    expect(screen.getByRole('button', { name: 'Select Sepia Glow' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Select Ink Wash' })).not.toBeInTheDocument()
  })

  it('shows a no-match message when the search filters everything out', async () => {
    stubLibrary([makeShader()])
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Ink Wash')

    await user.type(screen.getByRole('searchbox', { name: 'Search shaders' }), 'zzz')

    expect(await screen.findByText('No shaders match your search.')).toBeInTheDocument()
  })
})

describe('ShadersPanel selection and preview panel', () => {
  it('selects a shader into the library store when a cell is clicked', async () => {
    stubLibrary([makeShader({ id: 's1', name: 'Ink Wash' })])
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Ink Wash')

    await user.click(screen.getByRole('button', { name: 'Select Ink Wash' }))

    expect(useShaderLibraryStore.getState().selectedId).toBe('s1')
    expect(screen.getByRole('region', { name: 'Shader preview' })).toBeInTheDocument()
  })

  it('lists the uniforms with types and defaults in the preview panel', async () => {
    stubLibrary([
      makeShader({
        id: 's1',
        source: SOURCE_WITH_UNIFORMS,
        default_uniforms: [
          { key: 'uIntensity', kind: 'float', default: 0.5 },
          { key: 'uColor', kind: 'vec3', default: [1, 0, 0] },
        ],
      }),
    ])
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Ink Wash')
    await user.click(screen.getByRole('button', { name: 'Select Ink Wash' }))

    const preview = screen.getByRole('region', { name: 'Shader preview' })
    expect(preview).toHaveTextContent('Uniform Defaults')
    expect(screen.getByLabelText('uIntensity')).toHaveValue(0.5)
    expect(screen.getByLabelText('uColor')).toBeInTheDocument()
  })

  it('shows the compile status and error list for a failed shader in the preview panel', async () => {
    stubLibrary([
      makeShader({
        id: 's1',
        name: 'Broken',
        default_uniforms: [{ key: 'uIntensity', kind: 'float', default: 0 }],
      }),
    ])
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Broken')
    useShaderLibraryStore.setState({
      compileStatus: {
        ...useShaderLibraryStore.getState().compileStatus,
        s1: {
          status: 'Failed',
          errors: [
            { line: 3, message: 'oops' },
            { line: 0, message: 'no line number' },
          ],
        },
      },
    })

    await user.click(screen.getByRole('button', { name: 'Select Broken' }))

    const preview = screen.getByRole('region', { name: 'Shader preview' })
    expect(preview).toHaveTextContent('Failed (2)')
    expect(preview).toHaveTextContent('Line 3: oops')
    expect(preview).toHaveTextContent('no line number')
  })

  it('shows the metadata in the preview panel', async () => {
    stubLibrary([
      makeShader({
        id: 's1',
        description: 'A watercolor wash',
        tags: ['watercolor', 'warm'],
        is_builtin: true,
      }),
    ])
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Ink Wash')
    await user.click(screen.getByRole('button', { name: 'Select Ink Wash' }))

    const preview = screen.getByRole('region', { name: 'Shader preview' })
    expect(preview).toHaveTextContent('A watercolor wash')
    expect(preview).toHaveTextContent('watercolor, warm')
    expect(preview).toHaveTextContent('2026-08-15')
    expect(preview).toHaveTextContent('Built-in')
  })

  it('closes the preview panel without deselecting other state', async () => {
    stubLibrary([makeShader({ id: 's1', name: 'Ink Wash' })])
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Ink Wash')
    await user.click(screen.getByRole('button', { name: 'Select Ink Wash' }))
    expect(screen.getByRole('region', { name: 'Shader preview' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close preview' }))

    expect(screen.queryByRole('region', { name: 'Shader preview' })).not.toBeInTheDocument()
    expect(useShaderLibraryStore.getState().selectedId).toBeNull()
  })
})

describe('ShadersPanel import and re-upload', () => {
  it('imports a single .glsl file through the store and shows it with a Compiled badge', async () => {
    const file = new File(['void main() {}'], 'wash.glsl', { type: 'text/plain' })
    const imported = makeShader({ id: 's9', name: 'Wash' })
    stubFetch((url, init) => {
      if (url.includes('/api/shaders/import') && init.method === 'POST') {
        expect(init.body).toBeInstanceOf(FormData)
        return Promise.resolve(new Response(JSON.stringify(imported), { status: 200 }))
      }
      if (url.includes('/api/shaders') && init.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify(imported), { status: 200 }))
      }
      if (url.includes('/api/shaders')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('No shaders imported. Import a .glsl fragment shader to get started.')

    await user.click(screen.getByRole('button', { name: 'Import Shader' }))
    await user.upload(screen.getByLabelText('Import shader file'), file)

    expect(await screen.findByRole('button', { name: 'Select Wash' })).toBeInTheDocument()
    expect(screen.getByText('Compiled')).toBeInTheDocument()
    const app = await waitForStageApp()
    const layer = previewLayer(app)
    await waitFor(() => expect(previewSprite(layer, 's9')).toBeDefined())
  })

  it('keeps a shader whose import fails to compile with a Failed badge and no mini-render', async () => {
    gl.compileSuccess = false
    gl.infoLog = 'ERROR: 0:2: syntax'
    const file = new File(['broken'], 'broken.glsl', { type: 'text/plain' })
    const imported = makeShader({ id: 's9', name: 'Broken Wash' })
    stubFetch((url, init) => {
      if (url.includes('/api/shaders/import') && init.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify(imported), { status: 200 }))
      }
      if (url.includes('/api/shaders') && init.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify(imported), { status: 200 }))
      }
      if (url.includes('/api/shaders')) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('No shaders imported. Import a .glsl fragment shader to get started.')

    await user.click(screen.getByRole('button', { name: 'Import Shader' }))
    await user.upload(screen.getByLabelText('Import shader file'), file)

    expect(await screen.findByText('Failed (1)')).toBeInTheDocument()
    const app = await waitForStageApp()
    const layer = previewLayer(app)
    await waitFor(() => expect(previewSprite(layer, 's9')).toBeUndefined())
  })

  it('re-uploads the source from the preview panel and flips the badge and mini-render live', async () => {
    const failing = makeShader({ id: 's1', name: 'Ink Wash' })
    const reuploaded = { ...failing, source: SOURCE_WITH_UNIFORMS }
    gl.compileSuccess = false
    gl.infoLog = 'ERROR: 0:3: broken'
    stubFetch((url, init) => {
      if (url.includes('/api/shaders/s1/source') && init.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify(reuploaded), { status: 200 }))
      }
      if (url.includes('/api/shaders/s1/uniforms') && init.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify(reuploaded), { status: 200 }))
      }
      if (url.includes('/api/shaders')) {
        return Promise.resolve(new Response(JSON.stringify([failing]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Ink Wash')
    expect(screen.getByText('Failed (1)')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Select Ink Wash' }))
    const preview = screen.getByRole('region', { name: 'Shader preview' })
    expect(preview).toHaveTextContent('Line 3: broken')

    gl.compileSuccess = true
    await user.click(screen.getByRole('button', { name: 'Re-upload' }))
    await user.upload(
      screen.getByLabelText('Re-upload shader file'),
      new File(['void main() {}'], 'fixed.glsl', { type: 'text/plain' }),
    )

    const compiledBadges = await screen.findAllByText('Compiled')
    expect(compiledBadges.length).toBeGreaterThanOrEqual(1)
    const app = await waitForStageApp()
    const layer = previewLayer(app)
    await waitFor(() => expect(previewSprite(layer, 's1')).toBeDefined())
    expect(screen.getByRole('region', { name: 'Shader preview' })).not.toHaveTextContent(
      'Line 3: broken',
    )
  })
})

describe('ShadersPanel uniform default editing', () => {
  function stubUniformsUpdate(
    original: ShaderDefinition,
    updated: ShaderDefinition,
    expectBody?: (body: unknown) => void,
  ): void {
    stubFetch((url, init) => {
      if (url.includes('/api/shaders/s1/uniforms') && init.method === 'PUT') {
        if (expectBody) {
          expectBody(JSON.parse(init.body as string))
        }
        return Promise.resolve(new Response(JSON.stringify(updated), { status: 200 }))
      }
      if (url.includes('/api/shaders')) {
        return Promise.resolve(new Response(JSON.stringify([original]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
  }

  const WITH_DEFAULTS = makeShader({
    id: 's1',
    source: SOURCE_WITH_UNIFORMS,
    default_uniforms: [
      { key: 'uIntensity', kind: 'float', default: 0.5 },
      { key: 'uTint', kind: 'vec3', default: [1, 0, 0] },
      { key: 'uEnabled', kind: 'bool', default: false },
    ],
  })

  async function renderAndSelect(): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Ink Wash')
    await user.click(screen.getByRole('button', { name: 'Select Ink Wash' }))
    return user
  }

  it('edits a numeric uniform default and persists the full uniform list', async () => {
    const updated = makeShader({
      ...WITH_DEFAULTS,
      default_uniforms: [
        { key: 'uIntensity', kind: 'float', default: 0.9 },
        { key: 'uTint', kind: 'vec3', default: [1, 0, 0] },
        { key: 'uEnabled', kind: 'bool', default: false },
      ],
    })
    stubUniformsUpdate(WITH_DEFAULTS, updated, (body) => {
      expect((body as { default_uniforms: unknown }).default_uniforms).toEqual([
        { key: 'uIntensity', kind: 'float', default: 0.9 },
        { key: 'uTint', kind: 'vec3', default: [1, 0, 0] },
        { key: 'uEnabled', kind: 'bool', default: false },
      ])
    })
    const user = await renderAndSelect()

    const input = screen.getByLabelText('uIntensity')
    await user.clear(input)
    await user.type(input, '0.9{Enter}')

    await waitFor(() => expect(screen.getByLabelText('uIntensity')).toHaveValue(0.9))
  })

  it('edits a color vector default with the color picker', async () => {
    const original = makeShader({
      id: 's1',
      default_uniforms: [
        { key: 'uStartColor', kind: 'vec3', default: [0, 0.25, 0.5] },
        { key: 'uEndColor', kind: 'vec3', default: [0.9, 0.9, 1.0] },
      ],
    })
    const updated = makeShader({
      ...original,
      default_uniforms: [
        { key: 'uStartColor', kind: 'vec3', default: [1, 0, 0] },
        { key: 'uEndColor', kind: 'vec3', default: [0.9, 0.9, 1.0] },
      ],
    })
    stubUniformsUpdate(original, updated, (body) => {
      expect((body as { default_uniforms: unknown }).default_uniforms).toEqual([
        { key: 'uStartColor', kind: 'vec3', default: [1, 0, 0] },
        { key: 'uEndColor', kind: 'vec3', default: [0.9, 0.9, 1.0] },
      ])
    })
    await renderAndSelect()

    fireEvent.change(screen.getByLabelText('uStartColor'), { target: { value: '#ff0000' } })

    await waitFor(() => expect(screen.getByLabelText('uStartColor')).toHaveValue('#ff0000'))
  })

  it('toggles a boolean uniform default', async () => {
    const updated = makeShader({
      ...WITH_DEFAULTS,
      default_uniforms: [
        { key: 'uIntensity', kind: 'float', default: 0.5 },
        { key: 'uTint', kind: 'vec3', default: [1, 0, 0] },
        { key: 'uEnabled', kind: 'bool', default: true },
      ],
    })
    stubUniformsUpdate(WITH_DEFAULTS, updated, (body) => {
      expect((body as { default_uniforms: unknown }).default_uniforms).toEqual([
        { key: 'uIntensity', kind: 'float', default: 0.5 },
        { key: 'uTint', kind: 'vec3', default: [1, 0, 0] },
        { key: 'uEnabled', kind: 'bool', default: true },
      ])
    })
    const user = await renderAndSelect()

    await user.click(screen.getByLabelText('uEnabled'))

    await waitFor(() => expect(screen.getByLabelText('uEnabled')).toBeChecked())
  })

  it('edits a sampler2D default with the asset picker', async () => {
    const original = makeShader({
      id: 's1',
      default_uniforms: [{ key: 'uMask', kind: 'sampler2D', default: '' }],
    })
    const updated = makeShader({
      ...original,
      default_uniforms: [{ key: 'uMask', kind: 'sampler2D', default: 'asset-1' }],
    })
    stubFetch((url, init) => {
      if (url.includes('/api/shaders/s1/uniforms') && init.method === 'PUT') {
        expect(
          (JSON.parse(init.body as string) as { default_uniforms: unknown }).default_uniforms,
        ).toEqual([{ key: 'uMask', kind: 'sampler2D', default: 'asset-1' }])
        return Promise.resolve(new Response(JSON.stringify(updated), { status: 200 }))
      }
      if (url.includes('/api/shaders')) {
        return Promise.resolve(new Response(JSON.stringify([original]), { status: 200 }))
      }
      if (url.includes('/api/assets')) {
        return Promise.resolve(new Response(JSON.stringify([ASSET]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const user = await renderAndSelect()

    const picker = screen.getByLabelText('uMask')
    expect(picker).toBeEnabled()
    expect(screen.getByRole('option', { name: 'Portrait' })).toBeInTheDocument()
    await user.selectOptions(picker, 'asset-1')

    await waitFor(() => expect(screen.getByLabelText('uMask')).toHaveValue('asset-1'))
  })

  it('disables the sampler picker while the asset library is unavailable', async () => {
    const original = makeShader({
      id: 's1',
      default_uniforms: [{ key: 'uMask', kind: 'sampler2D', default: '' }],
    })
    stubLibrary([original])
    await renderAndSelect()

    expect(screen.getByLabelText('uMask')).toBeDisabled()
  })

  it('preserves persisted sampler defaults when editing another uniform', async () => {
    const original = makeShader({
      id: 's1',
      default_uniforms: [
        { key: 'uIntensity', kind: 'float', default: 0.5 },
        { key: 'uMask', kind: 'sampler2D', default: '' },
      ],
    })
    const updated = makeShader({
      ...original,
      default_uniforms: [
        { key: 'uIntensity', kind: 'float', default: 0.9 },
        { key: 'uMask', kind: 'sampler2D', default: '' },
      ],
    })
    stubUniformsUpdate(original, updated, (body) => {
      expect((body as { default_uniforms: unknown }).default_uniforms).toEqual([
        { key: 'uIntensity', kind: 'float', default: 0.9 },
        { key: 'uMask', kind: 'sampler2D', default: '' },
      ])
    })
    const user = await renderAndSelect()

    const input = screen.getByLabelText('uIntensity')
    await user.clear(input)
    await user.type(input, '0.9{Enter}')

    await waitFor(() => expect(screen.getByLabelText('uIntensity')).toHaveValue(0.9))
  })

  it('updates the mini-render with the edited defaults', async () => {
    const updated = makeShader({
      ...WITH_DEFAULTS,
      default_uniforms: [
        { key: 'uIntensity', kind: 'float', default: 0.9 },
        { key: 'uTint', kind: 'vec3', default: [1, 0, 0] },
        { key: 'uEnabled', kind: 'bool', default: false },
      ],
    })
    stubUniformsUpdate(WITH_DEFAULTS, updated)
    const user = await renderAndSelect()

    const input = screen.getByLabelText('uIntensity')
    await user.clear(input)
    await user.type(input, '0.9{Enter}')

    const app = await waitForStageApp()
    const layer = previewLayer(app)
    await waitFor(() => {
      const filter = previewSprite(layer, 's1')?.filters[0]
      expect((filter?.resources.uniforms.uniforms as Record<string, unknown>).uIntensity).toBe(0.9)
    })
  })
})

describe('ShadersPanel cell actions and protected built-ins', () => {
  it('renames a shader from the cell and updates the grid', async () => {
    const renamed = makeShader({ name: 'Wash & Tint' })
    stubFetch((url, init) => {
      if (url.includes('/api/shaders/s1') && init.method === 'PUT' && !url.includes('/uniforms')) {
        return Promise.resolve(new Response(JSON.stringify(renamed), { status: 200 }))
      }
      if (url.includes('/api/shaders')) {
        return Promise.resolve(new Response(JSON.stringify([makeShader()]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Ink Wash')

    await user.click(screen.getByRole('button', { name: 'Rename Ink Wash' }))
    const input = screen.getByRole('textbox', { name: 'Shader name' })
    await user.clear(input)
    await user.type(input, 'Wash & Tint{Enter}')

    expect(await screen.findByText('Wash & Tint')).toBeInTheDocument()
    expect(screen.queryByText('Ink Wash')).not.toBeInTheDocument()
  })

  it('does not rename a shader to an empty name', async () => {
    let putCalls = 0
    stubFetch((url, init) => {
      if (url.includes('/api/shaders/s1') && init.method === 'PUT' && !url.includes('/uniforms')) {
        putCalls += 1
        return Promise.resolve(new Response(JSON.stringify(makeShader()), { status: 200 }))
      }
      if (url.includes('/api/shaders')) {
        return Promise.resolve(new Response(JSON.stringify([makeShader()]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Ink Wash')

    await user.click(screen.getByRole('button', { name: 'Rename Ink Wash' }))
    const input = screen.getByRole('textbox', { name: 'Shader name' })
    await user.clear(input)
    await user.keyboard('{Enter}')

    expect(putCalls).toBe(0)
    expect(await screen.findByRole('button', { name: 'Select Ink Wash' })).toBeInTheDocument()
  })

  it('duplicates a shader with a suffixed name and shows both in the grid', async () => {
    const copy = makeShader({ id: 's2', name: 'Ink Wash (2)' })
    stubFetch((url, init) => {
      if (url.includes('/api/shaders/duplicate') && init.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify(copy), { status: 200 }))
      }
      if (url.includes('/api/shaders') && init.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify(copy), { status: 200 }))
      }
      if (url.includes('/api/shaders')) {
        return Promise.resolve(new Response(JSON.stringify([makeShader()]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Ink Wash')

    await user.click(screen.getByRole('button', { name: 'Duplicate Ink Wash' }))

    expect(await screen.findByText('Ink Wash (2)')).toBeInTheDocument()
    expect(screen.getAllByText('Compiled')).toHaveLength(2)
  })

  it('deletes a shader from the cell, removes it from the grid and closes its preview panel', async () => {
    let deleteCalls = 0
    stubFetch((url, init) => {
      if (url.includes('/api/shaders/s1') && init.method === 'DELETE') {
        deleteCalls += 1
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url.includes('/api/shaders')) {
        return Promise.resolve(new Response(JSON.stringify([makeShader()]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Ink Wash')
    await user.click(screen.getByRole('button', { name: 'Select Ink Wash' }))
    expect(screen.getByRole('region', { name: 'Shader preview' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete Ink Wash' }))

    await waitFor(() => expect(deleteCalls).toBe(1))
    expect(screen.queryByText('Ink Wash')).not.toBeInTheDocument()
    expect(
      await screen.findByText(
        'No shaders imported. Import a .glsl fragment shader to get started.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Shader preview' })).not.toBeInTheDocument()
  })

  it('blocks deletion of protected built-in shaders', async () => {
    let deleteCalls = 0
    stubFetch((url, init) => {
      if (url.includes('/api/shaders') && init.method === 'DELETE') {
        deleteCalls += 1
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url.includes('/api/shaders')) {
        return Promise.resolve(
          new Response(JSON.stringify([makeShader({ is_builtin: true })]), { status: 200 }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Ink Wash')

    const deleteButton = screen.getByRole('button', { name: 'Delete Ink Wash' })
    expect(deleteButton).toBeDisabled()

    await user.click(deleteButton)
    expect(deleteCalls).toBe(0)
    expect(screen.getByText('Ink Wash')).toBeInTheDocument()
  })
})

describe('ShadersPanel degraded mode', () => {
  it('renders the grid without mini-renders when the preview stage fails to initialize', async () => {
    pixiRegistry.failNextInit = true
    stubLibrary([makeShader()])
    renderPanel()

    expect(await screen.findByRole('button', { name: 'Select Ink Wash' })).toBeInTheDocument()
    expect(screen.getByText('Compiled')).toBeInTheDocument()

    const app = pixiRegistry.applications[0]
    expect(app).toBeDefined()
    expect(app.stage.children.some((child) => child.label === 'shader-preview-layer')).toBe(false)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Select Ink Wash' }))
    expect(screen.getByRole('region', { name: 'Shader preview' })).toBeInTheDocument()
  })
})
