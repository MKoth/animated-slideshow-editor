import { describe, expect, it } from 'vitest'
import type { KeyframeTarget } from '../../engine/keyframeTarget'
import {
  AddKeyframeCommand,
  OverrideMaterialParameterCommand,
  SetKeyframeValueCommand,
} from '../../engine/commands'
import { autoKeyCommands, materialParameterEditCommands } from '../../engine/keyframeEdit'
import { createEngine } from '../../engine/internal'

const CUSTOM_MATERIAL = {
  id: 'mat-params',
  name: 'Params',
  parameters: [
    { key: 'uGlow', kind: 'float', default: 0.5 },
    { key: 'uColor', kind: 'color', default: '#ff0000' },
  ],
}

function setup() {
  const engine = createEngine()
  engine.createProject({ name: 'P' })
  const slide = engine.createSlide('S1')
  const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
  engine.registerMaterialDefinition(
    CUSTOM_MATERIAL.id,
    CUSTOM_MATERIAL.name,
    CUSTOM_MATERIAL.parameters,
  )
  engine.assignMaterial(node.id, CUSTOM_MATERIAL.id)
  return { engine, node }
}

const propertyTarget = (nodeId: string): KeyframeTarget => ({
  kind: 'node',
  nodeId,
  property: 'positionX',
})

describe('autoKeyCommands for material parameters', () => {
  it('adds a keyframe at the given time when the parameter has no keyframe there', () => {
    const { engine, node } = setup()
    const target: KeyframeTarget = { kind: 'node', nodeId: node.id, parameter: 'uGlow' }
    const commands = autoKeyCommands(engine, [{ target, time: 2, value: 0.9 }])
    expect(commands).toHaveLength(1)
    expect(commands[0]).toBeInstanceOf(AddKeyframeCommand)
    expect((commands[0] as AddKeyframeCommand).parameters).toEqual({
      target,
      time: 2,
      value: 0.9,
    })
  })

  it('updates an existing keyframe at the time instead of adding a duplicate', () => {
    const { engine, node } = setup()
    const target: KeyframeTarget = { kind: 'node', nodeId: node.id, parameter: 'uGlow' }
    engine.addKeyframe(target, 2, 0.5)
    const keyframeId = engine.getMaterialKeyframes(node.id, 'uGlow')[0]?.id
    if (!keyframeId) {
      throw new Error('expected a keyframe')
    }
    const commands = autoKeyCommands(engine, [{ target, time: 2, value: 0.9 }])
    expect(commands).toHaveLength(1)
    expect(commands[0]).toBeInstanceOf(SetKeyframeValueCommand)
    expect((commands[0] as SetKeyframeValueCommand).parameters).toEqual({
      target,
      keyframeId,
      newValue: 0.9,
    })
  })

  it('issues no command when the existing keyframe already carries the value', () => {
    const { engine, node } = setup()
    const target: KeyframeTarget = { kind: 'node', nodeId: node.id, parameter: 'uColor' }
    engine.addKeyframe(target, 2, '#00ff00')
    const commands = autoKeyCommands(engine, [{ target, time: 2, value: '#00ff00' }])
    expect(commands).toHaveLength(0)
  })

  it('compares vector values deeply', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
    engine.registerMaterialDefinition('vec', 'Vec', [
      { key: 'uOffset', kind: 'vec2', default: [0, 0] },
    ])
    engine.assignMaterial(node.id, 'vec')
    const target: KeyframeTarget = { kind: 'node', nodeId: node.id, parameter: 'uOffset' }
    engine.addKeyframe(target, 2, [0.1, 0.2])
    const commands = autoKeyCommands(engine, [{ target, time: 2, value: [0.1, 0.2] }])
    expect(commands).toHaveLength(0)
  })

  it('keeps auto-keying property targets as before', () => {
    const { engine, node } = setup()
    engine.addKeyframe(propertyTarget(node.id), 2, 100)
    const commands = autoKeyCommands(engine, [
      { target: propertyTarget(node.id), time: 2, value: 100 },
    ])
    expect(commands).toHaveLength(0)
  })
})

describe('materialParameterEditCommands', () => {
  it('auto-keys a tracked parameter instead of touching the static override', () => {
    const { engine, node } = setup()
    engine.addKeyframe({ kind: 'node', nodeId: node.id, parameter: 'uGlow' }, 1, 0.5)
    const commands = materialParameterEditCommands(engine, 3, [
      { nodeId: node.id, parameter: 'uGlow', value: 0.9 },
    ])
    expect(commands).toHaveLength(1)
    expect(commands[0]).toBeInstanceOf(AddKeyframeCommand)
    const parameters = (commands[0] as AddKeyframeCommand).parameters as {
      target: KeyframeTarget
      time: number
    }
    expect(parameters.target).toEqual({ kind: 'node', nodeId: node.id, parameter: 'uGlow' })
    expect(parameters.time).toBe(3)
    expect(engine.getNode(node.id).material.overrides.uGlow).toBeUndefined()
  })

  it('falls back to the static override command for an untracked parameter', () => {
    const { engine, node } = setup()
    const commands = materialParameterEditCommands(engine, 3, [
      { nodeId: node.id, parameter: 'uGlow', value: 0.9 },
    ])
    expect(commands).toHaveLength(1)
    expect(commands[0]).toBeInstanceOf(OverrideMaterialParameterCommand)
    const parameters = (commands[0] as OverrideMaterialParameterCommand).parameters as {
      nodeId: string
      parameter: string
      value: number
    }
    expect(parameters).toEqual({ nodeId: node.id, parameter: 'uGlow', value: 0.9 })
  })

  it('updates a tracked parameter at an occupied playhead instead of adding a duplicate', () => {
    const { engine, node } = setup()
    engine.addKeyframe({ kind: 'node', nodeId: node.id, parameter: 'uGlow' }, 3, 0.5)
    const commands = materialParameterEditCommands(engine, 3, [
      { nodeId: node.id, parameter: 'uGlow', value: 0.7 },
    ])
    expect(commands).toHaveLength(1)
    expect(commands[0]).toBeInstanceOf(SetKeyframeValueCommand)
    expect((commands[0] as SetKeyframeValueCommand).parameters.newValue).toBe(0.7)
  })
})
