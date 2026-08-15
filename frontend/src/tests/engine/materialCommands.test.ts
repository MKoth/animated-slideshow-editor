import { describe, expect, it, vi } from 'vitest'
import type { EngineEvent } from '../../engine/events'
import type { CommandLogger, CommandResult } from '../../engine/commands'
import {
  AssignMaterialCommand,
  ClearMaterialOverrideCommand,
  CommandDispatcher,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  OverrideMaterialParameterCommand,
  UndoStack,
} from '../../engine/commands'
import { createEngine } from '../../engine/internal'
import {
  DEFAULT_MATERIAL_DEFINITION_ID,
  DEFAULT_MATERIAL_NAME,
} from '../../engine/materialInstance'

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function setupWithNode(log?: CommandLogger) {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, log)
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
  return {
    engine,
    dispatcher,
    undoStack,
    nodeId,
    sceneId: slide.scene.id,
    rootId: slide.scene.root.id,
  }
}

function collectEvents(engine: ReturnType<typeof createEngine>): EngineEvent[] {
  const events: EngineEvent[] = []
  engine.subscribe((event) => events.push(event))
  return events
}

describe('default material', () => {
  it('registers the Default Material in a fresh engine', () => {
    const engine = createEngine()

    const defaultDefinition = engine.getMaterialDefinition(DEFAULT_MATERIAL_DEFINITION_ID)

    expect(defaultDefinition.name).toBe(DEFAULT_MATERIAL_NAME)
    expect(engine.materialDefinitions.map((definition) => definition.id)).toContain(
      DEFAULT_MATERIAL_DEFINITION_ID,
    )
  })

  it('defaults a newly created node to the Default Material with no overrides', () => {
    const { engine, nodeId } = setupWithNode()

    const node = engine.getNode(nodeId)

    expect(node.material).toEqual({
      materialDefinitionId: DEFAULT_MATERIAL_DEFINITION_ID,
      overrides: {},
    })
  })

  it('defaults nodes loaded from a pre-material project to the Default Material', () => {
    const { engine, nodeId } = setupWithNode()
    const json = engine.toJSON()
    const restored = createEngine()
    restored.restoreFromJSON(json)

    expect(restored.getNode(nodeId).material).toEqual({
      materialDefinitionId: DEFAULT_MATERIAL_DEFINITION_ID,
      overrides: {},
    })
  })
})

describe('AssignMaterialCommand', () => {
  it('assigns a definition, clears overrides, emits MaterialAssigned, and captures the previous material', () => {
    const log = vi.fn()
    const { engine, dispatcher, undoStack, nodeId } = setupWithNode(log)
    engine.registerMaterialDefinition('mat-1', 'Red Slime')
    expectOk(
      dispatcher.dispatch(
        new OverrideMaterialParameterCommand({ nodeId, parameter: 'tint', value: '#ff0000' }),
      ),
    )
    const events = collectEvents(engine)

    const result = dispatcher.dispatch(
      new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-1' }),
    )

    const inverse = expectOk(result)
    expect(engine.getNode(nodeId).material).toEqual({
      materialDefinitionId: 'mat-1',
      overrides: {},
    })
    expect(events).toEqual([{ type: 'MaterialAssigned', nodeId }])
    expect(inverse).toEqual({
      nodeId,
      previousMaterialDefinitionId: DEFAULT_MATERIAL_DEFINITION_ID,
      previousOverrides: { tint: '#ff0000' },
    })
    expect(undoStack.entries[0]).toMatchObject({
      type: 'AssignMaterial',
      parameters: { nodeId, materialDefinitionId: 'mat-1' },
      inverse,
    })
    expect(log).toHaveBeenCalledWith(`AssignMaterial nodeId=${nodeId} materialDefinitionId=mat-1`)
  })

  it('rejects an unknown node and leaves the engine unchanged', () => {
    const { engine, dispatcher, undoStack } = setupWithNode()
    const events = collectEvents(engine)
    const undoCount = undoStack.entries.length

    const result = dispatcher.dispatch(
      new AssignMaterialCommand({ nodeId: 'ghost', materialDefinitionId: 'mat-1' }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/node.*not found/i)
    }
    expect(undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects an unknown material definition and leaves the engine unchanged', () => {
    const { engine, dispatcher, undoStack, nodeId } = setupWithNode()
    const events = collectEvents(engine)
    const undoCount = undoStack.entries.length

    const result = dispatcher.dispatch(
      new AssignMaterialCommand({ nodeId, materialDefinitionId: 'ghost' }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/definition.*not found/i)
    }
    expect(engine.getNode(nodeId).material.materialDefinitionId).toBe(
      DEFAULT_MATERIAL_DEFINITION_ID,
    )
    expect(undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('serializes to JSON with its type and parameters', () => {
    expect(
      new AssignMaterialCommand({ nodeId: 'n1', materialDefinitionId: 'mat-1' }).toJSON(),
    ).toEqual({ type: 'AssignMaterial', nodeId: 'n1', materialDefinitionId: 'mat-1' })
  })
})

describe('OverrideMaterialParameterCommand', () => {
  it('adds an override, emits MaterialParameterChanged, and records an absent previous value', () => {
    const log = vi.fn()
    const { engine, dispatcher, undoStack, nodeId } = setupWithNode(log)
    const events = collectEvents(engine)

    const result = dispatcher.dispatch(
      new OverrideMaterialParameterCommand({ nodeId, parameter: 'tint', value: '#ff0000' }),
    )

    const inverse = expectOk(result)
    expect(engine.getNode(nodeId).material.overrides).toEqual({ tint: '#ff0000' })
    expect(events).toEqual([{ type: 'MaterialParameterChanged', nodeId }])
    expect(inverse).toEqual({ nodeId, parameter: 'tint', previousValue: null })
    expect(undoStack.entries[0]).toMatchObject({
      type: 'OverrideMaterialParameter',
      parameters: { nodeId, parameter: 'tint', value: '#ff0000' },
      inverse,
    })
    expect(log).toHaveBeenCalledWith(
      `OverrideMaterialParameter nodeId=${nodeId} parameter=tint value=#ff0000`,
    )
  })

  it('changes an existing override and records the previous value', () => {
    const { engine, dispatcher, nodeId } = setupWithNode()
    expectOk(
      dispatcher.dispatch(
        new OverrideMaterialParameterCommand({ nodeId, parameter: 'tint', value: '#ff0000' }),
      ),
    )

    const inverse = expectOk(
      dispatcher.dispatch(
        new OverrideMaterialParameterCommand({ nodeId, parameter: 'tint', value: '#00ff00' }),
      ),
    )

    expect(engine.getNode(nodeId).material.overrides).toEqual({ tint: '#00ff00' })
    expect(inverse).toEqual({ nodeId, parameter: 'tint', previousValue: '#ff0000' })
  })

  it('accepts a finite number value', () => {
    const { engine, dispatcher, nodeId } = setupWithNode()

    const result = dispatcher.dispatch(
      new OverrideMaterialParameterCommand({ nodeId, parameter: 'opacityMultiplier', value: 0.5 }),
    )

    expect(result.ok).toBe(true)
    expect(engine.getNode(nodeId).material.overrides).toEqual({
      opacityMultiplier: 0.5,
    })
  })

  it('accepts a boolean value and records it in the inverse', () => {
    const { engine, dispatcher, undoStack, nodeId } = setupWithNode()

    const result = dispatcher.dispatch(
      new OverrideMaterialParameterCommand({ nodeId, parameter: 'uEnabled', value: true }),
    )

    const inverse = expectOk(result)
    expect(engine.getNode(nodeId).material.overrides).toEqual({ uEnabled: true })
    expect(inverse).toEqual({ nodeId, parameter: 'uEnabled', previousValue: null })
    expect(undoStack.entries[0]).toMatchObject({
      type: 'OverrideMaterialParameter',
      parameters: { nodeId, parameter: 'uEnabled', value: true },
      inverse,
    })
  })

  it('accepts a component-array value and records the previous array on change', () => {
    const { engine, dispatcher, nodeId } = setupWithNode()

    expectOk(
      dispatcher.dispatch(
        new OverrideMaterialParameterCommand({ nodeId, parameter: 'uColor', value: [1, 0, 0] }),
      ),
    )
    const inverse = expectOk(
      dispatcher.dispatch(
        new OverrideMaterialParameterCommand({
          nodeId,
          parameter: 'uColor',
          value: [0.1, 0.2, 0.9],
        }),
      ),
    )

    expect(engine.getNode(nodeId).material.overrides.uColor).toEqual([0.1, 0.2, 0.9])
    expect(inverse).toEqual({ nodeId, parameter: 'uColor', previousValue: [1, 0, 0] })
  })

  it('rejects an empty parameter key', () => {
    const { engine, dispatcher, undoStack, nodeId } = setupWithNode()
    const events = collectEvents(engine)
    const undoCount = undoStack.entries.length

    const result = dispatcher.dispatch(
      new OverrideMaterialParameterCommand({ nodeId, parameter: ' ', value: 1 }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/parameter/i)
    }
    expect(undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects a non-finite value', () => {
    const { dispatcher, nodeId } = setupWithNode()

    const result = dispatcher.dispatch(
      new OverrideMaterialParameterCommand({ nodeId, parameter: 'gain', value: Number.NaN }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/value/i)
    }
  })

  it('rejects a value that is neither a string nor a number', () => {
    const { dispatcher, nodeId } = setupWithNode()

    const result = dispatcher.dispatch(
      new OverrideMaterialParameterCommand({ nodeId, parameter: 'gain', value: {} as never }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/value/i)
    }
  })

  it('rejects a nonexistent node', () => {
    const { engine, dispatcher, undoStack } = setupWithNode()
    const events = collectEvents(engine)
    const undoCount = undoStack.entries.length

    const result = dispatcher.dispatch(
      new OverrideMaterialParameterCommand({
        nodeId: 'ghost',
        parameter: 'tint',
        value: '#ff0000',
      }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/node.*not found/i)
    }
    expect(undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('affects only the target node', () => {
    const { engine, dispatcher, nodeId, sceneId, rootId } = setupWithNode()
    const { nodeId: otherId } = expectOk(
      dispatcher.dispatch(new CreateNodeCommand({ sceneId, parentId: rootId, name: 'B' })),
    )

    expectOk(
      dispatcher.dispatch(
        new OverrideMaterialParameterCommand({ nodeId, parameter: 'tint', value: '#ff0000' }),
      ),
    )

    expect(engine.getNode(nodeId).material.overrides).toEqual({ tint: '#ff0000' })
    expect(engine.getNode(otherId).material).toEqual({
      materialDefinitionId: DEFAULT_MATERIAL_DEFINITION_ID,
      overrides: {},
    })
  })

  it('serializes to JSON with its type and parameters', () => {
    expect(
      new OverrideMaterialParameterCommand({
        nodeId: 'n1',
        parameter: 'tint',
        value: '#ff0000',
      }).toJSON(),
    ).toEqual({
      type: 'OverrideMaterialParameter',
      nodeId: 'n1',
      parameter: 'tint',
      value: '#ff0000',
    })
  })
})

describe('ClearMaterialOverrideCommand', () => {
  it('removes an override, emits MaterialParameterChanged, and records the removed value', () => {
    const log = vi.fn()
    const { engine, dispatcher, undoStack, nodeId } = setupWithNode(log)
    expectOk(
      dispatcher.dispatch(
        new OverrideMaterialParameterCommand({ nodeId, parameter: 'tint', value: '#ff0000' }),
      ),
    )
    const events = collectEvents(engine)

    const result = dispatcher.dispatch(
      new ClearMaterialOverrideCommand({ nodeId, parameter: 'tint' }),
    )

    const inverse = expectOk(result)
    expect(engine.getNode(nodeId).material.overrides).toEqual({})
    expect(events).toEqual([{ type: 'MaterialParameterChanged', nodeId }])
    expect(inverse).toEqual({ nodeId, parameter: 'tint', removedValue: '#ff0000' })
    expect(undoStack.entries[0]).toMatchObject({
      type: 'ClearMaterialOverride',
      parameters: { nodeId, parameter: 'tint' },
      inverse,
    })
    expect(log).toHaveBeenCalledWith(`ClearMaterialOverride nodeId=${nodeId} parameter=tint`)
  })

  it('rejects clearing an override that does not exist', () => {
    const { engine, dispatcher, undoStack, nodeId } = setupWithNode()
    const events = collectEvents(engine)
    const undoCount = undoStack.entries.length

    const result = dispatcher.dispatch(
      new ClearMaterialOverrideCommand({ nodeId, parameter: 'tint' }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/no override/i)
    }
    expect(engine.getNode(nodeId).material.overrides).toEqual({})
    expect(undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects a nonexistent node', () => {
    const { dispatcher } = setupWithNode()

    const result = dispatcher.dispatch(
      new ClearMaterialOverrideCommand({ nodeId: 'ghost', parameter: 'tint' }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/node.*not found/i)
    }
  })

  it('serializes to JSON with its type and parameters', () => {
    expect(new ClearMaterialOverrideCommand({ nodeId: 'n1', parameter: 'tint' }).toJSON()).toEqual({
      type: 'ClearMaterialOverride',
      nodeId: 'n1',
      parameter: 'tint',
    })
  })
})
