import { act } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { AssignMaterialCommand, OverrideMaterialParameterCommand } from '../engine/commands'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'
import { useUiStore } from '../stores/uiStore'
import {
  clearTintButton,
  createSceneWithNode,
  createSecondNode,
  materialPicker,
  multiplierInput,
  registerMaterials,
  renderMaterialInspector,
  select,
  selectMany,
  tintInput,
} from './materialInspectorHarness'

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  usePlaybackController.setState({ currentTimes: {} })
  localStorage.clear()
  useUiStore.setState({ animationMode: true, cameraAnimationMode: false })
})

describe('InspectorPanel Material multi-selection', () => {
  it('shows the mixed option when selections differ and assigns to all as one transaction', () => {
    const { engine, undoStack, dispatcher } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    const secondId = createSecondNode(engine)
    registerMaterials(engine)
    act(() => {
      dispatcher.dispatch(new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-red' }))
    })
    selectMany([nodeId, secondId])
    const before = undoStack.entries.length

    expect(materialPicker().value).toBe('')
    expect(screen.getByRole('option', { name: /Mixed/ })).toBeInTheDocument()

    fireEvent.change(materialPicker(), { target: { value: 'mat-blue' } })

    expect(engine.getNode(nodeId).material.materialDefinitionId).toBe('mat-blue')
    expect(engine.getNode(secondId).material.materialDefinitionId).toBe('mat-blue')
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
    const children = (
      undoStack.entries[0].parameters.commands as { type: string; nodeId: string }[]
    ).map((command) => ({ type: command.type, nodeId: command.nodeId }))
    expect(children).toEqual([
      { type: 'AssignMaterial', nodeId },
      { type: 'AssignMaterial', nodeId: secondId },
    ])
  })

  it('applies a tint override to every selected node as one transaction and clears only the overridden ones', () => {
    const { engine, undoStack } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    const secondId = createSecondNode(engine)
    registerMaterials(engine)
    selectMany([nodeId, secondId])

    fireEvent.change(tintInput(), { target: { value: '#ff0000' } })

    expect(engine.getNode(nodeId).material.overrides).toEqual({ tint: '#ff0000' })
    expect(engine.getNode(secondId).material.overrides).toEqual({ tint: '#ff0000' })
    expect(undoStack.entries[0].type).toBe('Transaction')
    const children = (
      undoStack.entries[0].parameters.commands as { type: string; nodeId: string }[]
    ).map((command) => ({ type: command.type, nodeId: command.nodeId }))
    expect(children).toEqual([
      { type: 'OverrideMaterialParameter', nodeId },
      { type: 'OverrideMaterialParameter', nodeId: secondId },
    ])
    expect(screen.getByTitle('Override set')).toBeInTheDocument()

    fireEvent.change(materialPicker(), { target: { value: 'mat-blue' } })

    expect(engine.getNode(nodeId).material.overrides).toEqual({})
    expect(engine.getNode(secondId).material.overrides).toEqual({})
    expect(screen.queryByRole('button', { name: 'Clear Tint override' })).not.toBeInTheDocument()
  })

  it('shows the mixed override state when only some selected nodes are overridden', () => {
    const { engine, dispatcher } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    const secondId = createSecondNode(engine)
    registerMaterials(engine)
    act(() => {
      dispatcher.dispatch(
        new OverrideMaterialParameterCommand({ nodeId, parameter: 'tint', value: '#ff0000' }),
      )
    })
    selectMany([nodeId, secondId])

    expect(screen.getByTitle('Override set on some')).toBeInTheDocument()
    fireEvent.click(clearTintButton())

    expect(engine.getNode(nodeId).material.overrides).toEqual({})
    expect(engine.getNode(secondId).material.overrides).toEqual({})
  })

  it('shows a shared tint when every selected node shares it', () => {
    const { engine, dispatcher } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    const secondId = createSecondNode(engine)
    registerMaterials(engine)
    act(() => {
      dispatcher.dispatch(
        new OverrideMaterialParameterCommand({ nodeId, parameter: 'tint', value: '#00ff00' }),
      )
      dispatcher.dispatch(
        new OverrideMaterialParameterCommand({
          nodeId: secondId,
          parameter: 'tint',
          value: '#00ff00',
        }),
      )
    })
    selectMany([nodeId, secondId])

    expect(tintInput().value).toBe('#00ff00')
    expect(screen.getByTitle('Override set')).toBeInTheDocument()
  })

  it('shows the mixed tint fallback with a mixed title when effective tints differ', () => {
    const { engine, dispatcher } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    const secondId = createSecondNode(engine)
    registerMaterials(engine)
    act(() => {
      dispatcher.dispatch(new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-blue' }))
    })
    selectMany([nodeId, secondId])

    expect(screen.getByTitle('Mixed values')).toBeInTheDocument()
    expect(multiplierInput().value).toBe('—')
  })
})

describe('InspectorPanel Material during playback', () => {
  beforeEach(() => {
    useUiStore.setState({ animationMode: false, cameraAnimationMode: false })
  })

  it('disables the picker, tint, and multiplier controls while playing', () => {
    const { engine } = renderMaterialInspector()
    const { nodeId } = createSceneWithNode(engine)
    registerMaterials(engine)
    select(nodeId)
    const slideId = engine.project?.slides[0].id ?? ''
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    act(() => {
      usePlaybackController.getState().setCurrentTime(slideId, 0, slide.duration)
      usePlaybackController.setState({ status: 'playing' })
    })

    expect(materialPicker()).toBeDisabled()
    expect(tintInput()).toBeDisabled()
    expect(multiplierInput()).toBeDisabled()
  })
})
