import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MaterialDefinition, ShaderDefinition } from '../api'
import { MaterialsPanel } from '../components/panels/MaterialsPanel'
import { setWebGL2ContextFactory } from '../shaders/compiler'
import { useMaterialLibraryStore } from '../stores/materialLibraryStore'
import { useNotificationStore } from '../stores/notificationStore'
import { useShaderLibraryStore } from '../stores/shaderLibraryStore'
import { pixiRegistry, resetShaderRegistries } from './renderer/pixiFake'
import { createWebGLFake, type FakeWebGL2Context } from './shaders/webglFake'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./renderer/pixiFake')
  return createPixiFake()
})

const RED: MaterialDefinition = {
  id: 'm1',
  name: 'Red Slime',
  description: '',
  tags: [],
  created_at: '2026-08-15T12:00:00',
  updated_at: '2026-08-15T12:00:00',
  shader_id: null,
  parameters: [
    { key: 'tint', kind: 'color', default: '#ff0000' },
    { key: 'opacityMultiplier', kind: 'number', default: 1 },
  ],
}

const BLUE: MaterialDefinition = {
  ...RED,
  id: 'm2',
  name: 'Blue Slime',
  parameters: [
    { key: 'tint', kind: 'color', default: '#0000ff' },
    { key: 'opacityMultiplier', kind: 'number', default: 1 },
  ],
}

const DEFAULT_MATERIAL: MaterialDefinition = {
  id: '0d3f4464-8300-5b6d-ae14-45246fefbeae',
  name: 'Default Material',
  description: '',
  tags: ['built-in', 'default'],
  created_at: '2026-08-15T12:00:00',
  updated_at: '2026-08-15T12:00:00',
  shader_id: null,
  parameters: [
    { key: 'tint', kind: 'color', default: '#ffffff' },
    { key: 'opacityMultiplier', kind: 'number', default: 1 },
  ],
}

const SHADER: ShaderDefinition = {
  id: 'sh1',
  name: 'Ink Wash',
  description: '',
  tags: [],
  created_at: '2026-08-15T12:00:00',
  updated_at: '2026-08-15T12:00:00',
  source: `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
out vec4 fragColor;
void main() {
  fragColor = texture(uTexture, vUv);
}
`,
  default_uniforms: [],
  is_builtin: false,
}

function stubFetch(handler: (url: string, init: RequestInit) => Promise<Response>): void {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init ?? {}),
  )
}

function stubLibrary(definitions: MaterialDefinition[]): void {
  stubFetch((url) => {
    if (url.includes('/api/materials')) {
      return Promise.resolve(new Response(JSON.stringify(definitions), { status: 200 }))
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  })
}

function stubBackendDown(): void {
  stubFetch(() => Promise.reject(new Error('connection refused')))
}

function renderPanel() {
  return render(<MaterialsPanel />)
}

let gl: FakeWebGL2Context

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  pixiRegistry.reset()
  resetShaderRegistries()
  gl = createWebGLFake()
  setWebGL2ContextFactory(() => gl)
  useMaterialLibraryStore.setState({
    definitions: [],
    loading: false,
    error: null,
    unavailable: false,
    selectedId: null,
  })
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
  useNotificationStore.setState({ notifications: [] })
})

afterEach(() => {
  setWebGL2ContextFactory(null)
  vi.unstubAllGlobals()
})

describe('MaterialsPanel', () => {
  it('shows the empty state with the canonical message when the library is empty', async () => {
    stubLibrary([])
    renderPanel()

    expect(
      await screen.findByText('No materials created. Create one to get started.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create Material' })).toBeEnabled()
  })

  it('shows the unavailable state and disables create and search when the backend is down', async () => {
    stubBackendDown()
    renderPanel()

    expect(
      await screen.findByText('Material library unavailable — start the backend'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create Material' })).toBeDisabled()
    expect(screen.getByRole('searchbox', { name: 'Search materials' })).toBeDisabled()
    expect(screen.queryByText('Red Slime')).not.toBeInTheDocument()
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
      await screen.findByText('No materials created. Create one to get started.'),
    ).toBeInTheDocument()
  })

  it('renders the grid with a tinted swatch and name per material', async () => {
    stubLibrary([RED, BLUE])
    renderPanel()

    const redCell = await screen.findByRole('button', { name: 'Select Red Slime' })
    expect(redCell).toHaveTextContent('Red Slime')
    const redSwatch = redCell.querySelector('.material-cell__swatch') as HTMLElement
    expect(redSwatch).not.toBeNull()
    expect(redSwatch.style.backgroundColor).toBe('rgb(255, 0, 0)')
    expect(screen.getByRole('button', { name: 'Select Blue Slime' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Select / })).toHaveLength(2)
  })

  it('selects a material into the library store when a cell is clicked', async () => {
    stubLibrary([RED])
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Red Slime')

    await user.click(screen.getByRole('button', { name: 'Select Red Slime' }))

    expect(useMaterialLibraryStore.getState().selectedId).toBe('m1')
  })

  it('filters the grid by name as the user types', async () => {
    stubLibrary([RED, BLUE])
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Blue Slime')

    await user.type(screen.getByRole('searchbox', { name: 'Search materials' }), 'red')

    expect(screen.getByRole('button', { name: 'Select Red Slime' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Select Blue Slime' })).not.toBeInTheDocument()
  })

  it('shows a no-match message instead of the empty state when the search filters everything out', async () => {
    stubLibrary([RED])
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Red Slime')

    await user.type(screen.getByRole('searchbox', { name: 'Search materials' }), 'zzz')

    expect(await screen.findByText('No materials match your search.')).toBeInTheDocument()
    expect(
      screen.queryByText('No materials created. Create one to get started.'),
    ).not.toBeInTheDocument()
  })

  it('creates a material from defaults and shows it in the grid', async () => {
    stubFetch((url, init) => {
      if (url.includes('/api/materials') && init.method === 'POST') {
        const body = JSON.parse(init.body as string) as { name: string }
        return Promise.resolve(
          new Response(JSON.stringify({ ...RED, id: 'm9', name: body.name }), {
            status: 200,
          }),
        )
      }
      if (url.includes('/api/materials')) {
        return Promise.resolve(new Response(JSON.stringify([RED]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Red Slime')

    await user.click(screen.getByRole('button', { name: 'Create Material' }))

    expect(await screen.findByText('New Material')).toBeInTheDocument()
  })

  it('renames a material from the cell and updates the grid', async () => {
    const renamed: MaterialDefinition = { ...RED, name: 'Ruby Slime' }
    stubFetch((url, init) => {
      if (url.includes('/api/materials/m1') && init.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify(renamed), { status: 200 }))
      }
      if (url.includes('/api/materials')) {
        return Promise.resolve(new Response(JSON.stringify([RED]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Red Slime')

    await user.click(screen.getByRole('button', { name: 'Rename Red Slime' }))
    const input = screen.getByRole('textbox', { name: 'Material name' })
    await user.clear(input)
    await user.type(input, 'Ruby Slime{Enter}')

    expect(await screen.findByText('Ruby Slime')).toBeInTheDocument()
    expect(screen.queryByText('Red Slime')).not.toBeInTheDocument()
  })

  it('duplicates a material with a suffixed name and shows both in the grid', async () => {
    const copy: MaterialDefinition = { ...RED, id: 'm10', name: 'Red Slime (2)' }
    stubFetch((url, init) => {
      if (url.includes('/api/materials') && init.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify(copy), { status: 200 }))
      }
      if (url.includes('/api/materials')) {
        return Promise.resolve(new Response(JSON.stringify([RED]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Red Slime')

    await user.click(screen.getByRole('button', { name: 'Duplicate Red Slime' }))

    expect(await screen.findByText('Red Slime (2)')).toBeInTheDocument()
  })

  it('deletes a material from the cell and removes it from the grid', async () => {
    let deleteCalls = 0
    stubFetch((url, init) => {
      if (url.includes('/api/materials/m1') && init.method === 'DELETE') {
        deleteCalls += 1
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url.includes('/api/materials')) {
        return Promise.resolve(new Response(JSON.stringify([RED]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Red Slime')

    await user.click(screen.getByRole('button', { name: 'Delete Red Slime' }))

    await waitFor(() => expect(deleteCalls).toBe(1))
    expect(screen.queryByText('Red Slime')).not.toBeInTheDocument()
  })

  it('blocks deletion of the protected Default Material', async () => {
    let deleteCalls = 0
    stubFetch((url, init) => {
      if (url.includes('/api/materials') && init.method === 'DELETE') {
        deleteCalls += 1
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url.includes('/api/materials')) {
        return Promise.resolve(new Response(JSON.stringify([DEFAULT_MATERIAL]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Default Material')

    const deleteButton = screen.getByRole('button', { name: 'Delete Default Material' })
    expect(deleteButton).toBeDisabled()

    await user.click(deleteButton)
    expect(deleteCalls).toBe(0)
    expect(screen.getByText('Default Material')).toBeInTheDocument()
  })

  it('does not rename a material to an empty name', async () => {
    let putCalls = 0
    stubFetch((url, init) => {
      if (url.includes('/api/materials/m1') && init.method === 'PUT') {
        putCalls += 1
        return Promise.resolve(new Response(JSON.stringify(RED), { status: 200 }))
      }
      if (url.includes('/api/materials')) {
        return Promise.resolve(new Response(JSON.stringify([RED]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Red Slime')

    await user.click(screen.getByRole('button', { name: 'Rename Red Slime' }))
    const input = screen.getByRole('textbox', { name: 'Material name' })
    await user.clear(input)
    await user.keyboard('{Enter}')

    expect(putCalls).toBe(0)
    expect(await screen.findByRole('button', { name: 'Select Red Slime' })).toBeInTheDocument()
  })

  it('updates the grid when a library mutation lands in the store', async () => {
    stubFetch((url, init) => {
      if (url.includes('/api/materials') && init.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify(BLUE), { status: 200 }))
      }
      if (url.includes('/api/materials')) {
        return Promise.resolve(new Response(JSON.stringify([RED]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    renderPanel()
    await screen.findByText('Red Slime')

    await useMaterialLibraryStore.getState().createMaterial({ name: 'Blue Slime' })

    expect(await screen.findByText('Blue Slime')).toBeInTheDocument()
    expect(screen.getByText('Red Slime')).toBeInTheDocument()
  })

  it('recovers from the unavailable state when the backend returns', async () => {
    stubFetch(() => Promise.reject(new Error('connection refused')))
    renderPanel()
    expect(
      await screen.findByText('Material library unavailable — start the backend'),
    ).toBeInTheDocument()

    stubLibrary([RED])
    await useMaterialLibraryStore.getState().loadLibrary()

    expect(await screen.findByRole('button', { name: 'Select Red Slime' })).toBeInTheDocument()
  })

  it('switches between the Materials and Shaders sections of the tab', async () => {
    stubFetch((url) => {
      if (url.includes('/api/materials')) {
        return Promise.resolve(new Response(JSON.stringify([RED]), { status: 200 }))
      }
      if (url.includes('/api/shaders')) {
        return Promise.resolve(new Response(JSON.stringify([SHADER]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Red Slime')
    expect(screen.getByRole('button', { name: 'Materials' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await user.click(screen.getByRole('button', { name: 'Shaders' }))

    expect(await screen.findByText('Ink Wash')).toBeInTheDocument()
    expect(screen.queryByText('Red Slime')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Shaders' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Materials' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    await user.click(screen.getByRole('button', { name: 'Materials' }))

    expect(await screen.findByText('Red Slime')).toBeInTheDocument()
    expect(screen.queryByText('Ink Wash')).not.toBeInTheDocument()
  })
})

describe('material definition panel', () => {
  const WITH_SHADER: MaterialDefinition = {
    ...RED,
    shader_id: 'sh1',
    parameters: [
      { key: 'tint', kind: 'color', default: '#ff0000' },
      { key: 'opacityMultiplier', kind: 'number', default: 1 },
      { key: 'uIntensity', kind: 'float', default: 0.5 },
    ],
  }

  function stubLibraries(
    materials: MaterialDefinition[],
    onPut?: (url: string, body: string) => Response | Promise<Response>,
  ): void {
    stubFetch((url, init) => {
      if (url.includes('/api/materials/m1') && init.method === 'PUT') {
        if (onPut) {
          return Promise.resolve(onPut(url, init.body as string))
        }
        return Promise.reject(new Error('unexpected material PUT'))
      }
      if (url.includes('/api/materials')) {
        return Promise.resolve(new Response(JSON.stringify(materials), { status: 200 }))
      }
      if (url.includes('/api/shaders')) {
        return Promise.resolve(new Response(JSON.stringify([SHADER]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
  }

  it('opens the definition panel with the shader picker and parameter list when a material is selected', async () => {
    stubLibraries([RED])
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Red Slime')

    await user.click(screen.getByRole('button', { name: 'Select Red Slime' }))

    const panel = screen.getByRole('region', { name: 'Material definition' })
    expect(panel).toHaveTextContent('Red Slime')
    const picker = screen.getByRole('combobox', { name: 'Shader' })
    expect(picker).toHaveValue('')
    expect(screen.getByRole('option', { name: 'None' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Ink Wash (Compiled)' })).toBeInTheDocument()
    expect(panel).toHaveTextContent('tint')
    expect(panel).toHaveTextContent('color')
    expect(panel).toHaveTextContent('opacityMultiplier')
    expect(panel).toHaveTextContent('number')
  })

  it('assigns a shader to the material and shows its uniforms in the parameter list', async () => {
    stubLibraries([RED], (_url, body) => {
      expect(JSON.parse(body)).toEqual({ shader_id: 'sh1' })
      return new Response(JSON.stringify(WITH_SHADER), { status: 200 })
    })
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Red Slime')
    await user.click(screen.getByRole('button', { name: 'Select Red Slime' }))
    const picker = screen.getByRole('combobox', { name: 'Shader' })

    await user.selectOptions(picker, 'sh1')

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Shader' })).toHaveValue('sh1'))
    const panel = screen.getByRole('region', { name: 'Material definition' })
    expect(panel).toHaveTextContent('uIntensity')
    expect(panel).toHaveTextContent('float')
    expect(panel).toHaveTextContent('0.5')
  })

  it('removes the shader assignment and its uniforms when None is chosen', async () => {
    stubLibraries([WITH_SHADER], (_url, body) => {
      expect(JSON.parse(body)).toEqual({ shader_id: null })
      return new Response(JSON.stringify(RED), { status: 200 })
    })
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Red Slime')
    await user.click(screen.getByRole('button', { name: 'Select Red Slime' }))
    const panel = screen.getByRole('region', { name: 'Material definition' })
    expect(panel).toHaveTextContent('uIntensity')
    const picker = screen.getByRole('combobox', { name: 'Shader' })
    expect(picker).toHaveValue('sh1')

    await user.selectOptions(picker, '')

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Shader' })).toHaveValue(''))
    expect(screen.getByRole('region', { name: 'Material definition' })).not.toHaveTextContent(
      'uIntensity',
    )
  })

  it('warns when the assigned shader failed to compile', async () => {
    gl.compileSuccess = false
    gl.infoLog = 'ERROR: 0:3: broken'
    stubLibraries([WITH_SHADER])
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Red Slime')

    await user.click(screen.getByRole('button', { name: 'Select Red Slime' }))

    expect(screen.getByRole('option', { name: 'Ink Wash (Failed)' })).toBeInTheDocument()
    expect(
      screen.getByText('Shader failed to compile — the effect will not render.'),
    ).toBeInTheDocument()
  })

  it('keeps the assignment visible when the shader no longer exists in the library', async () => {
    stubLibraries([{ ...WITH_SHADER, shader_id: 'ghost' }])
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Red Slime')

    await user.click(screen.getByRole('button', { name: 'Select Red Slime' }))

    const picker = screen.getByRole('combobox', { name: 'Shader' })
    expect(picker).toHaveValue('ghost')
    expect(screen.getByRole('option', { name: 'ghost' })).toBeInTheDocument()
    expect(
      screen.queryByText('Shader failed to compile — the effect will not render.'),
    ).not.toBeInTheDocument()
  })

  it('disables the shader picker when the shader library is unavailable', async () => {
    stubFetch((url) => {
      if (url.includes('/api/materials')) {
        return Promise.resolve(new Response(JSON.stringify([RED]), { status: 200 }))
      }
      return Promise.reject(new Error('connection refused'))
    })
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Red Slime')

    await user.click(screen.getByRole('button', { name: 'Select Red Slime' }))

    const picker = screen.getByRole('combobox', { name: 'Shader' })
    expect(picker).toBeDisabled()
    expect(
      screen.getByText('Shader library unavailable — start the backend to assign shaders.'),
    ).toBeInTheDocument()
  })

  it('closes the definition panel', async () => {
    stubLibraries([RED])
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Red Slime')
    await user.click(screen.getByRole('button', { name: 'Select Red Slime' }))
    expect(screen.getByRole('region', { name: 'Material definition' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close preview' }))

    expect(screen.queryByRole('region', { name: 'Material definition' })).not.toBeInTheDocument()
    expect(useMaterialLibraryStore.getState().selectedId).toBeNull()
  })
})
