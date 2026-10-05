import { act } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { useNotificationStore } from '../stores/notificationStore'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'
import { useUiStore } from '../stores/uiStore'
import {
  clearMultiplierButton,
  clearTintButton,
  createGroupNode,
  createSceneWithNode,
  createTextNode,
  defaultMaterialDefinitionId,
  materialPicker,
  multiplierInput,
  redoEntry,
  registerMaterials,
  renderMaterialInspector,
  select,
  selectMany,
  tintInput,
  undoLast,
} from './materialInspectorHarness'

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  useNotificationStore.setState({ notifications: [] })
  usePlaybackController.setState({ currentTimes: {} })
  localStorage.clear()
  useUiStore.setState({ animationMode: true, cameraAnimationMode: false })
})

describe('InspectorPanel Material section', () => {
  it('renders for a renderable node with the library picker and definition defaults', () => {
    const { engine } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    registerMaterials(engine)
    select(nodeId)

    expect(screen.getByRole('heading', { name: 'Material' })).toBeInTheDocument()
    const picker = materialPicker()
    const options = [...picker.options].map((option) => option.value)
    expect(options).toEqual([defaultMaterialDefinitionId(), 'mat-red', 'mat-blue'])
    expect(picker.value).toBe(defaultMaterialDefinitionId())
    expect(tintInput().value).toBe('#ffffff')
    expect(multiplierInput().value).toBe('100')
  })

  it('shows no Material section for camera nodes', () => {
    const { engine } = renderMaterialInspector()
    const { cameraId } = createSceneWithNode(engine)
    registerMaterials(engine)
    select(cameraId)

    expect(screen.queryByRole('heading', { name: 'Material' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Material' })).not.toBeInTheDocument()
  })

  it('renders for group nodes so a shader material can filter their subtree', () => {
    const { engine } = renderMaterialInspector()
    createSceneWithNode(engine)
    const groupId = createGroupNode(engine)
    registerMaterials(engine)
    select(groupId)

    expect(screen.getByRole('heading', { name: 'Material' })).toBeInTheDocument()
    expect(materialPicker().value).toBe(defaultMaterialDefinitionId())

    fireEvent.change(materialPicker(), { target: { value: 'mat-red' } })
    expect(engine.getNode(groupId).material.materialDefinitionId).toBe('mat-red')
  })

  it('renders for an empty group before its first child arrives', () => {
    const { engine } = renderMaterialInspector()
    createSceneWithNode(engine)
    const groupId = createGroupNode(engine)
    expect(engine.getNode(groupId).children).toHaveLength(0)
    registerMaterials(engine)
    select(groupId)

    expect(screen.getByRole('heading', { name: 'Material' })).toBeInTheDocument()
  })

  it('shows no Material section for the scene root', () => {
    const { engine } = renderMaterialInspector()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    registerMaterials(engine)
    select(slide.scene.root.id)

    expect(screen.queryByRole('heading', { name: 'Material' })).not.toBeInTheDocument()
  })

  it('notes the ancestor group shader that composites the selected child', () => {
    const { engine } = renderMaterialInspector()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    engine.registerShaderDefinition('shader-chalk', 'Chalk')
    engine.registerMaterialDefinition('mat-chalk', 'Chalk', [], 'shader-chalk')
    const group = engine.createNode(slide.scene.id, slide.scene.root.id, 'Board')
    engine.assignMaterial(group.id, 'mat-chalk')
    const child = engine.createNode(slide.scene.id, group.id, 'Title', {
      components: { text: { kind: 'text', content: 'Hi', fontSize: 24, alignment: 'left' } },
    })
    select(child.id)

    const notice = screen.getByTestId('inherited-shader-notice')
    expect(notice).toHaveTextContent('Composited through the Chalk shader on group “Board”')

    fireEvent.click(screen.getByRole('button', { name: 'Select group' }))
    expect(useSelectionStore.getState().selectedIds).toEqual([group.id])
  })

  it('shows no inherited shader note when no ancestor group carries a shader', () => {
    const { engine } = renderMaterialInspector()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const group = engine.createNode(slide.scene.id, slide.scene.root.id, 'Board')
    const child = engine.createNode(slide.scene.id, group.id, 'Title', {
      components: { text: { kind: 'text', content: 'Hi', fontSize: 24, alignment: 'left' } },
    })
    select(child.id)

    expect(screen.getByRole('heading', { name: 'Material' })).toBeInTheDocument()
    expect(screen.queryByTestId('inherited-shader-notice')).not.toBeInTheDocument()
  })

  it('renders for text nodes', () => {
    const { engine } = renderMaterialInspector()
    createSceneWithNode(engine)
    const textId = createTextNode(engine)
    registerMaterials(engine)
    select(textId)

    expect(screen.getByRole('heading', { name: 'Material' })).toBeInTheDocument()
    expect(materialPicker().value).toBe(defaultMaterialDefinitionId())
  })

  it('shows no Material section when nothing is selected', () => {
    renderMaterialInspector()

    expect(screen.queryByRole('heading', { name: 'Material' })).not.toBeInTheDocument()
  })

  it('shows no Material section when a camera is part of a multi-selection', () => {
    const { engine } = renderMaterialInspector()
    const { nodeId, cameraId } = createSceneWithNode(engine)
    registerMaterials(engine)
    selectMany([nodeId, cameraId])

    expect(screen.queryByRole('heading', { name: 'Material' })).not.toBeInTheDocument()
  })
})

describe('InspectorPanel Material picker', () => {
  it('assigns a material, records inverse data, and is undoable back to the previous material with overrides', () => {
    const { engine, undoStack, dispatcher } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    registerMaterials(engine)
    select(nodeId)

    fireEvent.change(tintInput(), { target: { value: '#ff0000' } })
    fireEvent.change(materialPicker(), { target: { value: 'mat-red' } })

    expect(engine.getNode(nodeId).material).toEqual({
      materialDefinitionId: 'mat-red',
      overrides: {},
    })
    const assignEntry = undoStack.entries[0]
    expect(assignEntry.type).toBe('AssignMaterial')
    expect(assignEntry.inverse).toEqual({
      nodeId,
      previousMaterialDefinitionId: defaultMaterialDefinitionId(),
      previousOverrides: { tint: '#ff0000' },
    })

    act(() => {
      undoLast(dispatcher, undoStack)
    })

    expect(engine.getNode(nodeId).material).toEqual({
      materialDefinitionId: defaultMaterialDefinitionId(),
      overrides: { tint: '#ff0000' },
    })
    expect(tintInput().value).toBe('#ff0000')
    expect(clearTintButton()).toBeInTheDocument()

    act(() => {
      redoEntry(dispatcher, assignEntry)
    })

    expect(engine.getNode(nodeId).material).toEqual({
      materialDefinitionId: 'mat-red',
      overrides: {},
    })
    expect(materialPicker().value).toBe('mat-red')
  })

  it('reassigning a different material clears the previous overrides', () => {
    const { engine } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    registerMaterials(engine)
    select(nodeId)

    fireEvent.change(tintInput(), { target: { value: '#ff0000' } })
    fireEvent.change(materialPicker(), { target: { value: 'mat-red' } })
    fireEvent.change(materialPicker(), { target: { value: 'mat-blue' } })

    expect(engine.getNode(nodeId).material).toEqual({
      materialDefinitionId: 'mat-blue',
      overrides: {},
    })
    expect(tintInput().value).toBe('#0000ff')
    expect(multiplierInput().value).toBe('80')
    expect(screen.queryByRole('button', { name: 'Clear Tint override' })).not.toBeInTheDocument()
  })

  it('records nothing when assigning the current material', () => {
    const { engine, undoStack } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    registerMaterials(engine)
    select(nodeId)
    const before = undoStack.entries.length

    fireEvent.change(materialPicker(), { target: { value: defaultMaterialDefinitionId() } })

    expect(undoStack.entries).toHaveLength(before)
  })
})

describe('InspectorPanel Material tint', () => {
  it('edits the tint through the color input, shows the override indicator, and clears it', () => {
    const { engine, undoStack, dispatcher } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    registerMaterials(engine)
    select(nodeId)

    expect(tintInput().value).toBe('#ffffff')
    expect(screen.queryByRole('button', { name: 'Clear Tint override' })).not.toBeInTheDocument()

    fireEvent.change(tintInput(), { target: { value: '#ff0000' } })

    expect(engine.getNode(nodeId).material.overrides).toEqual({ tint: '#ff0000' })
    expect(tintInput().value).toBe('#ff0000')
    expect(screen.getByTitle('Override set')).toBeInTheDocument()
    expect(clearTintButton()).toBeInTheDocument()
    expect(undoStack.entries[0].type).toBe('OverrideMaterialParameter')
    expect(undoStack.entries[0].inverse).toEqual({
      nodeId,
      parameter: 'tint',
      previousValue: null,
    })

    fireEvent.click(clearTintButton())

    expect(engine.getNode(nodeId).material.overrides).toEqual({})
    expect(tintInput().value).toBe('#ffffff')
    expect(screen.queryByRole('button', { name: 'Clear Tint override' })).not.toBeInTheDocument()
    const clearEntry = undoStack.entries[0]
    expect(clearEntry.type).toBe('ClearMaterialOverride')
    expect(clearEntry.inverse).toEqual({
      nodeId,
      parameter: 'tint',
      removedValue: '#ff0000',
    })

    act(() => {
      undoLast(dispatcher, undoStack)
    })

    expect(engine.getNode(nodeId).material.overrides).toEqual({ tint: '#ff0000' })
    expect(tintInput().value).toBe('#ff0000')
    expect(clearTintButton()).toBeInTheDocument()

    act(() => {
      redoEntry(dispatcher, clearEntry)
    })

    expect(engine.getNode(nodeId).material.overrides).toEqual({})
    expect(tintInput().value).toBe('#ffffff')
  })

  it('shows the definition default for a material with a non-white tint', () => {
    const { engine } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    registerMaterials(engine)
    select(nodeId)
    fireEvent.change(materialPicker(), { target: { value: 'mat-blue' } })

    expect(tintInput().value).toBe('#0000ff')
    expect(multiplierInput().value).toBe('80')
  })
})

describe('InspectorPanel Material opacity multiplier', () => {
  it('edits the multiplier as a percentage, clamps out-of-range input, and shows the indicator', async () => {
    const { engine, undoStack, dispatcher } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    registerMaterials(engine)
    select(nodeId)
    const user = userEvent.setup()

    const multiplier = multiplierInput()
    await user.clear(multiplier)
    await user.type(multiplier, '50')
    await user.keyboard('{Enter}')

    expect(engine.getNode(nodeId).material.overrides).toEqual({ opacityMultiplier: 0.5 })
    expect(multiplierInput().value).toBe('50')
    expect(screen.getByTitle('Override set')).toBeInTheDocument()
    expect(clearMultiplierButton()).toBeInTheDocument()
    const overrideEntry = undoStack.entries[0]
    expect(overrideEntry.type).toBe('OverrideMaterialParameter')
    expect(overrideEntry.inverse).toEqual({
      nodeId,
      parameter: 'opacityMultiplier',
      previousValue: null,
    })

    act(() => {
      undoLast(dispatcher, undoStack)
    })

    expect(engine.getNode(nodeId).material.overrides).toEqual({})
    expect(multiplierInput().value).toBe('100')
    expect(
      screen.queryByRole('button', { name: 'Clear Opacity Multiplier override' }),
    ).not.toBeInTheDocument()

    act(() => {
      redoEntry(dispatcher, overrideEntry)
    })

    expect(engine.getNode(nodeId).material.overrides).toEqual({ opacityMultiplier: 0.5 })
    expect(multiplierInput().value).toBe('50')
    expect(clearMultiplierButton()).toBeInTheDocument()

    await user.clear(multiplier)
    await user.type(multiplier, '150')
    await user.keyboard('{Enter}')

    expect(engine.getNode(nodeId).material.overrides).toEqual({ opacityMultiplier: 1 })
    expect(multiplierInput().value).toBe('100')

    fireEvent.click(clearMultiplierButton())

    expect(engine.getNode(nodeId).material.overrides).toEqual({})
    expect(multiplierInput().value).toBe('100')
    expect(
      screen.queryByRole('button', { name: 'Clear Opacity Multiplier override' }),
    ).not.toBeInTheDocument()
    expect(undoStack.entries[0].type).toBe('ClearMaterialOverride')
  })

  it('rejects non-numeric input with a notification and leaves the engine unchanged', async () => {
    const { engine, undoStack } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    registerMaterials(engine)
    select(nodeId)
    const user = userEvent.setup()
    const before = undoStack.entries.length

    const multiplier = multiplierInput()
    await user.clear(multiplier)
    await user.type(multiplier, 'abc')
    await user.keyboard('{Enter}')

    expect(engine.getNode(nodeId).material.overrides).toEqual({})
    expect(undoStack.entries).toHaveLength(before)
    expect(useNotificationStore.getState().notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'Opacity Multiplier must be a number' }),
      ]),
    )
    expect(multiplierInput().value).toBe('100')
  })

  it('records nothing when the entered value matches the effective value', async () => {
    const { engine, undoStack } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    registerMaterials(engine)
    select(nodeId)
    const user = userEvent.setup()

    const multiplier = multiplierInput()
    await user.clear(multiplier)
    await user.type(multiplier, '100')
    await user.keyboard('{Enter}')

    expect(undoStack.entries).toHaveLength(0)
    expect(engine.getNode(nodeId).material.overrides).toEqual({})
  })
})
