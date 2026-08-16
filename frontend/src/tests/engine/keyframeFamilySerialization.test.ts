import { describe, expect, it } from 'vitest'
import type { CommandResult } from '../../engine/commands'
import {
  AddKeyframeCommand,
  CommandDispatcher,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  DeleteKeyframesCommand,
  DuplicateKeyframesCommand,
  MoveKeyframesCommand,
  PasteKeyframesCommand,
  ScaleKeyframesCommand,
  SetKeyframeInterpolationCommand,
  SetKeyframeTangentsCommand,
  SetKeyframeValueCommand,
  UndoStack,
} from '../../engine/commands'
import { createEngine } from '../../engine/internal'
import type { KeyframeTarget } from '../../engine/keyframeTarget'

const CUSTOM_MATERIAL = {
  id: 'mat-params',
  name: 'Params',
  parameters: [
    { key: 'uSteps', kind: 'int', default: 2 },
    { key: 'uGlow', kind: 'float', default: 0.5 },
    { key: 'uColor', kind: 'color', default: '#ff0000' },
    { key: 'uEnabled', kind: 'bool', default: true },
    { key: 'uOffset', kind: 'vec2', default: [0.1, 0.2] },
  ],
}

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

describe('keyframe family serialization round-trip', () => {
  it('persists and reloads the results of every family member, property and material tracks alike', () => {
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
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'A',
        }),
      ),
    )
    engine.registerMaterialDefinition(
      CUSTOM_MATERIAL.id,
      CUSTOM_MATERIAL.name,
      CUSTOM_MATERIAL.parameters,
    )
    engine.assignMaterial(nodeId, CUSTOM_MATERIAL.id)
    const property: KeyframeTarget = { kind: 'node', nodeId, property: 'positionX' }
    const parameter: KeyframeTarget = { kind: 'node', nodeId, parameter: 'uGlow' }
    const color: KeyframeTarget = { kind: 'node', nodeId, parameter: 'uColor' }
    const offset: KeyframeTarget = { kind: 'node', nodeId, parameter: 'uOffset' }

    const propertyKeyframe = expectOk(
      dispatcher.dispatch(new AddKeyframeCommand({ target: property, time: 1, value: 10 })),
    ).keyframe.keyframeId
    const parameterKeyframe = expectOk(
      dispatcher.dispatch(new AddKeyframeCommand({ target: parameter, time: 1, value: 0.5 })),
    ).keyframe.keyframeId
    expectOk(dispatcher.dispatch(new AddKeyframeCommand({ target: property, time: 3, value: 30 })))
    expectOk(
      dispatcher.dispatch(new AddKeyframeCommand({ target: color, time: 0, value: '#00ff00' })),
    )
    expectOk(
      dispatcher.dispatch(new AddKeyframeCommand({ target: offset, time: 2, value: [0.3, 0.4] })),
    )

    expectOk(
      dispatcher.dispatch(
        new MoveKeyframesCommand({
          target: parameter,
          moves: [{ keyframeId: parameterKeyframe, newTime: 4 }],
        }),
      ),
    )
    expectOk(
      dispatcher.dispatch(
        new SetKeyframeValueCommand({
          target: property,
          keyframeId: propertyKeyframe,
          newValue: 11,
        }),
      ),
    )
    const scaled = expectOk(
      dispatcher.dispatch(
        new ScaleKeyframesCommand({
          target: property,
          keyframeIds: [propertyKeyframe],
          pivot: 0,
          factor: 2,
        }),
      ),
    )
    expectOk(
      dispatcher.dispatch(
        new MoveKeyframesCommand({
          target: property,
          moves: [{ keyframeId: scaled.moves[0]?.keyframeId ?? '', newTime: 2 }],
        }),
      ),
    )
    expectOk(
      dispatcher.dispatch(
        new PasteKeyframesCommand({
          target: property,
          payload: {
            keyframes: [
              {
                time: 0,
                value: 50,
                interpolation: 'bezier',
                tangentIn: { time: -0.2, value: 5 },
                tangentOut: { time: 0.2, value: 5 },
              },
            ],
          },
          atTime: 5,
        }),
      ),
    )
    const duplicated = expectOk(
      dispatcher.dispatch(
        new DuplicateKeyframesCommand({ target: parameter, keyframeIds: [parameterKeyframe] }),
      ),
    ).keyframes[0]?.keyframeId
    if (!duplicated) {
      throw new Error('expected a duplicated keyframe')
    }
    expectOk(
      dispatcher.dispatch(
        new SetKeyframeInterpolationCommand({
          target: parameter,
          keyframeId: duplicated,
          interpolation: 'hold',
        }),
      ),
    )
    expectOk(
      dispatcher.dispatch(
        new SetKeyframeTangentsCommand({
          target: property,
          keyframeId: propertyKeyframe,
          tangentIn: { time: -0.5, value: 2 },
          tangentOut: { time: 0.5, value: 2 },
        }),
      ),
    )

    const json = engine.toJSON()

    const restored = createEngine()
    restored.registerMaterialDefinition(
      CUSTOM_MATERIAL.id,
      CUSTOM_MATERIAL.name,
      CUSTOM_MATERIAL.parameters,
    )
    restored.restoreFromJSON(json)

    expect(restored.toJSON()).toEqual(json)
    expect(restored.getMaterialKeyframes(nodeId, 'uGlow')).toHaveLength(2)
    expect(restored.getMaterialKeyframes(nodeId, 'uGlow')[1]?.interpolation).toBe('hold')
    expect(restored.getKeyframes(nodeId, 'positionX')[0]?.value).toBe(11)
    expect(restored.getKeyframes(nodeId, 'positionX')[0]?.tangentIn).toEqual({
      time: -0.5,
      value: 2,
    })
    expect(restored.getKeyframes(nodeId, 'positionX').some((keyframe) => keyframe.time === 5)).toBe(
      true,
    )
    expect(restored.getMaterialKeyframes(nodeId, 'uColor')[0]?.value).toBe('#00ff00')
    expect(restored.getMaterialKeyframes(nodeId, 'uOffset')[0]?.value).toEqual([0.3, 0.4])
  })

  it('deletes persist: removing a material track after save leaves it gone on reload', () => {
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
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'A',
        }),
      ),
    )
    engine.registerMaterialDefinition(
      CUSTOM_MATERIAL.id,
      CUSTOM_MATERIAL.name,
      CUSTOM_MATERIAL.parameters,
    )
    engine.assignMaterial(nodeId, CUSTOM_MATERIAL.id)
    const target: KeyframeTarget = { kind: 'node', nodeId, parameter: 'uGlow' }
    const keyframeId = expectOk(
      dispatcher.dispatch(new AddKeyframeCommand({ target, time: 1, value: 0.5 })),
    ).keyframe.keyframeId
    expectOk(dispatcher.dispatch(new DeleteKeyframesCommand({ target, keyframeIds: [keyframeId] })))

    const restored = createEngine()
    restored.registerMaterialDefinition(
      CUSTOM_MATERIAL.id,
      CUSTOM_MATERIAL.name,
      CUSTOM_MATERIAL.parameters,
    )
    restored.restoreFromJSON(engine.toJSON())

    expect(restored.hasMaterialTrack(nodeId, 'uGlow')).toBe(false)
  })
})
