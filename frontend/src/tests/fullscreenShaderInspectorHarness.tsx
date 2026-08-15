import { act } from 'react'
import { render, screen } from '@testing-library/react'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { InspectorPanel } from '../components/panels/InspectorPanel'
import {
  CommandDispatcher,
  OverrideFullscreenUniformCommand,
  SetFullscreenShaderCommand,
  UndoStack,
} from '../engine/commands'
import type { UndoStackEntry } from '../engine/commands'
import type { FullscreenShaderReference } from '../engine/fullscreenShader'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { noopPersistence } from './contextHarness'
import { useSelectionStore } from '../stores/selectionStore'
import { useShaderLibraryStore } from '../stores/shaderLibraryStore'
import type { ShaderDefinition } from '../api'
import type { ShaderCompileStatus } from '../shaders/compiler'

export const FULLSCREEN_SHADER_PARAMETERS = [
  { key: 'uIntensity', kind: 'float', default: 0.5 },
  { key: 'uSteps', kind: 'int', default: 2 },
  { key: 'uEnabled', kind: 'bool', default: false },
  { key: 'uOffset', kind: 'vec2', default: [0.1, 0.2] },
  { key: 'uTintColor', kind: 'vec3', default: [1, 0, 0] },
  { key: 'uSampler', kind: 'sampler2D', default: '' },
]

export interface FullscreenShaderInspectorHarness {
  engine: Engine
  undoStack: UndoStack
  dispatcher: CommandDispatcher
}

export function renderFullscreenShaderInspector(): FullscreenShaderInspectorHarness {
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

export function createSlide(engine: Engine, name = 'Slide 1'): string {
  engine.createProject({ name: 'Demo' })
  return engine.createSlide(name).id
}

export function createNodeOnSlide(engine: Engine): string {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  return engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy').id
}

export function registerFullscreenShaders(engine: Engine): void {
  engine.registerShaderDefinition('shader-wash', 'Ink Wash', FULLSCREEN_SHADER_PARAMETERS)
  engine.registerShaderDefinition('shader-blur', 'Blur', [
    { key: 'uIntensity', kind: 'float', default: 0.9 },
  ])
}

export function seedShaderLibrary(
  definitions: ShaderDefinition[],
  compileStatus: Record<string, ShaderCompileStatus | undefined>,
): void {
  useShaderLibraryStore.setState({ definitions, compileStatus })
}

export function shaderDefinition(overrides: Partial<ShaderDefinition> = {}): ShaderDefinition {
  return {
    id: 'shader-wash',
    name: 'Ink Wash',
    description: '',
    tags: [],
    created_at: '2026-08-15T12:00:00',
    updated_at: '2026-08-15T12:00:00',
    source: 'void main() {}',
    default_uniforms: [],
    is_builtin: false,
    ...overrides,
  }
}

export function compiled(): ShaderCompileStatus {
  return { status: 'Compiled', errors: [] }
}

export function failedToCompile(message = 'syntax error'): ShaderCompileStatus {
  return { status: 'Failed', errors: [{ line: 3, message }] }
}

export function select(nodeId: string): void {
  act(() => {
    useSelectionStore.getState().select(nodeId)
  })
}

export function fullscreenShaderPicker(): HTMLSelectElement {
  return screen.getByRole('combobox', { name: 'Fullscreen Shader' }) as HTMLSelectElement
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
    case 'SetFullscreenShader': {
      const inverse = entry.inverse as {
        slideId: string
        previous: FullscreenShaderReference | null
      }
      dispatcher.dispatch(
        new SetFullscreenShaderCommand({
          slideId: inverse.slideId,
          shaderDefinitionId: inverse.previous?.shaderDefinitionId ?? null,
        }),
      )
      if (inverse.previous) {
        for (const [uniform, value] of Object.entries(inverse.previous.overrides)) {
          dispatcher.dispatch(
            new OverrideFullscreenUniformCommand({ slideId: inverse.slideId, uniform, value }),
          )
        }
      }
      return
    }
    case 'OverrideFullscreenUniform': {
      const inverse = entry.inverse as {
        slideId: string
        uniform: string
        previousValue: string | number | boolean | readonly number[] | null
      }
      dispatcher.dispatch(
        new OverrideFullscreenUniformCommand({
          slideId: inverse.slideId,
          uniform: inverse.uniform,
          value: inverse.previousValue,
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
    case 'SetFullscreenShader':
      dispatcher.dispatch(
        new SetFullscreenShaderCommand(
          entry.parameters as unknown as { slideId: string; shaderDefinitionId: string | null },
        ),
      )
      return
    case 'OverrideFullscreenUniform':
      dispatcher.dispatch(
        new OverrideFullscreenUniformCommand(
          entry.parameters as unknown as {
            slideId: string
            uniform: string
            value: string | number | boolean | readonly number[] | null
          },
        ),
      )
      return
    default:
      throw new Error(`no redo helper for ${entry.type}`)
  }
}
