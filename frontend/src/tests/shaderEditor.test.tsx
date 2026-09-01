import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShaderEditor } from '../components/panels/ShaderEditor'
import { setWebGL2ContextFactory } from '../shaders/compiler'
import { createWebGLFake, type FakeWebGL2Context } from './shaders/webglFake'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./renderer/pixiFake')
  return createPixiFake()
})

const VALID_SOURCE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
out vec4 fragColor;
void main() {
  fragColor = texture(uTexture, vUv);
}
`

let gl: FakeWebGL2Context

beforeEach(() => {
  gl = createWebGLFake()
  setWebGL2ContextFactory(() => gl)
})

afterEach(() => {
  setWebGL2ContextFactory(null)
})

describe('ShaderEditor', () => {
  it('shows compiled badge for valid source and enables save', async () => {
    const onSave = vi.fn()
    const onCancel = vi.fn()
    render(
      <ShaderEditor
        initialSource={VALID_SOURCE}
        initialName="My Shader"
        onSave={onSave}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByText('Compiled')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save shader' })).toBeEnabled()
  })

  it('shows failed badge and disables save for invalid source', async () => {
    gl.compileSuccess = false
    gl.infoLog = 'ERROR: 0:5: syntax error'
    const onSave = vi.fn()
    const onCancel = vi.fn()
    render(
      <ShaderEditor
        initialSource={VALID_SOURCE}
        initialName="My Shader"
        onSave={onSave}
        onCancel={onCancel}
      />,
    )

    // Initially valid, then edit to invalid
    const textarea = screen.getByLabelText('GLSL source')
    fireEvent.change(textarea, { target: { value: 'invalid glsl' } })

    expect(await screen.findByText(/Failed/)).toBeInTheDocument()
    const saveButton = screen.getByRole('button', { name: 'Save shader' })
    expect(saveButton).toBeDisabled()
    expect(saveButton.title).toMatch(/Cannot save — shader has compilation errors/)
    expect(screen.getAllByText(/syntax error/).length).toBeGreaterThan(0)
  })

  it('does not call onSave when shader has syntax errors', async () => {
    gl.compileSuccess = false
    gl.infoLog = 'ERROR: 0:5: syntax error'
    const onSave = vi.fn()
    const onCancel = vi.fn()
    render(
      <ShaderEditor
        initialSource="bad"
        initialName="My Shader"
        onSave={onSave}
        onCancel={onCancel}
      />,
    )

    const saveBtn = screen.getByRole('button', { name: 'Save shader' })
    expect(saveBtn).toBeDisabled()
    await userEvent.click(saveBtn)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('calls onSave with name and source when compiled', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onCancel = vi.fn()
    const user = userEvent.setup()
    render(
      <ShaderEditor
        initialSource={VALID_SOURCE}
        initialName="My Shader"
        onSave={onSave}
        onCancel={onCancel}
      />,
    )

    const nameInput = screen.getByLabelText('Shader name')
    await user.clear(nameInput)
    await user.type(nameInput, 'New Name')

    const saveBtn = screen.getByRole('button', { name: 'Save shader' })
    await user.click(saveBtn)

    expect(onSave).toHaveBeenCalledWith({ name: 'New Name', source: VALID_SOURCE })
  })

  it('keeps preview when compile fails (does not black out)', async () => {
    const onSave = vi.fn()
    const onCancel = vi.fn()
    render(
      <ShaderEditor
        initialSource={VALID_SOURCE}
        initialName="My Shader"
        onSave={onSave}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByText('Compiled')).toBeInTheDocument()
    // Edit to invalid
    gl.compileSuccess = false
    gl.infoLog = 'ERROR: 0:5: syntax error'
    const textarea = screen.getByLabelText('GLSL source')
    fireEvent.change(textarea, { target: { value: 'bad' } })

    await screen.findByText(/Failed/)
    // The notice about preview keeping last successful should be visible
    expect(screen.getByText(/Preview keeps last successful compile/)).toBeInTheDocument()
    // Save should still be disabled
    expect(screen.getByRole('button', { name: 'Save shader' })).toBeDisabled()
  })

  it('shows syntax highlighting preview', async () => {
    render(
      <ShaderEditor
        initialSource={VALID_SOURCE}
        initialName="My Shader"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    // Highlighted code should contain glsl-token spans
    const code = document.querySelector('.glsl-code')
    expect(code?.innerHTML).toContain('glsl-token')
  })

  it('blocks save when name is empty', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(
      <ShaderEditor
        initialSource={VALID_SOURCE}
        initialName=""
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Save shader' })).toBeDisabled()
    const nameInput = screen.getByLabelText('Shader name')
    await user.type(nameInput, 'Valid Name')
    expect(screen.getByRole('button', { name: 'Save shader' })).toBeEnabled()
  })

  it('shows warning for duplicate name', async () => {
    render(
      <ShaderEditor
        initialSource={VALID_SOURCE}
        initialName="Existing"
        existingNames={['Existing', 'Other']}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText(/already exists/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save shader' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save shader' }).title).toMatch(/already exists/)
  })
})
