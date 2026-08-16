import { act } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'
import { useNotificationStore } from '../stores/notificationStore'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'
import { useShaderLibraryStore } from '../stores/shaderLibraryStore'
import {
  compiled,
  createNodeOnSlide,
  createSlide,
  failedToCompile,
  fullscreenShaderPicker,
  redoEntry,
  registerFullscreenShaders,
  renderFullscreenShaderInspector,
  seedShaderLibrary,
  select,
  shaderDefinition,
  undoLast,
} from './fullscreenShaderInspectorHarness'

function seedCompiledLibrary(): void {
  seedShaderLibrary([shaderDefinition(), shaderDefinition({ id: 'shader-blur', name: 'Blur' })], {
    'shader-wash': compiled(),
    'shader-blur': compiled(),
  })
}

function seedAssetLibrary(): void {
  useAssetLibraryStore.setState({
    loaded: true,
    definitions: [
      {
        id: 'asset-noise',
        name: 'Noise',
        description: '',
        category: 'Uncategorized',
        tags: [],
        ai_description: '',
        original_filename: '',
        import_date: '',
        width: 1,
        height: 1,
        file_size: 1,
        aspect_ratio: 1,
        default_scale: 1,
        default_rotation: 0,
        pivot: { x: 0.5, y: 0.5 },
        anchors: [],
        original_url: '',
        thumbnail_url: '',
      },
    ],
  })
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  useNotificationStore.setState({ notifications: [] })
  usePlaybackController.setState({ currentTimes: {} })
  useAssetLibraryStore.setState({ definitions: [], loaded: false, unavailable: false })
  useShaderLibraryStore.setState({ definitions: [], compileStatus: {}, unavailable: false })
})

describe('Fullscreen Shader section states', () => {
  it('shows the section with a None + library picker when a slide exists', async () => {
    const { engine } = renderFullscreenShaderInspector()
    seedCompiledLibrary()
    registerFullscreenShaders(engine)
    createSlide(engine)

    expect(await screen.findByRole('heading', { name: 'Fullscreen Shader' })).toBeInTheDocument()
    const picker = fullscreenShaderPicker()
    expect(picker.value).toBe('')
    expect(screen.getByRole('option', { name: 'None' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Ink Wash (Compiled)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Blur (Compiled)' })).toBeInTheDocument()
  })

  it('shows the section when a node is selected', async () => {
    const { engine } = renderFullscreenShaderInspector()
    seedCompiledLibrary()
    registerFullscreenShaders(engine)
    createSlide(engine)
    const nodeId = createNodeOnSlide(engine)
    select(nodeId)

    expect(screen.getByRole('heading', { name: 'Fullscreen Shader' })).toBeInTheDocument()
    expect(fullscreenShaderPicker()).toBeInTheDocument()
  })

  it('does not show the section without a slide', () => {
    renderFullscreenShaderInspector()

    expect(screen.queryByRole('heading', { name: 'Fullscreen Shader' })).not.toBeInTheDocument()
  })

  it('shows no uniform controls until a shader is assigned', async () => {
    const { engine } = renderFullscreenShaderInspector()
    seedCompiledLibrary()
    registerFullscreenShaders(engine)
    createSlide(engine)

    await screen.findByRole('combobox', { name: 'Fullscreen Shader' })
    expect(screen.queryByRole('heading', { name: 'Shader Uniforms' })).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: 'uIntensity' })).not.toBeInTheDocument()
  })

  it('requests the asset library load when a sampler uniform appears in the section', async () => {
    const loadSpy = vi
      .spyOn(useAssetLibraryStore.getState(), 'loadLibrary')
      .mockResolvedValue(undefined)
    const { engine } = renderFullscreenShaderInspector()
    seedCompiledLibrary()
    registerFullscreenShaders(engine)
    createSlide(engine)

    await screen.findByRole('combobox', { name: 'Fullscreen Shader' })
    fireEvent.change(fullscreenShaderPicker(), { target: { value: 'shader-wash' } })

    expect(loadSpy).toHaveBeenCalled()
    loadSpy.mockRestore()
  })
})

describe('Fullscreen Shader picker and compile status', () => {
  it('surfaces each shader compile status in the picker', async () => {
    const { engine } = renderFullscreenShaderInspector()
    seedShaderLibrary([shaderDefinition(), shaderDefinition({ id: 'shader-blur', name: 'Blur' })], {
      'shader-wash': compiled(),
      'shader-blur': failedToCompile('broken line 3'),
    })
    registerFullscreenShaders(engine)
    createSlide(engine)

    await screen.findByRole('combobox', { name: 'Fullscreen Shader' })
    const options = screen.getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'None',
      'Ink Wash (Compiled)',
      'Blur (Failed)',
    ])
  })

  it('allows assigning a failed shader but shows the failed notice', async () => {
    const { engine } = renderFullscreenShaderInspector()
    seedShaderLibrary([shaderDefinition()], { 'shader-wash': failedToCompile() })
    registerFullscreenShaders(engine)
    createSlide(engine)

    await screen.findByRole('combobox', { name: 'Fullscreen Shader' })
    fireEvent.change(fullscreenShaderPicker(), { target: { value: 'shader-wash' } })

    expect(engine.project?.slides[0]?.fullscreenShader?.shaderDefinitionId).toBe('shader-wash')
    expect(
      screen.getByText('Shader failed to compile — the effect will not render.'),
    ).toBeInTheDocument()
  })

  it('keeps the assigned shader shown when its definition leaves the library', async () => {
    const { engine } = renderFullscreenShaderInspector()
    seedCompiledLibrary()
    registerFullscreenShaders(engine)
    createSlide(engine)

    await screen.findByRole('combobox', { name: 'Fullscreen Shader' })
    fireEvent.change(fullscreenShaderPicker(), { target: { value: 'shader-wash' } })
    act(() => {
      useShaderLibraryStore.setState({ definitions: [] })
    })

    expect(fullscreenShaderPicker().value).toBe('shader-wash')
    expect(screen.getByRole('option', { name: 'Ink Wash' })).toBeInTheDocument()
  })
})

describe('Fullscreen Shader command dispatch', () => {
  it('assigns a shader through SetFullscreenShaderCommand and undoes it', async () => {
    const { engine, undoStack, dispatcher } = renderFullscreenShaderInspector()
    seedCompiledLibrary()
    registerFullscreenShaders(engine)
    const slideId = createSlide(engine)

    await screen.findByRole('combobox', { name: 'Fullscreen Shader' })
    fireEvent.change(fullscreenShaderPicker(), { target: { value: 'shader-wash' } })

    expect(engine.project?.slides[0]?.fullscreenShader?.shaderDefinitionId).toBe('shader-wash')
    const assignEntry = undoStack.entries[0]
    expect(assignEntry.type).toBe('SetFullscreenShader')
    expect(assignEntry.parameters).toEqual({ slideId, shaderDefinitionId: 'shader-wash' })

    act(() => {
      undoLast(dispatcher, undoStack)
    })

    expect(engine.project?.slides[0]?.fullscreenShader).toBeNull()
    expect(fullscreenShaderPicker().value).toBe('')

    act(() => {
      redoEntry(dispatcher, assignEntry)
    })

    expect(engine.project?.slides[0]?.fullscreenShader?.shaderDefinitionId).toBe('shader-wash')
  })

  it('clears the shader back to None through SetFullscreenShaderCommand with null', async () => {
    const { engine, undoStack } = renderFullscreenShaderInspector()
    seedCompiledLibrary()
    registerFullscreenShaders(engine)
    const slideId = createSlide(engine)

    await screen.findByRole('combobox', { name: 'Fullscreen Shader' })
    fireEvent.change(fullscreenShaderPicker(), { target: { value: 'shader-wash' } })
    fireEvent.change(fullscreenShaderPicker(), { target: { value: '' } })

    expect(engine.project?.slides[0]?.fullscreenShader).toBeNull()
    expect(undoStack.entries[0].type).toBe('SetFullscreenShader')
    expect(undoStack.entries[0].parameters).toEqual({ slideId, shaderDefinitionId: null })
  })

  it('does not dispatch when selecting the already assigned shader', async () => {
    const { engine, undoStack } = renderFullscreenShaderInspector()
    seedCompiledLibrary()
    registerFullscreenShaders(engine)
    createSlide(engine)

    await screen.findByRole('combobox', { name: 'Fullscreen Shader' })
    fireEvent.change(fullscreenShaderPicker(), { target: { value: 'shader-wash' } })
    fireEvent.change(fullscreenShaderPicker(), { target: { value: 'shader-wash' } })

    expect(undoStack.entries).toHaveLength(1)
  })

  it('assigning a different shader resets previous overrides', async () => {
    const { engine } = renderFullscreenShaderInspector()
    seedCompiledLibrary()
    registerFullscreenShaders(engine)
    createSlide(engine)

    await screen.findByRole('combobox', { name: 'Fullscreen Shader' })
    fireEvent.change(fullscreenShaderPicker(), { target: { value: 'shader-wash' } })
    const intensity = screen.getByRole('spinbutton', { name: 'uIntensity' })
    fireEvent.change(intensity, { target: { value: '0.9' } })
    fireEvent.keyDown(intensity, { key: 'Enter' })
    expect(engine.project?.slides[0]?.fullscreenShader?.overrides).toEqual({ uIntensity: 0.9 })

    fireEvent.change(fullscreenShaderPicker(), { target: { value: 'shader-blur' } })

    expect(engine.project?.slides[0]?.fullscreenShader?.shaderDefinitionId).toBe('shader-blur')
    expect(engine.project?.slides[0]?.fullscreenShader?.overrides).toEqual({})
    expect((screen.getByRole('spinbutton', { name: 'uIntensity' }) as HTMLInputElement).value).toBe(
      '0.9',
    )
  })

  it('restores the previous shader and its overrides when undoing an assignment', async () => {
    const { engine, undoStack, dispatcher } = renderFullscreenShaderInspector()
    seedCompiledLibrary()
    registerFullscreenShaders(engine)
    createSlide(engine)

    await screen.findByRole('combobox', { name: 'Fullscreen Shader' })
    fireEvent.change(fullscreenShaderPicker(), { target: { value: 'shader-wash' } })
    const intensity = screen.getByRole('spinbutton', { name: 'uIntensity' })
    fireEvent.change(intensity, { target: { value: '0.9' } })
    fireEvent.keyDown(intensity, { key: 'Enter' })
    fireEvent.change(fullscreenShaderPicker(), { target: { value: 'shader-blur' } })
    expect(engine.project?.slides[0]?.fullscreenShader?.shaderDefinitionId).toBe('shader-blur')

    act(() => {
      undoLast(dispatcher, undoStack)
    })

    const reference = engine.project?.slides[0]?.fullscreenShader
    expect(reference?.shaderDefinitionId).toBe('shader-wash')
    expect(reference?.overrides).toEqual({ uIntensity: 0.9 })
    expect(fullscreenShaderPicker().value).toBe('shader-wash')
    expect((screen.getByRole('spinbutton', { name: 'uIntensity' }) as HTMLInputElement).value).toBe(
      '0.9',
    )
  })

  it('edits a float uniform into an override, clears it, and undoes both', async () => {
    const { engine, undoStack, dispatcher } = renderFullscreenShaderInspector()
    seedCompiledLibrary()
    registerFullscreenShaders(engine)
    const slideId = createSlide(engine)

    await screen.findByRole('combobox', { name: 'Fullscreen Shader' })
    fireEvent.change(fullscreenShaderPicker(), { target: { value: 'shader-wash' } })

    const intensity = screen.getByRole('spinbutton', { name: 'uIntensity' })
    fireEvent.change(intensity, { target: { value: '0.9' } })
    fireEvent.keyDown(intensity, { key: 'Enter' })

    expect(engine.project?.slides[0]?.fullscreenShader?.overrides.uIntensity).toBe(0.9)
    expect(screen.getByTitle('Override set')).toBeInTheDocument()
    const overrideEntry = undoStack.entries[0]
    expect(overrideEntry.type).toBe('OverrideFullscreenUniform')
    expect(overrideEntry.inverse).toEqual({ slideId, uniform: 'uIntensity', previousValue: null })

    fireEvent.click(screen.getByRole('button', { name: 'Clear uIntensity override' }))

    expect(engine.project?.slides[0]?.fullscreenShader?.overrides).toEqual({})
    expect(
      screen.queryByRole('button', { name: 'Clear uIntensity override' }),
    ).not.toBeInTheDocument()
    expect((screen.getByRole('spinbutton', { name: 'uIntensity' }) as HTMLInputElement).value).toBe(
      '0.5',
    )
    const clearEntry = undoStack.entries[0]
    expect(clearEntry.type).toBe('OverrideFullscreenUniform')

    act(() => {
      undoLast(dispatcher, undoStack)
    })

    expect(engine.project?.slides[0]?.fullscreenShader?.overrides.uIntensity).toBe(0.9)
    expect(screen.getByRole('button', { name: 'Clear uIntensity override' })).toBeInTheDocument()

    act(() => {
      redoEntry(dispatcher, clearEntry)
    })

    expect(engine.project?.slides[0]?.fullscreenShader?.overrides).toEqual({})
    expect(
      screen.queryByRole('button', { name: 'Clear uIntensity override' }),
    ).not.toBeInTheDocument()
  })
})

describe('Fullscreen Shader uniform controls', () => {
  it('shows definition defaults for unset uniforms', async () => {
    const { engine } = renderFullscreenShaderInspector()
    seedCompiledLibrary()
    registerFullscreenShaders(engine)
    createSlide(engine)

    await screen.findByRole('combobox', { name: 'Fullscreen Shader' })
    fireEvent.change(fullscreenShaderPicker(), { target: { value: 'shader-wash' } })

    expect((screen.getByRole('spinbutton', { name: 'uIntensity' }) as HTMLInputElement).value).toBe(
      '0.5',
    )
    expect(screen.getByRole('slider', { name: 'uIntensity slider' })).toBeInTheDocument()
    expect((screen.getByRole('checkbox', { name: 'uEnabled' }) as HTMLInputElement).checked).toBe(
      false,
    )
    expect((screen.getByRole('spinbutton', { name: 'uOffset.x' }) as HTMLInputElement).value).toBe(
      '0.1',
    )
    expect((screen.getByLabelText('uTintColor') as HTMLInputElement).value).toBe('#ff0000')
    expect(screen.getByRole('combobox', { name: 'uSampler' })).toBeInTheDocument()
    expect(screen.queryByTitle('Override set')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Clear uIntensity override' }),
    ).not.toBeInTheDocument()
  })

  it('edits a bool uniform into an override with undo', async () => {
    const { engine, undoStack, dispatcher } = renderFullscreenShaderInspector()
    seedCompiledLibrary()
    registerFullscreenShaders(engine)
    createSlide(engine)

    await screen.findByRole('combobox', { name: 'Fullscreen Shader' })
    fireEvent.change(fullscreenShaderPicker(), { target: { value: 'shader-wash' } })

    fireEvent.click(screen.getByRole('checkbox', { name: 'uEnabled' }))

    expect(engine.project?.slides[0]?.fullscreenShader?.overrides.uEnabled).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'uEnabled' }) as HTMLInputElement).checked).toBe(
      true,
    )

    act(() => {
      undoLast(dispatcher, undoStack)
    })

    expect(engine.project?.slides[0]?.fullscreenShader?.overrides).toEqual({})
    expect((screen.getByRole('checkbox', { name: 'uEnabled' }) as HTMLInputElement).checked).toBe(
      false,
    )
  })

  it('edits one vec component into a full-vector override', async () => {
    const { engine } = renderFullscreenShaderInspector()
    seedCompiledLibrary()
    registerFullscreenShaders(engine)
    createSlide(engine)

    await screen.findByRole('combobox', { name: 'Fullscreen Shader' })
    fireEvent.change(fullscreenShaderPicker(), { target: { value: 'shader-wash' } })

    const x = screen.getByRole('spinbutton', { name: 'uOffset.x' })
    fireEvent.change(x, { target: { value: '0.5' } })
    fireEvent.keyDown(x, { key: 'Enter' })

    expect(engine.project?.slides[0]?.fullscreenShader?.overrides.uOffset).toEqual([0.5, 0.2])
    expect(screen.getByRole('button', { name: 'Clear uOffset override' })).toBeInTheDocument()
  })

  it('picks an asset for a sampler uniform and clears back to None', async () => {
    const { engine } = renderFullscreenShaderInspector()
    seedCompiledLibrary()
    seedAssetLibrary()
    registerFullscreenShaders(engine)
    createSlide(engine)

    await screen.findByRole('combobox', { name: 'Fullscreen Shader' })
    fireEvent.change(fullscreenShaderPicker(), { target: { value: 'shader-wash' } })

    const sampler = screen.getByRole('combobox', { name: 'uSampler' }) as HTMLSelectElement
    fireEvent.change(sampler, { target: { value: 'asset-noise' } })

    expect(engine.project?.slides[0]?.fullscreenShader?.overrides.uSampler).toBe('asset-noise')
    expect(screen.getByRole('button', { name: 'Clear uSampler override' })).toBeInTheDocument()

    fireEvent.change(sampler, { target: { value: '' } })

    expect(engine.project?.slides[0]?.fullscreenShader?.overrides).toEqual({})
    expect(
      screen.queryByRole('button', { name: 'Clear uSampler override' }),
    ).not.toBeInTheDocument()
  })

  it('reflects a changed definition default in unset uniforms', async () => {
    const { engine } = renderFullscreenShaderInspector()
    seedCompiledLibrary()
    registerFullscreenShaders(engine)
    createSlide(engine)

    await screen.findByRole('combobox', { name: 'Fullscreen Shader' })
    fireEvent.change(fullscreenShaderPicker(), { target: { value: 'shader-wash' } })
    expect((screen.getByRole('spinbutton', { name: 'uIntensity' }) as HTMLInputElement).value).toBe(
      '0.5',
    )

    act(() => {
      engine.registerShaderDefinition('shader-wash', 'Ink Wash', [
        { key: 'uIntensity', kind: 'float', default: 0.9 },
      ])
      seedShaderLibrary([shaderDefinition()], { 'shader-wash': compiled() })
    })

    expect((screen.getByRole('spinbutton', { name: 'uIntensity' }) as HTMLInputElement).value).toBe(
      '0.9',
    )
    expect(engine.project?.slides[0]?.fullscreenShader?.overrides).toEqual({})
  })
})

describe('Fullscreen Shader degraded mode', () => {
  it('shows the unavailable state, blocks assignment, and preserves the reference', async () => {
    const { engine } = renderFullscreenShaderInspector()
    seedCompiledLibrary()
    registerFullscreenShaders(engine)
    createSlide(engine)

    await screen.findByRole('combobox', { name: 'Fullscreen Shader' })
    fireEvent.change(fullscreenShaderPicker(), { target: { value: 'shader-wash' } })
    act(() => {
      useShaderLibraryStore.setState({ definitions: [], compileStatus: {}, unavailable: true })
    })

    expect(
      screen.getByText('Shader library unavailable — start the backend to assign shaders.'),
    ).toBeInTheDocument()
    const picker = fullscreenShaderPicker()
    expect(picker).toBeDisabled()
    expect(picker.value).toBe('shader-wash')
    expect(screen.getByRole('option', { name: 'Ink Wash' })).toBeInTheDocument()

    fireEvent.change(picker, { target: { value: 'shader-blur' } })

    expect(engine.project?.slides[0]?.fullscreenShader?.shaderDefinitionId).toBe('shader-wash')
    expect(engine.project?.slides[0]?.fullscreenShader?.overrides).toEqual({})

    const intensity = screen.getByRole('spinbutton', { name: 'uIntensity' })
    expect((intensity as HTMLInputElement).disabled).toBe(true)
    fireEvent.change(intensity, { target: { value: '0.9' } })
    fireEvent.keyDown(intensity, { key: 'Enter' })
    expect(engine.project?.slides[0]?.fullscreenShader?.overrides).toEqual({})
  })
})
