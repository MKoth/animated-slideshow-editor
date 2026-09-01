import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShaderDefinition } from '../api'
import { ShadersPanel } from '../components/panels/ShadersPanel'
import { setWebGL2ContextFactory } from '../shaders/compiler'
import { useShaderLibraryStore } from '../stores/shaderLibraryStore'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'
import { useNotificationStore } from '../stores/notificationStore'
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

let gl: FakeWebGL2Context

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
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

describe('Shader edit-as-fork', () => {
  it('creates a new Shader Definition via Edit as new with forked source', async () => {
    const original = makeShader()
    const forked = makeShader({ id: 's2', name: 'Ink Wash (2)', source: SOURCE + '\n// edited' })
    stubFetch((url, init) => {
      if (url.includes('/api/shaders/import') && init.method === 'POST') {
        const body = init.body as FormData
        expect(body.get('name')).toBe('Ink Wash (2)')
        return Promise.resolve(new Response(JSON.stringify(forked), { status: 200 }))
      }
      if (url.includes('/api/shaders/s2/uniforms') && init.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify(forked), { status: 200 }))
      }
      if (url.includes('/api/shaders')) {
        return Promise.resolve(new Response(JSON.stringify([original]), { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected ${url}`))
    })
    const user = userEvent.setup()
    render(<ShadersPanel />)
    await screen.findByText('Ink Wash')
    await user.click(screen.getByRole('button', { name: 'Select Ink Wash' }))
    expect(screen.getByRole('region', { name: 'Shader preview' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit as new' }))
    const editor = screen.getByRole('dialog', { name: 'Shader editor' })
    expect(editor).toBeInTheDocument()
    expect(editor).toHaveTextContent('Compiled')
    // The name field should be pre-filled with unique copy name
    const nameInput = screen.getByLabelText('Shader name')
    expect(nameInput).toHaveValue('Ink Wash (2)')
    const sourceTextarea = screen.getByLabelText('GLSL source')
    expect(sourceTextarea).toHaveValue(SOURCE)

    // Save
    await user.click(screen.getByRole('button', { name: 'Save shader' }))

    await waitFor(() => expect(useShaderLibraryStore.getState().definitions).toHaveLength(2))
    expect(useShaderLibraryStore.getState().definitions.map((d) => d.id)).toEqual(['s2', 's1'])
    expect(useShaderLibraryStore.getState().selectedId).toBe('s2')
  })

  it('blocks save when shader has syntax errors', async () => {
    const original = makeShader()
    stubFetch((url) => {
      if (url.includes('/api/shaders')) {
        return Promise.resolve(new Response(JSON.stringify([original]), { status: 200 }))
      }
      return Promise.reject(new Error(url))
    })
    const user = userEvent.setup()
    render(<ShadersPanel />)
    await screen.findByText('Ink Wash')
    await user.click(screen.getByRole('button', { name: 'Select Ink Wash' }))
    await user.click(screen.getByRole('button', { name: 'Edit as new' }))

    const sourceTextarea = screen.getByLabelText('GLSL source')
    gl.compileSuccess = false
    gl.infoLog = 'ERROR: 0:5: syntax error'
    fireEvent.change(sourceTextarea, { target: { value: 'bad source' } })

    expect(await screen.findByText(/Failed/)).toBeInTheDocument()
    const saveBtn = screen.getByRole('button', { name: 'Save shader' })
    expect(saveBtn).toBeDisabled()
    expect(saveBtn.title).toMatch(/Cannot save/)
    expect(screen.getByText(/Fix compilation errors before saving/)).toBeInTheDocument()

    let importCalls = 0
    stubFetch((url, init) => {
      if (url.includes('/api/shaders/import') && init.method === 'POST') {
        importCalls += 1
        return Promise.resolve(
          new Response(JSON.stringify(makeShader({ id: 's2' })), { status: 200 }),
        )
      }
      if (url.includes('/api/shaders')) {
        return Promise.resolve(new Response(JSON.stringify([original]), { status: 200 }))
      }
      return Promise.reject(new Error(url))
    })

    await user.click(saveBtn)
    expect(importCalls).toBe(0)
    // Editor should still be open
    expect(screen.getByRole('dialog', { name: 'Shader editor' })).toBeInTheDocument()
  })

  it('shows live compile feedback and syntax highlighting', async () => {
    const original = makeShader()
    stubFetch((url) => {
      if (url.includes('/api/shaders')) {
        return Promise.resolve(new Response(JSON.stringify([original]), { status: 200 }))
      }
      return Promise.reject(new Error(url))
    })
    const user = userEvent.setup()
    render(<ShadersPanel />)
    await screen.findByText('Ink Wash')
    await user.click(screen.getByRole('button', { name: 'Select Ink Wash' }))
    await user.click(screen.getByRole('button', { name: 'Edit as new' }))

    const editor = screen.getByRole('dialog', { name: 'Shader editor' })
    expect(editor).toHaveTextContent('Live Preview')
    expect(editor.querySelector('.shader-editor__badge--compiled')).toBeInTheDocument()
    // highlighted code should have token spans
    const highlighted = editor.querySelector('.glsl-code')
    expect(highlighted?.innerHTML).toContain('glsl-token')

    gl.compileSuccess = false
    gl.infoLog = 'ERROR: 0:3: oops'
    const sourceTextarea = screen.getByLabelText('GLSL source')
    fireEvent.change(sourceTextarea, { target: { value: 'bad' } })
    expect(await screen.findByText(/Line 3: oops/)).toBeInTheDocument()
  })

  it('does not black out preview on error — keeps last successful preview', async () => {
    const original = makeShader()
    stubFetch((url) => {
      if (url.includes('/api/shaders')) {
        return Promise.resolve(new Response(JSON.stringify([original]), { status: 200 }))
      }
      return Promise.reject(new Error(url))
    })
    const user = userEvent.setup()
    render(<ShadersPanel />)
    await screen.findByText('Ink Wash')
    await user.click(screen.getByRole('button', { name: 'Select Ink Wash' }))
    await user.click(screen.getByRole('button', { name: 'Edit as new' }))

    const editor2 = screen.getByRole('dialog', { name: 'Shader editor' })
    expect(editor2.querySelector('.shader-editor__badge--compiled')).toBeInTheDocument()
    const sourceTextarea = screen.getByLabelText('GLSL source')
    gl.compileSuccess = false
    gl.infoLog = 'ERROR: 0:2: broken'
    fireEvent.change(sourceTextarea, { target: { value: 'broken' } })
    await screen.findByText(/Failed/)
    expect(screen.getByText(/Preview keeps last successful compile/)).toBeInTheDocument()
    // Preview host should still exist and not be empty black
    const host = document.querySelector('.shader-editor__preview-host')
    expect(host).toBeInTheDocument()
  })
})
