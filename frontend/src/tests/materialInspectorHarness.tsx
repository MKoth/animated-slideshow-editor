import { act } from 'react'
import { render, screen } from '@testing-library/react'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { InspectorPanel } from '../components/panels/InspectorPanel'
import {
  AssignMaterialCommand,
  ClearMaterialOverrideCommand,
  CommandDispatcher,
  OverrideMaterialParameterCommand,
  UndoStack,
} from '../engine/commands'
import type {
  AssignMaterialInverse,
  AssignMaterialParameters,
  ClearMaterialOverrideInverse,
  ClearMaterialOverrideParameters,
  OverrideMaterialParameterInverse,
  OverrideMaterialParameterParameters,
  UndoStackEntry,
} from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { DEFAULT_MATERIAL_DEFINITION_ID } from '../engine/materialInstance'
import { noopPersistence } from './contextHarness'
import { useSelectionStore } from '../stores/selectionStore'

export const RED_SLIME_PARAMETERS = [
  { key: 'tint', kind: 'color', default: '#ffffff' },
  { key: 'opacityMultiplier', kind: 'number', default: 1 },
]

export const BLUE_SLIME_PARAMETERS = [
  { key: 'tint', kind: 'color', default: '#0000ff' },
  { key: 'opacityMultiplier', kind: 'number', default: 0.8 },
]

export interface MaterialInspectorHarness {
  engine: Engine
  undoStack: UndoStack
  dispatcher: CommandDispatcher
}

export function renderMaterialInspector(): MaterialInspectorHarness {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: (command) => dispatcher.dispatch(command),
    persistence: noopPersistence,
  }
  render(
    <EngineContext.Provider value={value}>
      <InspectorPanel width={300} />
    </EngineContext.Provider>,
  )
  return { engine, undoStack, dispatcher }
}

export function registerMaterials(engine: Engine): void {
  engine.registerMaterialDefinition('mat-red', 'Red Slime', RED_SLIME_PARAMETERS)
  engine.registerMaterialDefinition('mat-blue', 'Blue Slime', BLUE_SLIME_PARAMETERS)
}

export function createSceneWithNode(engine: Engine): { nodeId: string; cameraId: string } {
  engine.createProject({ name: 'Demo' })
  const slide = engine.createSlide('Slide 1')
  const definition = engine.defineAsset('Boy')
  const node = engine.createAssetInstance(slide.scene.id, slide.scene.root.id, definition.id, 'Boy')
  return { nodeId: node.id, cameraId: slide.scene.camera.id }
}

export function createSecondNode(engine: Engine, name = 'Second'): string {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const definition = engine.defineAsset(name)
  return engine.createAssetInstance(slide.scene.id, slide.scene.root.id, definition.id, name).id
}

export function createTextNode(engine: Engine, name = 'Title'): string {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  return engine.createNode(slide.scene.id, slide.scene.root.id, name, {
    components: { text: { kind: 'text', content: 'Hello', fontSize: 24, alignment: 'left' } },
  }).id
}

export function createGroupNode(engine: Engine, name = 'Group'): string {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  return engine.createNode(slide.scene.id, slide.scene.root.id, name).id
}

export function select(nodeId: string): void {
  act(() => {
    useSelectionStore.getState().select(nodeId)
  })
}

export function selectMany(nodeIds: string[]): void {
  act(() => {
    useSelectionStore.getState().selectMany(nodeIds)
  })
}

export function materialPicker(): HTMLSelectElement {
  return screen.getByRole('combobox', { name: 'Material' }) as HTMLSelectElement
}

export function tintInput(): HTMLInputElement {
  return screen.getByLabelText('Tint') as HTMLInputElement
}

export function multiplierInput(): HTMLInputElement {
  return screen.getByLabelText('Opacity Multiplier') as HTMLInputElement
}

export function clearTintButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Clear Tint override' })
}

export function clearMultiplierButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Clear Opacity Multiplier override' })
}

export function defaultMaterialDefinitionId(): string {
  return DEFAULT_MATERIAL_DEFINITION_ID
}

export function undoLast(dispatcher: CommandDispatcher, undoStack: UndoStack): void {
  const entry = undoStack.entries[0]
  if (!entry) {
    throw new Error('nothing to undo')
  }
  replayInverse(dispatcher, entry)
}

export function redoEntry(dispatcher: CommandDispatcher, entry: UndoStackEntry<unknown>): void {
  replayForward(dispatcher, entry)
}

function replayInverse(dispatcher: CommandDispatcher, entry: UndoStackEntry<unknown>): void {
  switch (entry.type) {
    case 'AssignMaterial': {
      const inverse = entry.inverse as AssignMaterialInverse
      dispatcher.dispatch(
        new AssignMaterialCommand({
          nodeId: inverse.nodeId,
          materialDefinitionId: inverse.previousMaterialDefinitionId,
        }),
      )
      for (const [parameter, value] of Object.entries(inverse.previousOverrides)) {
        dispatcher.dispatch(
          new OverrideMaterialParameterCommand({ nodeId: inverse.nodeId, parameter, value }),
        )
      }
      return
    }
    case 'OverrideMaterialParameter': {
      const inverse = entry.inverse as OverrideMaterialParameterInverse
      if (inverse.previousValue === null) {
        dispatcher.dispatch(
          new ClearMaterialOverrideCommand({
            nodeId: inverse.nodeId,
            parameter: inverse.parameter,
          }),
        )
      } else {
        dispatcher.dispatch(
          new OverrideMaterialParameterCommand({
            nodeId: inverse.nodeId,
            parameter: inverse.parameter,
            value: inverse.previousValue,
          }),
        )
      }
      return
    }
    case 'ClearMaterialOverride': {
      const inverse = entry.inverse as ClearMaterialOverrideInverse
      dispatcher.dispatch(
        new OverrideMaterialParameterCommand({
          nodeId: inverse.nodeId,
          parameter: inverse.parameter,
          value: inverse.removedValue,
        }),
      )
      return
    }
    default:
      throw new Error(`no undo helper for ${entry.type}`)
  }
}

function replayForward(dispatcher: CommandDispatcher, entry: UndoStackEntry<unknown>): void {
  switch (entry.type) {
    case 'AssignMaterial':
      dispatcher.dispatch(
        new AssignMaterialCommand(entry.parameters as unknown as AssignMaterialParameters),
      )
      return
    case 'OverrideMaterialParameter':
      dispatcher.dispatch(
        new OverrideMaterialParameterCommand(
          entry.parameters as unknown as OverrideMaterialParameterParameters,
        ),
      )
      return
    case 'ClearMaterialOverride':
      dispatcher.dispatch(
        new ClearMaterialOverrideCommand(
          entry.parameters as unknown as ClearMaterialOverrideParameters,
        ),
      )
      return
    default:
      throw new Error(`no redo helper for ${entry.type}`)
  }
}
