import { act } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'
import { useMaterialLibraryStore } from '../stores/materialLibraryStore'
import { useNotificationStore } from '../stores/notificationStore'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'
import { useUiStore } from '../stores/uiStore'
import {
  createSceneWithNode,
  createSecondNode,
  materialPicker,
  redoEntry,
  registerMaterials,
  renderMaterialInspector,
  select,
  selectMany,
  undoLast,
} from './materialInspectorHarness'

export const UNIFORM_MATERIAL_PARAMETERS = [
  { key: 'tint', kind: 'color', default: '#ffffff' },
  { key: 'opacityMultiplier', kind: 'number', default: 1 },
  { key: 'uIntensity', kind: 'float', default: 0.5 },
  { key: 'uSteps', kind: 'int', default: 2 },
  { key: 'uEnabled', kind: 'bool', default: false },
  { key: 'uOffset', kind: 'vec2', default: [0.1, 0.2] },
  { key: 'uTintColor', kind: 'vec3', default: [1, 0, 0] },
  { key: 'uFadeColor', kind: 'vec4', default: [0, 0.5, 1, 0.5] },
  { key: 'uSampler', kind: 'sampler2D', default: '' },
]

function assignUniformMaterial(engine: ReturnType<typeof renderMaterialInspector>['engine']) {
  engine.registerMaterialDefinition('mat-uniform', 'Uniform Mat', UNIFORM_MATERIAL_PARAMETERS)
}

function seedAssetLibrary(): void {
  useAssetLibraryStore.setState({
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
  useAssetLibraryStore.setState({
    definitions: [],
    unavailable: false,
  })
  useMaterialLibraryStore.setState({ definitions: [] })
  localStorage.clear()
  useUiStore.setState({ animationMode: true, cameraAnimationMode: false })
})

describe('Material section uniform controls', () => {
  it('renders one generated control per reflected uniform with definition defaults', () => {
    const { engine } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    registerMaterials(engine)
    assignUniformMaterial(engine)
    select(nodeId)

    fireEvent.change(materialPicker(), { target: { value: 'mat-uniform' } })

    expect(screen.getByRole('heading', { name: 'Shader Uniforms' })).toBeInTheDocument()
    expect((screen.getByRole('spinbutton', { name: 'uIntensity' }) as HTMLInputElement).value).toBe(
      '0.5',
    )
    expect(screen.getByRole('slider', { name: 'uIntensity slider' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'uSteps' })).toBeInTheDocument()
    expect(screen.queryByRole('slider', { name: 'uSteps slider' })).not.toBeInTheDocument()
    expect((screen.getByRole('checkbox', { name: 'uEnabled' }) as HTMLInputElement).checked).toBe(
      false,
    )
    expect((screen.getByRole('spinbutton', { name: 'uOffset.x' }) as HTMLInputElement).value).toBe(
      '0.1',
    )
    expect((screen.getByRole('spinbutton', { name: 'uOffset.y' }) as HTMLInputElement).value).toBe(
      '0.2',
    )
    expect((screen.getByLabelText('uTintColor') as HTMLInputElement).value).toBe('#ff0000')
    expect((screen.getByLabelText('uFadeColor') as HTMLInputElement).value).toBe('#0080ff')
    expect(
      (screen.getByRole('spinbutton', { name: 'uFadeColor alpha' }) as HTMLInputElement).value,
    ).toBe('0.5')
    expect(screen.getByRole('combobox', { name: 'uSampler' })).toBeInTheDocument()
  })

  it('never renders the reserved uTexture uniform', () => {
    const { engine } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    registerMaterials(engine)
    engine.registerMaterialDefinition('mat-reserved', 'Reserved', [
      { key: 'tint', kind: 'color', default: '#ffffff' },
      { key: 'opacityMultiplier', kind: 'number', default: 1 },
      { key: 'uTexture', kind: 'sampler2D', default: '' },
      { key: 'uOther', kind: 'float', default: 0 },
    ])
    select(nodeId)

    fireEvent.change(materialPicker(), { target: { value: 'mat-reserved' } })

    expect(screen.queryByRole('combobox', { name: 'uTexture' })).not.toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'uOther' })).toBeInTheDocument()
  })

  it('shows no uniforms for a material without a shader', () => {
    const { engine } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    registerMaterials(engine)
    select(nodeId)

    expect(screen.queryByRole('heading', { name: 'Shader Uniforms' })).not.toBeInTheDocument()
  })
})

describe('Material section uniform editing', () => {
  it('edits a float uniform into an override, shows the indicator, clears it, and undoes both', () => {
    const { engine, undoStack, dispatcher } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    registerMaterials(engine)
    assignUniformMaterial(engine)
    select(nodeId)
    fireEvent.change(materialPicker(), { target: { value: 'mat-uniform' } })

    const intensity = screen.getByRole('spinbutton', { name: 'uIntensity' })
    fireEvent.change(intensity, { target: { value: '0.9' } })
    fireEvent.keyDown(intensity, { key: 'Enter' })

    expect(engine.getNode(nodeId).material.overrides.uIntensity).toBe(0.9)
    expect(screen.getByTitle('Override set')).toBeInTheDocument()
    const clearButton = screen.getByRole('button', { name: 'Clear uIntensity override' })
    const overrideEntry = undoStack.entries[0]
    expect(overrideEntry.type).toBe('OverrideMaterialParameter')
    expect(overrideEntry.inverse).toEqual({
      nodeId,
      parameter: 'uIntensity',
      previousValue: null,
    })

    fireEvent.click(clearButton)

    expect(engine.getNode(nodeId).material.overrides).toEqual({})
    expect(
      screen.queryByRole('button', { name: 'Clear uIntensity override' }),
    ).not.toBeInTheDocument()
    expect((screen.getByRole('spinbutton', { name: 'uIntensity' }) as HTMLInputElement).value).toBe(
      '0.5',
    )
    const clearEntry = undoStack.entries[0]
    expect(clearEntry.type).toBe('ClearMaterialOverride')

    act(() => {
      undoLast(dispatcher, undoStack)
    })

    expect(engine.getNode(nodeId).material.overrides.uIntensity).toBe(0.9)
    expect((screen.getByRole('spinbutton', { name: 'uIntensity' }) as HTMLInputElement).value).toBe(
      '0.9',
    )
    expect(screen.getByRole('button', { name: 'Clear uIntensity override' })).toBeInTheDocument()

    act(() => {
      redoEntry(dispatcher, clearEntry)
    })

    expect(engine.getNode(nodeId).material.overrides).toEqual({})
    expect(
      screen.queryByRole('button', { name: 'Clear uIntensity override' }),
    ).not.toBeInTheDocument()
  })

  it('edits a float uniform through the slider', () => {
    const { engine } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    registerMaterials(engine)
    assignUniformMaterial(engine)
    select(nodeId)
    fireEvent.change(materialPicker(), { target: { value: 'mat-uniform' } })

    fireEvent.change(screen.getByRole('slider', { name: 'uIntensity slider' }), {
      target: { value: '0.75' },
    })

    expect(engine.getNode(nodeId).material.overrides.uIntensity).toBe(0.75)
  })

  it('toggles a bool uniform through the checkbox with undo', () => {
    const { engine, undoStack, dispatcher } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    registerMaterials(engine)
    assignUniformMaterial(engine)
    select(nodeId)
    fireEvent.change(materialPicker(), { target: { value: 'mat-uniform' } })

    fireEvent.click(screen.getByRole('checkbox', { name: 'uEnabled' }))

    expect(engine.getNode(nodeId).material.overrides.uEnabled).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'uEnabled' }) as HTMLInputElement).checked).toBe(
      true,
    )

    act(() => {
      undoLast(dispatcher, undoStack)
    })

    expect(engine.getNode(nodeId).material.overrides).toEqual({})
    expect((screen.getByRole('checkbox', { name: 'uEnabled' }) as HTMLInputElement).checked).toBe(
      false,
    )
  })

  it('edits one vec component into a full-vector override', () => {
    const { engine } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    registerMaterials(engine)
    assignUniformMaterial(engine)
    select(nodeId)
    fireEvent.change(materialPicker(), { target: { value: 'mat-uniform' } })

    const x = screen.getByRole('spinbutton', { name: 'uOffset.x' })
    fireEvent.change(x, { target: { value: '0.5' } })
    fireEvent.keyDown(x, { key: 'Enter' })

    expect(engine.getNode(nodeId).material.overrides.uOffset).toEqual([0.5, 0.2])
    expect(screen.getByRole('button', { name: 'Clear uOffset override' })).toBeInTheDocument()
  })

  it('maps a color-named vec3 to the color picker and commits RGB overrides', () => {
    const { engine } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    registerMaterials(engine)
    assignUniformMaterial(engine)
    select(nodeId)
    fireEvent.change(materialPicker(), { target: { value: 'mat-uniform' } })

    fireEvent.change(screen.getByLabelText('uTintColor'), { target: { value: '#00ff00' } })

    expect(engine.getNode(nodeId).material.overrides.uTintColor).toEqual([0, 1, 0])
    expect(screen.getByRole('button', { name: 'Clear uTintColor override' })).toBeInTheDocument()
  })

  it('maps a color-named vec4 with a separate alpha edit', () => {
    const { engine } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    registerMaterials(engine)
    assignUniformMaterial(engine)
    select(nodeId)
    fireEvent.change(materialPicker(), { target: { value: 'mat-uniform' } })

    const alpha = screen.getByRole('spinbutton', { name: 'uFadeColor alpha' })
    fireEvent.change(alpha, { target: { value: '1' } })
    fireEvent.keyDown(alpha, { key: 'Enter' })

    expect(engine.getNode(nodeId).material.overrides.uFadeColor).toEqual([0, 0.5, 1, 1])
    expect(
      (screen.getByRole('spinbutton', { name: 'uFadeColor alpha' }) as HTMLInputElement).value,
    ).toBe('1')
  })

  it('picks a library asset for a sampler uniform and clears back to None', () => {
    const { engine } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    registerMaterials(engine)
    assignUniformMaterial(engine)
    seedAssetLibrary()
    select(nodeId)
    fireEvent.change(materialPicker(), { target: { value: 'mat-uniform' } })

    const picker = screen.getByRole('combobox', { name: 'uSampler' }) as HTMLSelectElement
    fireEvent.change(picker, { target: { value: 'asset-noise' } })

    expect(engine.getNode(nodeId).material.overrides.uSampler).toBe('asset-noise')
    expect(screen.getByRole('button', { name: 'Clear uSampler override' })).toBeInTheDocument()

    fireEvent.change(picker, { target: { value: '' } })

    expect(engine.getNode(nodeId).material.overrides).toEqual({})
    expect(
      screen.queryByRole('button', { name: 'Clear uSampler override' }),
    ).not.toBeInTheDocument()
  })
})

describe('Material section uniforms — definition defaults and multi-selection', () => {
  it('reflects a changed definition default in unset instances', () => {
    const { engine } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    registerMaterials(engine)
    assignUniformMaterial(engine)
    select(nodeId)
    fireEvent.change(materialPicker(), { target: { value: 'mat-uniform' } })

    expect((screen.getByRole('spinbutton', { name: 'uIntensity' }) as HTMLInputElement).value).toBe(
      '0.5',
    )

    act(() => {
      engine.registerMaterialDefinition(
        'mat-uniform',
        'Uniform Mat',
        UNIFORM_MATERIAL_PARAMETERS.map((parameter) =>
          parameter.key === 'uIntensity' ? { ...parameter, default: 0.9 } : parameter,
        ),
      )
      useMaterialLibraryStore.setState({
        definitions: [
          {
            id: 'mat-uniform',
            name: 'Uniform Mat',
            description: '',
            tags: [],
            created_at: '',
            updated_at: '',
            parameters: [],
            shader_id: null,
          },
        ],
      })
    })

    expect((screen.getByRole('spinbutton', { name: 'uIntensity' }) as HTMLInputElement).value).toBe(
      '0.9',
    )
    expect(engine.getNode(nodeId).material.overrides).toEqual({})
  })

  it('shows mixed markers and disabled controls when selected nodes carry different values', () => {
    const { engine } = renderMaterialInspector()
    createSceneWithNode(engine)
    const firstId = createSecondNode(engine, 'Second')
    registerMaterials(engine)
    assignUniformMaterial(engine)
    select(firstId)
    fireEvent.change(materialPicker(), { target: { value: 'mat-uniform' } })

    const first = engine.getNode(firstId)
    const slider = screen.getByRole('slider', { name: 'uIntensity slider' })
    fireEvent.change(slider, { target: { value: '0.75' } })
    expect(engine.getNode(firstId).material.overrides.uIntensity).toBe(0.75)
    expect(first.material.overrides.uIntensity).toBe(0.75)

    const secondId = createSecondNode(engine, 'Third')
    selectMany([firstId, secondId])

    const intensity = screen.getByRole('textbox', { name: 'uIntensity' }) as HTMLInputElement
    expect(intensity.value).toBe('—')
    expect(
      (screen.getByRole('slider', { name: 'uIntensity slider' }) as HTMLInputElement).disabled,
    ).toBe(true)
    expect(screen.getByTitle('Override set on some')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear uIntensity override' }))

    expect(engine.getNode(firstId).material.overrides).toEqual({})
    expect(engine.getNode(secondId).material.overrides).toEqual({})
  })

  it('overrides on multi-selection apply to every selected node', () => {
    const { engine } = renderMaterialInspector()
    createSceneWithNode(engine)
    const firstId = createSecondNode(engine, 'Second')
    const secondId = createSecondNode(engine, 'Third')
    registerMaterials(engine)
    assignUniformMaterial(engine)
    selectMany([firstId, secondId])

    fireEvent.change(materialPicker(), { target: { value: 'mat-uniform' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'uEnabled' }))

    expect(engine.getNode(firstId).material.overrides.uEnabled).toBe(true)
    expect(engine.getNode(secondId).material.overrides.uEnabled).toBe(true)
    expect(screen.getByTitle('Override set')).toBeInTheDocument()
  })
})
