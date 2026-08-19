import { describe, expect, it } from 'vitest'
import { createEngine } from '../../engine/internal'
import {
  AssignMaterialCommand,
  CommandDispatcher,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  UndoStack,
} from '../../engine/commands'
import type { CommandResult } from '../../engine/commands'

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function setupWithNode() {
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
  return { engine, dispatcher, undoStack, nodeId, sceneId: slide.scene.id }
}

describe('getAnimatableParameters', () => {
  it('returns the six standard properties for a node with the default material', () => {
    const { engine, nodeId } = setupWithNode()

    const parameters = engine.getAnimatableParameters(nodeId)

    expect(parameters).toHaveLength(6)
    expect(parameters.map((p) => p.key)).toEqual([
      'positionX',
      'positionY',
      'rotation',
      'scaleX',
      'scaleY',
      'opacity',
    ])
    for (const param of parameters) {
      expect(param.source).toBe('standard')
      expect(param.kind).toBe('number')
      expect(param.linked).toBe(false)
    }
  })

  it('excludes rotation for camera nodes', () => {
    const { engine, sceneId } = setupWithNode()
    const scene = engine.getScene(sceneId)
    const cameraId = scene.camera.id

    const parameters = engine.getAnimatableParameters(cameraId)

    expect(parameters.map((p) => p.key)).not.toContain('rotation')
    expect(parameters).toHaveLength(5)
  })

  it('includes material parameters when the node has a material with custom params', () => {
    const { engine, nodeId } = setupWithNode()
    engine.registerMaterialDefinition('custom-mat', 'Custom', [
      { key: 'tintColor', kind: 'color', default: '#ff0000' },
      { key: 'uSpeed', kind: 'number', default: 1.0 },
      { key: 'uOffset', kind: 'vec2', default: [0, 0] },
    ])
    const dispatcher = new CommandDispatcher(engine, new UndoStack())
    expectOk(
      dispatcher.dispatch(
        new AssignMaterialCommand({ nodeId, materialDefinitionId: 'custom-mat' }),
      ),
    )

    const parameters = engine.getAnimatableParameters(nodeId)

    const materialKeys = parameters.filter((p) => p.source === 'material').map((p) => p.key)
    expect(materialKeys).toContain('tintColor')
    expect(materialKeys).toContain('uSpeed')
    expect(materialKeys).toContain('uOffset')
  })

  it('excludes sampler2D material parameters', () => {
    const { engine, nodeId } = setupWithNode()
    engine.registerMaterialDefinition('mat-with-sampler', 'Sampler Mat', [
      { key: 'uTexture', kind: 'sampler2D', default: '' },
      { key: 'uValue', kind: 'number', default: 0.5 },
    ])
    const dispatcher = new CommandDispatcher(engine, new UndoStack())
    expectOk(
      dispatcher.dispatch(
        new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-with-sampler' }),
      ),
    )

    const parameters = engine.getAnimatableParameters(nodeId)

    const materialKeys = parameters.filter((p) => p.source === 'material').map((p) => p.key)
    expect(materialKeys).not.toContain('uTexture')
    expect(materialKeys).toContain('uValue')
  })

  it('marks material parameters as linked when the node has material tracks', () => {
    const { engine, nodeId } = setupWithNode()
    engine.registerMaterialDefinition('mat-track', 'Track Mat', [
      { key: 'uIntensity', kind: 'number', default: 1.0 },
      { key: 'uColor', kind: 'color', default: '#00ff00' },
    ])
    const dispatcher = new CommandDispatcher(engine, new UndoStack())
    expectOk(
      dispatcher.dispatch(
        new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-track' }),
      ),
    )
    // Add a material keyframe to create a track for uIntensity
    engine.addKeyframe({ kind: 'node', nodeId, parameter: 'uIntensity' }, 0, 1.0)

    const parameters = engine.getAnimatableParameters(nodeId)

    const intensity = parameters.find((p) => p.key === 'uIntensity')
    const color = parameters.find((p) => p.key === 'uColor')
    expect(intensity?.linked).toBe(true)
    expect(color?.linked).toBe(false)
  })

  it('marks standard properties as linked when the node has property keyframes', () => {
    const { engine, nodeId } = setupWithNode()
    engine.addKeyframe({ kind: 'node', nodeId, property: 'positionX' }, 0, 100)
    engine.addKeyframe({ kind: 'node', nodeId, property: 'opacity' }, 0, 0.5)

    const parameters = engine.getAnimatableParameters(nodeId)

    const positionX = parameters.find((p) => p.key === 'positionX')
    const opacity = parameters.find((p) => p.key === 'opacity')
    const rotation = parameters.find((p) => p.key === 'rotation')
    expect(positionX?.linked).toBe(true)
    expect(opacity?.linked).toBe(true)
    expect(rotation?.linked).toBe(false)
  })

  it('returns only standard properties when the node has no material definition params', () => {
    const { engine, nodeId } = setupWithNode()
    // Default material has only tint and opacityMultiplier which are built-in
    const parameters = engine.getAnimatableParameters(nodeId)

    expect(parameters).toHaveLength(6)
    expect(parameters.every((p) => p.source === 'standard')).toBe(true)
  })

  it('handles an embedded material with custom parameters', () => {
    const { engine, nodeId } = setupWithNode()
    engine.embedMaterial({
      id: 'embedded-mat',
      name: 'Embedded',
      description: '',
      tags: [],
      createdAt: '',
      updatedAt: '',
      parameters: [
        { key: 'uGlow', kind: 'number', default: 0.8 },
        { key: 'uTint', kind: 'color', default: '#0000ff' },
      ],
      shaderId: null,
    })
    const dispatcher = new CommandDispatcher(engine, new UndoStack())
    expectOk(
      dispatcher.dispatch(
        new AssignMaterialCommand({ nodeId, materialDefinitionId: 'embedded-mat' }),
      ),
    )

    const parameters = engine.getAnimatableParameters(nodeId)

    const materialKeys = parameters.filter((p) => p.source === 'material').map((p) => p.key)
    expect(materialKeys).toContain('uGlow')
    expect(materialKeys).toContain('uTint')
  })

  it('produces correct labels for standard properties', () => {
    const { engine, nodeId } = setupWithNode()

    const parameters = engine.getAnimatableParameters(nodeId)

    expect(parameters.find((p) => p.key === 'positionX')?.label).toBe('Position X')
    expect(parameters.find((p) => p.key === 'positionY')?.label).toBe('Position Y')
    expect(parameters.find((p) => p.key === 'rotation')?.label).toBe('Rotation')
    expect(parameters.find((p) => p.key === 'scaleX')?.label).toBe('Scale X')
    expect(parameters.find((p) => p.key === 'scaleY')?.label).toBe('Scale Y')
    expect(parameters.find((p) => p.key === 'opacity')?.label).toBe('Opacity')
  })

  it('formats camelCase material parameter keys as labels', () => {
    const { engine, nodeId } = setupWithNode()
    engine.registerMaterialDefinition('mat-labels', 'Labels', [
      { key: 'uAmbientColor', kind: 'color', default: '#333333' },
      { key: 'emissiveStrength', kind: 'number', default: 0.5 },
    ])
    const dispatcher = new CommandDispatcher(engine, new UndoStack())
    expectOk(
      dispatcher.dispatch(
        new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-labels' }),
      ),
    )

    const parameters = engine.getAnimatableParameters(nodeId)

    const ambient = parameters.find((p) => p.key === 'uAmbientColor')
    const emissive = parameters.find((p) => p.key === 'emissiveStrength')
    expect(ambient?.label).toBe('U Ambient Color')
    expect(emissive?.label).toBe('Emissive Strength')
  })
})
