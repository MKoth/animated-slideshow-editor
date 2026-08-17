import { describe, expect, it } from 'vitest'
import type { CommandResult } from '../../engine/commands'
import {
  AddKeyframeCommand,
  AssignMaterialCommand,
  CommandDispatcher,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  OverrideMaterialParameterCommand,
  UndoStack,
} from '../../engine/commands'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import type { MaterialOverrides, MaterialOverrideValue } from '../../engine/materialInstance'
import type { MaterialParameterDefault } from '../../engine/materialResolution'
import { evaluatedMaterialOverridesScratch } from '../../engine/animationEvaluator'

const MATERIAL: { id: string; name: string; parameters: MaterialParameterDefault[] } = {
  id: 'mat-eval',
  name: 'Eval',
  parameters: [
    { key: 'uGlow', kind: 'number', default: 0 },
    { key: 'uIntensity', kind: 'float', default: 0.5 },
    { key: 'uSteps', kind: 'int', default: 2 },
    { key: 'uEnabled', kind: 'bool', default: false },
    { key: 'uPhoto', kind: 'sampler2D', default: 'asset-a' },
    { key: 'uTint', kind: 'color', default: '#000000' },
    { key: 'uDir', kind: 'vec3', default: [0, 0, 0] },
    { key: 'uRgba', kind: 'vec4', default: [0, 0, 0, 1] },
  ],
}

const OTHER_MATERIAL: { id: string; name: string; parameters: MaterialParameterDefault[] } = {
  id: 'mat-other',
  name: 'Other',
  parameters: [{ key: 'uIntensity', kind: 'float', default: 0.5 }],
}

interface Setup {
  engine: Engine
  dispatcher: CommandDispatcher
  undoStack: UndoStack
  nodeId: string
}

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function setup(): Setup {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack)
  expectOk(dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const { nodeId } = expectOk(
    dispatcher.dispatch(
      new CreateNodeCommand({ sceneId: slide.scene.id, parentId: slide.scene.root.id, name: 'A' }),
    ),
  )
  engine.registerMaterialDefinition(MATERIAL.id, MATERIAL.name, MATERIAL.parameters)
  engine.registerMaterialDefinition(
    OTHER_MATERIAL.id,
    OTHER_MATERIAL.name,
    OTHER_MATERIAL.parameters,
  )
  expectOk(
    dispatcher.dispatch(new AssignMaterialCommand({ nodeId, materialDefinitionId: MATERIAL.id })),
  )
  return { engine, dispatcher, undoStack, nodeId }
}

function addMaterialKeyframe(
  setup: Setup,
  parameter: string,
  time: number,
  value: MaterialOverrideValue,
): string {
  const inverse = expectOk(
    setup.dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'node', nodeId: setup.nodeId, parameter },
        time,
        value,
      }),
    ),
  )
  return inverse.keyframe.keyframeId
}

function overrideParameter(setup: Setup, parameter: string, value: MaterialOverrideValue): void {
  expectOk(
    setup.dispatcher.dispatch(
      new OverrideMaterialParameterCommand({ nodeId: setup.nodeId, parameter, value }),
    ),
  )
}

function evaluate(
  setup: Setup,
  time: number,
  target = evaluatedMaterialOverridesScratch(),
): MaterialOverrides {
  return setup.engine.evaluateMaterialOverrides(setup.nodeId, time, target)
}

describe('evaluateMaterialOverrides', () => {
  it('returns the static overrides verbatim when no material tracks exist', () => {
    const setupInstance = setup()
    overrideParameter(setupInstance, 'uGlow', 0.25)
    overrideParameter(setupInstance, 'uSteps', 7)

    expect(evaluate(setupInstance, 0)).toEqual({ uGlow: 0.25, uSteps: 7 })
    expect(evaluate(setupInstance, 5)).toEqual({ uGlow: 0.25, uSteps: 7 })
  })

  it('overlays track values over static overrides — later wins for the same key', () => {
    const setupInstance = setup()
    overrideParameter(setupInstance, 'uGlow', 0.1)
    overrideParameter(setupInstance, 'uSteps', 7)
    addMaterialKeyframe(setupInstance, 'uGlow', 0, 0.5)
    addMaterialKeyframe(setupInstance, 'uGlow', 2, 0.9)

    expect(evaluate(setupInstance, 1)).toEqual({ uGlow: 0.7, uSteps: 7 })
    expect(evaluate(setupInstance, 0)).toEqual({ uGlow: 0.5, uSteps: 7 })
    expect(evaluate(setupInstance, 2)).toEqual({ uGlow: 0.9, uSteps: 7 })
  })

  it('includes track-only parameters alongside untouched static overrides', () => {
    const setupInstance = setup()
    overrideParameter(setupInstance, 'uSteps', 3)
    addMaterialKeyframe(setupInstance, 'uIntensity', 0, 0.2)
    addMaterialKeyframe(setupInstance, 'uIntensity', 2, 0.8)

    expect(evaluate(setupInstance, 1)).toEqual({ uSteps: 3, uIntensity: 0.5 })
  })

  it('interpolates number and float tracks linearly', () => {
    const setupInstance = setup()
    addMaterialKeyframe(setupInstance, 'uGlow', 1, 10)
    addMaterialKeyframe(setupInstance, 'uGlow', 3, 30)

    expect(evaluate(setupInstance, 1)).toEqual({ uGlow: 10 })
    expect(evaluate(setupInstance, 1.5)).toEqual({ uGlow: 15 })
    expect(evaluate(setupInstance, 2)).toEqual({ uGlow: 20 })
    expect(evaluate(setupInstance, 3)).toEqual({ uGlow: 30 })
  })

  it('holds the first and last track values before the first and after the last keyframe', () => {
    const setupInstance = setup()
    addMaterialKeyframe(setupInstance, 'uIntensity', 2, 0.1)
    addMaterialKeyframe(setupInstance, 'uIntensity', 8, 0.9)

    expect(evaluate(setupInstance, 0)).toEqual({ uIntensity: 0.1 })
    expect(evaluate(setupInstance, 1)).toEqual({ uIntensity: 0.1 })
    expect(evaluate(setupInstance, 10)).toEqual({ uIntensity: 0.9 })
  })

  it("clamps opacityMultiplier to [0, 1] like today's material resolution", () => {
    const setupInstance = setup()
    expectOk(
      setupInstance.dispatcher.dispatch(
        new AssignMaterialCommand({
          nodeId: setupInstance.nodeId,
          materialDefinitionId: '0d3f4464-8300-5b6d-ae14-45246fefbeae',
        }),
      ),
    )
    addMaterialKeyframe(setupInstance, 'opacityMultiplier', 0, 1.6)
    addMaterialKeyframe(setupInstance, 'opacityMultiplier', 2, 1.6)

    expect(evaluate(setupInstance, 0)).toEqual({ opacityMultiplier: 1 })
    expect(evaluate(setupInstance, 1)).toEqual({ opacityMultiplier: 1 })
  })

  it('interpolates color tracks per RGB channel and re-encodes hex', () => {
    const setupInstance = setup()
    addMaterialKeyframe(setupInstance, 'uTint', 0, '#ff0000')
    addMaterialKeyframe(setupInstance, 'uTint', 2, '#0000ff')

    expect(evaluate(setupInstance, 1)).toEqual({ uTint: '#800080' })
    expect(evaluate(setupInstance, 0)).toEqual({ uTint: '#ff0000' })
    expect(evaluate(setupInstance, 2)).toEqual({ uTint: '#0000ff' })
  })

  it('interpolates vector tracks per component without clamping rgb channels', () => {
    const setupInstance = setup()
    addMaterialKeyframe(setupInstance, 'uDir', 0, [0.5, 0.5, 0.5])
    addMaterialKeyframe(setupInstance, 'uDir', 2, [2, 2, 2])

    expect(evaluate(setupInstance, 1)).toEqual({ uDir: [1.25, 1.25, 1.25] })
  })

  it('clamps the alpha channel of vec4 tracks to [0, 1]', () => {
    const setupInstance = setup()
    addMaterialKeyframe(setupInstance, 'uRgba', 0, [0, 0, 0, 0.6])
    addMaterialKeyframe(setupInstance, 'uRgba', 2, [0, 0, 0, 1.8])

    expect(evaluate(setupInstance, 1)).toEqual({ uRgba: [0, 0, 0, 1] })
    expect(evaluate(setupInstance, 2)).toEqual({ uRgba: [0, 0, 0, 1] })
  })

  it('holds discrete kinds — the value jumps at the keyframe time', () => {
    const setupInstance = setup()
    addMaterialKeyframe(setupInstance, 'uSteps', 1, 2)
    addMaterialKeyframe(setupInstance, 'uSteps', 3, 5)
    addMaterialKeyframe(setupInstance, 'uEnabled', 1, false)
    addMaterialKeyframe(setupInstance, 'uEnabled', 3, true)
    addMaterialKeyframe(setupInstance, 'uPhoto', 1, 'asset-a')
    addMaterialKeyframe(setupInstance, 'uPhoto', 3, 'asset-b')

    expect(evaluate(setupInstance, 0)).toEqual({
      uSteps: 2,
      uEnabled: false,
      uPhoto: 'asset-a',
    })
    expect(evaluate(setupInstance, 1)).toEqual({
      uSteps: 2,
      uEnabled: false,
      uPhoto: 'asset-a',
    })
    expect(evaluate(setupInstance, 2)).toEqual({
      uSteps: 2,
      uEnabled: false,
      uPhoto: 'asset-a',
    })
    expect(evaluate(setupInstance, 3)).toEqual({
      uSteps: 5,
      uEnabled: true,
      uPhoto: 'asset-b',
    })
    expect(evaluate(setupInstance, 4)).toEqual({
      uSteps: 5,
      uEnabled: true,
      uPhoto: 'asset-b',
    })
  })

  it('ignores orphaned tracks whose parameter the material no longer defines', () => {
    const setupInstance = setup()
    addMaterialKeyframe(setupInstance, 'uGlow', 0, 0.5)
    addMaterialKeyframe(setupInstance, 'uGlow', 2, 0.9)
    expectOk(
      setupInstance.dispatcher.dispatch(
        new AssignMaterialCommand({
          nodeId: setupInstance.nodeId,
          materialDefinitionId: OTHER_MATERIAL.id,
        }),
      ),
    )

    expect(setupInstance.engine.hasMaterialTrack(setupInstance.nodeId, 'uGlow')).toBe(true)
    expect(evaluate(setupInstance, 1)).toEqual({})
  })

  it('evaluates material tracks of the default material through the read API', () => {
    const setupInstance = setup()
    expectOk(
      setupInstance.dispatcher.dispatch(
        new AssignMaterialCommand({
          nodeId: setupInstance.nodeId,
          materialDefinitionId: '0d3f4464-8300-5b6d-ae14-45246fefbeae',
        }),
      ),
    )
    addMaterialKeyframe(setupInstance, 'opacityMultiplier', 0, 0.4)
    addMaterialKeyframe(setupInstance, 'opacityMultiplier', 2, 0.8)

    const evaluated = evaluate(setupInstance, 1)
    expect(evaluated.opacityMultiplier).toBeCloseTo(0.6)
  })

  it('clamps the evaluation time to the slide duration', () => {
    const setupInstance = setup()
    addMaterialKeyframe(setupInstance, 'uIntensity', 5, 0.1)
    addMaterialKeyframe(setupInstance, 'uIntensity', 6, 0.9)

    expect(evaluate(setupInstance, -5)).toEqual({ uIntensity: 0.1 })
    expect(evaluate(setupInstance, 50)).toEqual({ uIntensity: 0.9 })
  })

  it('writes into a provided scratch target without allocating new objects', () => {
    const setupInstance = setup()
    overrideParameter(setupInstance, 'uSteps', 7)
    addMaterialKeyframe(setupInstance, 'uIntensity', 0, 0.2)
    addMaterialKeyframe(setupInstance, 'uIntensity', 2, 0.8)
    addMaterialKeyframe(setupInstance, 'uTint', 0, '#ff0000')
    addMaterialKeyframe(setupInstance, 'uTint', 2, '#0000ff')
    addMaterialKeyframe(setupInstance, 'uDir', 0, [0.5, 0.5, 0.5])
    addMaterialKeyframe(setupInstance, 'uDir', 2, [2, 2, 2])
    const target = evaluatedMaterialOverridesScratch()

    const first = setupInstance.engine.evaluateMaterialOverrides(setupInstance.nodeId, 1, target)

    expect(first).toBe(target.values)
    expect(first).toEqual({
      uSteps: 7,
      uIntensity: 0.5,
      uTint: '#800080',
      uDir: [1.25, 1.25, 1.25],
    })

    const second = setupInstance.engine.evaluateMaterialOverrides(setupInstance.nodeId, 0, target)

    expect(second).toBe(target.values)
    expect(second).toEqual({
      uSteps: 7,
      uIntensity: 0.2,
      uTint: '#ff0000',
      uDir: [0.5, 0.5, 0.5],
    })
    expect(target.keys).toEqual(['uSteps', 'uIntensity', 'uTint', 'uDir'])
    expect(Object.keys(target.values)).toHaveLength(4)
  })

  it('is deterministic — repeated evaluations produce identical results', () => {
    const setupInstance = setup()
    addMaterialKeyframe(setupInstance, 'uTint', 0, '#ff0000')
    addMaterialKeyframe(setupInstance, 'uTint', 2, '#0000ff')
    addMaterialKeyframe(setupInstance, 'uSteps', 1, 2)
    addMaterialKeyframe(setupInstance, 'uSteps', 3, 5)

    const first = evaluate(setupInstance, 1)
    const second = evaluate(setupInstance, 1)

    expect(second).toEqual(first)
    expect(first).toEqual({ uTint: '#800080', uSteps: 2 })
  })

  it('rejects non-finite evaluation times', () => {
    const setupInstance = setup()
    expect(() => evaluate(setupInstance, Number.NaN)).toThrow()
    expect(() => evaluate(setupInstance, Number.POSITIVE_INFINITY)).toThrow()
  })
})
