import { describe, expect, it, vi } from 'vitest'
import type { EngineEvent } from '../../engine/events'
import type { CommandLogger, CommandResult, UndoStackEntry } from '../../engine/commands'
import {
  CommandDispatcher,
  CreateProjectCommand,
  CreateSlideCommand,
  OverrideFullscreenUniformCommand,
  SetFullscreenShaderCommand,
  UndoStack,
} from '../../engine/commands'
import type { Engine } from '../../engine/internal'
import { createEngine } from '../../engine/internal'
import type { FullscreenShaderReference } from '../../engine/fullscreenShader'

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

interface Setup {
  engine: Engine
  dispatcher: CommandDispatcher
  undoStack: UndoStack
  slideId: string
  otherSlideId: string
}

function setup(log?: CommandLogger): Setup {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, log)
  engine.registerShaderDefinition('shader-blur', 'Blur', [
    { key: 'uIntensity', kind: 'float', default: 0.5 },
    { key: 'uColor', kind: 'vec3', default: [1, 0, 0] },
    { key: 'uEnabled', kind: 'bool', default: true },
  ])
  expectOk(dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  expectOk(dispatcher.dispatch(new CreateSlideCommand({ name: 'S2' })))
  const slides = engine.project?.slides ?? []
  return {
    engine,
    dispatcher,
    undoStack,
    slideId: slides[0]?.id ?? '',
    otherSlideId: slides[1]?.id ?? '',
  }
}

function collectEvents(engine: Engine): EngineEvent[] {
  const events: EngineEvent[] = []
  engine.subscribe((event) => events.push(event))
  return events
}

function fullscreenOf(engine: Engine, slideId: string): FullscreenShaderReference | null {
  return engine.getSlide(slideId).fullscreenShader
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
            new OverrideFullscreenUniformCommand({
              slideId: inverse.slideId,
              uniform,
              value,
            }),
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

describe('SetFullscreenShaderCommand', () => {
  it('assigns a shader, resets overrides, emits SlideShaderChanged, and captures the previous reference', () => {
    const log = vi.fn()
    const { engine, dispatcher, undoStack, slideId } = setup(log)
    expectOk(
      dispatcher.dispatch(
        new SetFullscreenShaderCommand({ slideId, shaderDefinitionId: 'shader-blur' }),
      ),
    )
    expectOk(
      dispatcher.dispatch(
        new OverrideFullscreenUniformCommand({ slideId, uniform: 'uIntensity', value: 0.9 }),
      ),
    )
    const events = collectEvents(engine)

    const result = dispatcher.dispatch(
      new SetFullscreenShaderCommand({ slideId, shaderDefinitionId: 'shader-blur' }),
    )

    const inverse = expectOk(result)
    expect(fullscreenOf(engine, slideId)).toEqual({
      shaderDefinitionId: 'shader-blur',
      overrides: {},
    })
    expect(events).toEqual([{ type: 'SlideShaderChanged', slideId }])
    expect(inverse).toEqual({
      slideId,
      previous: {
        shaderDefinitionId: 'shader-blur',
        overrides: { uIntensity: 0.9 },
      },
    })
    expect(undoStack.entries[0]).toMatchObject({
      type: 'SetFullscreenShader',
      parameters: { slideId, shaderDefinitionId: 'shader-blur' },
      inverse,
    })
    expect(log).toHaveBeenCalledWith(
      `SetFullscreenShader slideId=${slideId} shaderDefinitionId=shader-blur`,
    )
  })

  it('clears an assigned shader and captures the previous reference; undo restores it with its overrides', () => {
    const { engine, dispatcher, undoStack, slideId } = setup()
    expectOk(
      dispatcher.dispatch(
        new SetFullscreenShaderCommand({ slideId, shaderDefinitionId: 'shader-blur' }),
      ),
    )
    expectOk(
      dispatcher.dispatch(
        new OverrideFullscreenUniformCommand({ slideId, uniform: 'uIntensity', value: 0.9 }),
      ),
    )

    const result = dispatcher.dispatch(
      new SetFullscreenShaderCommand({ slideId, shaderDefinitionId: null }),
    )

    const inverse = expectOk(result)
    expect(fullscreenOf(engine, slideId)).toBeNull()
    expect(inverse).toEqual({
      slideId,
      previous: {
        shaderDefinitionId: 'shader-blur',
        overrides: { uIntensity: 0.9 },
      },
    })

    replayInverse(dispatcher, undoStack.entries[0] as UndoStackEntry<unknown>)
    expect(fullscreenOf(engine, slideId)).toEqual({
      shaderDefinitionId: 'shader-blur',
      overrides: { uIntensity: 0.9 },
    })
  })

  it('undoes an assignment by restoring the absent previous reference', () => {
    const { engine, dispatcher, undoStack, slideId } = setup()
    expectOk(
      dispatcher.dispatch(
        new SetFullscreenShaderCommand({ slideId, shaderDefinitionId: 'shader-blur' }),
      ),
    )

    replayInverse(dispatcher, undoStack.entries[0] as UndoStackEntry<unknown>)

    expect(fullscreenOf(engine, slideId)).toBeNull()
  })

  it('rejects an unknown slide and leaves the engine unchanged', () => {
    const { engine, dispatcher, undoStack } = setup()
    const events = collectEvents(engine)
    const undoCount = undoStack.entries.length

    const result = dispatcher.dispatch(
      new SetFullscreenShaderCommand({ slideId: 'ghost', shaderDefinitionId: 'shader-blur' }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/slide.*not found/i)
    }
    expect(undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects an unknown shader definition — the degraded-library path — and leaves the engine unchanged', () => {
    const { engine, dispatcher, undoStack, slideId } = setup()
    const events = collectEvents(engine)
    const undoCount = undoStack.entries.length

    const result = dispatcher.dispatch(
      new SetFullscreenShaderCommand({ slideId, shaderDefinitionId: 'ghost' }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/definition.*not found/i)
    }
    expect(fullscreenOf(engine, slideId)).toBeNull()
    expect(undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('serializes to JSON with its type and parameters', () => {
    expect(
      new SetFullscreenShaderCommand({ slideId: 's1', shaderDefinitionId: 'shader-blur' }).toJSON(),
    ).toEqual({ type: 'SetFullscreenShader', slideId: 's1', shaderDefinitionId: 'shader-blur' })
    expect(
      new SetFullscreenShaderCommand({ slideId: 's1', shaderDefinitionId: null }).toJSON(),
    ).toEqual({ type: 'SetFullscreenShader', slideId: 's1', shaderDefinitionId: null })
  })
})

describe('OverrideFullscreenUniformCommand', () => {
  it('adds an override, emits SlideShaderUniformChanged, and records an absent previous value', () => {
    const log = vi.fn()
    const { engine, dispatcher, undoStack, slideId } = setup(log)
    expectOk(
      dispatcher.dispatch(
        new SetFullscreenShaderCommand({ slideId, shaderDefinitionId: 'shader-blur' }),
      ),
    )
    const events = collectEvents(engine)

    const result = dispatcher.dispatch(
      new OverrideFullscreenUniformCommand({ slideId, uniform: 'uIntensity', value: 0.9 }),
    )

    const inverse = expectOk(result)
    expect(fullscreenOf(engine, slideId)).toEqual({
      shaderDefinitionId: 'shader-blur',
      overrides: { uIntensity: 0.9 },
    })
    expect(events).toEqual([{ type: 'SlideShaderUniformChanged', slideId }])
    expect(inverse).toEqual({ slideId, uniform: 'uIntensity', previousValue: null })
    expect(undoStack.entries[0]).toMatchObject({
      type: 'OverrideFullscreenUniform',
      parameters: { slideId, uniform: 'uIntensity', value: 0.9 },
      inverse,
    })
    expect(log).toHaveBeenCalledWith(
      `OverrideFullscreenUniform slideId=${slideId} uniform=uIntensity value=0.9`,
    )
  })

  it('changes an existing override and records the previous value', () => {
    const { engine, dispatcher, slideId } = setup()
    expectOk(
      dispatcher.dispatch(
        new SetFullscreenShaderCommand({ slideId, shaderDefinitionId: 'shader-blur' }),
      ),
    )
    expectOk(
      dispatcher.dispatch(
        new OverrideFullscreenUniformCommand({ slideId, uniform: 'uIntensity', value: 0.9 }),
      ),
    )

    const inverse = expectOk(
      dispatcher.dispatch(
        new OverrideFullscreenUniformCommand({ slideId, uniform: 'uIntensity', value: 0.25 }),
      ),
    )

    expect(fullscreenOf(engine, slideId)).toEqual({
      shaderDefinitionId: 'shader-blur',
      overrides: { uIntensity: 0.25 },
    })
    expect(inverse).toEqual({ slideId, uniform: 'uIntensity', previousValue: 0.9 })
  })

  it('clears an override with a null value and records the removed value; undo restores it', () => {
    const { engine, dispatcher, undoStack, slideId } = setup()
    expectOk(
      dispatcher.dispatch(
        new SetFullscreenShaderCommand({ slideId, shaderDefinitionId: 'shader-blur' }),
      ),
    )
    expectOk(
      dispatcher.dispatch(
        new OverrideFullscreenUniformCommand({ slideId, uniform: 'uIntensity', value: 0.9 }),
      ),
    )

    const result = dispatcher.dispatch(
      new OverrideFullscreenUniformCommand({ slideId, uniform: 'uIntensity', value: null }),
    )

    const inverse = expectOk(result)
    expect(fullscreenOf(engine, slideId)).toEqual({
      shaderDefinitionId: 'shader-blur',
      overrides: {},
    })
    expect(inverse).toEqual({ slideId, uniform: 'uIntensity', previousValue: 0.9 })

    replayInverse(dispatcher, undoStack.entries[0] as UndoStackEntry<unknown>)
    expect(fullscreenOf(engine, slideId)).toEqual({
      shaderDefinitionId: 'shader-blur',
      overrides: { uIntensity: 0.9 },
    })
  })

  it('undoes a set override with an absent previous value by clearing it', () => {
    const { engine, dispatcher, undoStack, slideId } = setup()
    expectOk(
      dispatcher.dispatch(
        new SetFullscreenShaderCommand({ slideId, shaderDefinitionId: 'shader-blur' }),
      ),
    )
    expectOk(
      dispatcher.dispatch(
        new OverrideFullscreenUniformCommand({ slideId, uniform: 'uIntensity', value: 0.9 }),
      ),
    )

    replayInverse(dispatcher, undoStack.entries[0] as UndoStackEntry<unknown>)

    expect(fullscreenOf(engine, slideId)).toEqual({
      shaderDefinitionId: 'shader-blur',
      overrides: {},
    })
  })

  it('rejects overriding when the slide has no fullscreen shader assigned', () => {
    const { engine, dispatcher, undoStack, slideId } = setup()
    const events = collectEvents(engine)
    const undoCount = undoStack.entries.length

    const result = dispatcher.dispatch(
      new OverrideFullscreenUniformCommand({ slideId, uniform: 'uIntensity', value: 0.9 }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/no fullscreen shader/i)
    }
    expect(undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects clearing an override that does not exist', () => {
    const { engine, dispatcher, undoStack, slideId } = setup()
    expectOk(
      dispatcher.dispatch(
        new SetFullscreenShaderCommand({ slideId, shaderDefinitionId: 'shader-blur' }),
      ),
    )
    const events = collectEvents(engine)
    const undoCount = undoStack.entries.length

    const result = dispatcher.dispatch(
      new OverrideFullscreenUniformCommand({ slideId, uniform: 'uIntensity', value: null }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/no override/i)
    }
    expect(undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects an empty uniform key', () => {
    const { dispatcher, undoStack, slideId } = setup()
    expectOk(
      dispatcher.dispatch(
        new SetFullscreenShaderCommand({ slideId, shaderDefinitionId: 'shader-blur' }),
      ),
    )
    const undoCount = undoStack.entries.length

    const result = dispatcher.dispatch(
      new OverrideFullscreenUniformCommand({ slideId, uniform: ' ', value: 1 }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/uniform/i)
    }
    expect(undoStack.entries).toHaveLength(undoCount)
  })

  it('rejects a non-finite value', () => {
    const { dispatcher, slideId } = setup()
    expectOk(
      dispatcher.dispatch(
        new SetFullscreenShaderCommand({ slideId, shaderDefinitionId: 'shader-blur' }),
      ),
    )

    const result = dispatcher.dispatch(
      new OverrideFullscreenUniformCommand({ slideId, uniform: 'uIntensity', value: NaN }),
    )

    expect(result.ok).toBe(false)
  })

  it('rejects an unknown slide', () => {
    const { dispatcher, undoStack } = setup()
    const undoCount = undoStack.entries.length

    const result = dispatcher.dispatch(
      new OverrideFullscreenUniformCommand({ slideId: 'ghost', uniform: 'uIntensity', value: 1 }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/slide.*not found/i)
    }
    expect(undoStack.entries).toHaveLength(undoCount)
  })

  it('affects only the target slide', () => {
    const { engine, dispatcher, slideId, otherSlideId } = setup()
    expectOk(
      dispatcher.dispatch(
        new SetFullscreenShaderCommand({ slideId, shaderDefinitionId: 'shader-blur' }),
      ),
    )

    expectOk(
      dispatcher.dispatch(
        new OverrideFullscreenUniformCommand({ slideId, uniform: 'uIntensity', value: 0.9 }),
      ),
    )

    expect(fullscreenOf(engine, slideId)).toEqual({
      shaderDefinitionId: 'shader-blur',
      overrides: { uIntensity: 0.9 },
    })
    expect(fullscreenOf(engine, otherSlideId)).toBeNull()
  })

  it('serializes to JSON with its type and parameters', () => {
    expect(
      new OverrideFullscreenUniformCommand({
        slideId: 's1',
        uniform: 'uIntensity',
        value: 0.9,
      }).toJSON(),
    ).toEqual({
      type: 'OverrideFullscreenUniform',
      slideId: 's1',
      uniform: 'uIntensity',
      value: 0.9,
    })
    expect(
      new OverrideFullscreenUniformCommand({
        slideId: 's1',
        uniform: 'uIntensity',
        value: null,
      }).toJSON(),
    ).toEqual({
      type: 'OverrideFullscreenUniform',
      slideId: 's1',
      uniform: 'uIntensity',
      value: null,
    })
  })
})
