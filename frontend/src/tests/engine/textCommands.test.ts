import { describe, expect, it, vi } from 'vitest'
import type { EngineEvent } from '../../engine/events'
import type { CommandResult } from '../../engine/commands'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  SetTextAlignmentCommand,
  SetTextContentCommand,
  SetTextFontSizeCommand,
  createCommandSystem,
} from '../../engine/commands'

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function setupWithTextNode() {
  const system = createCommandSystem()
  expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const slide = system.engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const { nodeId } = expectOk(
    system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: 'T',
        components: {
          text: { kind: 'text', content: 'Hello', fontSize: 24, alignment: 'left' },
        },
      }),
    ),
  )
  return { system, nodeId }
}

function setupWithPlainNode() {
  const system = createCommandSystem()
  expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const slide = system.engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const { nodeId } = expectOk(
    system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: 'N',
      }),
    ),
  )
  return { system, nodeId }
}

function collectEvents(system: ReturnType<typeof createCommandSystem>): EngineEvent[] {
  const events: EngineEvent[] = []
  system.engine.subscribe((event) => events.push(event))
  return events
}

describe('SetTextContentCommand', () => {
  it('changes text content, emits TextChanged, records parameters and inverse, and logs it', () => {
    const log = vi.fn()
    const system = createCommandSystem(log)
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const slide = system.engine.project?.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const { nodeId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'T',
          components: {
            text: { kind: 'text', content: 'Hello', fontSize: 24, alignment: 'left' },
          },
        }),
      ),
    )
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(
      new SetTextContentCommand({ nodeId, content: 'World' }),
    )

    const inverse = expectOk(result)
    expect(system.engine.getNode(nodeId).components.text?.content).toBe('World')
    expect(events).toEqual([{ type: 'TextChanged', nodeId }])
    expect(inverse).toEqual({ nodeId, oldContent: 'Hello' })
    expect(system.undoStack.entries[0]).toMatchObject({
      type: 'SetTextContent',
      parameters: { nodeId, content: 'World' },
      inverse,
    })
    expect(log).toHaveBeenCalledWith(`SetTextContent nodeId=${nodeId} content=World`)
  })

  it('allows setting content to an empty string', () => {
    const { system, nodeId } = setupWithTextNode()

    const result = system.dispatcher.dispatch(new SetTextContentCommand({ nodeId, content: '' }))

    expectOk(result)
    expect(system.engine.getNode(nodeId).components.text?.content).toBe('')
  })

  it('rejects a non-string content and leaves the engine unchanged', () => {
    const { system, nodeId } = setupWithTextNode()
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      // @ts-expect-error testing invalid input
      new SetTextContentCommand({ nodeId, content: 123 }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/text content/i)
    }
    expect(system.engine.getNode(nodeId).components.text?.content).toBe('Hello')
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects a node without a text component', () => {
    const { system, nodeId } = setupWithPlainNode()

    const result = system.dispatcher.dispatch(new SetTextContentCommand({ nodeId, content: 'X' }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/text component/i)
    }
  })

  it('rejects a nonexistent node', () => {
    const { system } = setupWithTextNode()

    const result = system.dispatcher.dispatch(
      new SetTextContentCommand({ nodeId: 'ghost', content: 'X' }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/node.*not found/i)
    }
  })

  it('serializes to JSON with its type and parameters', () => {
    expect(new SetTextContentCommand({ nodeId: 'n1', content: 'Hi' }).toJSON()).toEqual({
      type: 'SetTextContent',
      nodeId: 'n1',
      content: 'Hi',
    })
  })
})

describe('SetTextFontSizeCommand', () => {
  it('changes font size, emits TextChanged, records parameters and inverse, and logs it', () => {
    const log = vi.fn()
    const system = createCommandSystem(log)
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const slide = system.engine.project?.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const { nodeId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'T',
          components: {
            text: { kind: 'text', content: 'Hello', fontSize: 24, alignment: 'left' },
          },
        }),
      ),
    )
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(new SetTextFontSizeCommand({ nodeId, fontSize: 48 }))

    const inverse = expectOk(result)
    expect(system.engine.getNode(nodeId).components.text?.fontSize).toBe(48)
    expect(events).toEqual([{ type: 'TextChanged', nodeId }])
    expect(inverse).toEqual({ nodeId, oldFontSize: 24 })
    expect(system.undoStack.entries[0]).toMatchObject({
      type: 'SetTextFontSize',
      parameters: { nodeId, fontSize: 48 },
      inverse,
    })
    expect(log).toHaveBeenCalledWith(`SetTextFontSize nodeId=${nodeId} fontSize=48`)
  })

  it('rejects a non-positive font size and leaves the engine unchanged', () => {
    const { system, nodeId } = setupWithTextNode()
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(new SetTextFontSizeCommand({ nodeId, fontSize: 0 }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/font size/i)
    }
    expect(system.engine.getNode(nodeId).components.text?.fontSize).toBe(24)
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects a negative font size', () => {
    const { system, nodeId } = setupWithTextNode()

    const result = system.dispatcher.dispatch(new SetTextFontSizeCommand({ nodeId, fontSize: -10 }))

    expect(result.ok).toBe(false)
    expect(system.engine.getNode(nodeId).components.text?.fontSize).toBe(24)
  })

  it('rejects NaN font size', () => {
    const { system, nodeId } = setupWithTextNode()

    const result = system.dispatcher.dispatch(
      new SetTextFontSizeCommand({ nodeId, fontSize: Number.NaN }),
    )

    expect(result.ok).toBe(false)
    expect(system.engine.getNode(nodeId).components.text?.fontSize).toBe(24)
  })

  it('rejects a node without a text component', () => {
    const { system, nodeId } = setupWithPlainNode()

    const result = system.dispatcher.dispatch(new SetTextFontSizeCommand({ nodeId, fontSize: 16 }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/text component/i)
    }
  })

  it('rejects a nonexistent node', () => {
    const { system } = setupWithTextNode()

    const result = system.dispatcher.dispatch(
      new SetTextFontSizeCommand({ nodeId: 'ghost', fontSize: 16 }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/node.*not found/i)
    }
  })

  it('serializes to JSON with its type and parameters', () => {
    expect(new SetTextFontSizeCommand({ nodeId: 'n1', fontSize: 32 }).toJSON()).toEqual({
      type: 'SetTextFontSize',
      nodeId: 'n1',
      fontSize: 32,
    })
  })
})

describe('SetTextAlignmentCommand', () => {
  it('changes alignment, emits TextChanged, records parameters and inverse, and logs it', () => {
    const log = vi.fn()
    const system = createCommandSystem(log)
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const slide = system.engine.project?.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const { nodeId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'T',
          components: {
            text: { kind: 'text', content: 'Hello', fontSize: 24, alignment: 'left' },
          },
        }),
      ),
    )
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(
      new SetTextAlignmentCommand({ nodeId, alignment: 'center' }),
    )

    const inverse = expectOk(result)
    expect(system.engine.getNode(nodeId).components.text?.alignment).toBe('center')
    expect(events).toEqual([{ type: 'TextChanged', nodeId }])
    expect(inverse).toEqual({ nodeId, oldAlignment: 'left' })
    expect(system.undoStack.entries[0]).toMatchObject({
      type: 'SetTextAlignment',
      parameters: { nodeId, alignment: 'center' },
      inverse,
    })
    expect(log).toHaveBeenCalledWith(`SetTextAlignment nodeId=${nodeId} alignment=center`)
  })

  it('accepts all valid alignments', () => {
    const { system, nodeId } = setupWithTextNode()

    for (const alignment of ['left', 'center', 'right'] as const) {
      const result = system.dispatcher.dispatch(new SetTextAlignmentCommand({ nodeId, alignment }))
      expect(result.ok).toBe(true)
      expect(system.engine.getNode(nodeId).components.text?.alignment).toBe(alignment)
    }
  })

  it('rejects an invalid alignment and leaves the engine unchanged', () => {
    const { system, nodeId } = setupWithTextNode()
    const events = collectEvents(system)
    const undoCount = system.undoStack.entries.length

    const result = system.dispatcher.dispatch(
      // @ts-expect-error testing invalid input
      new SetTextAlignmentCommand({ nodeId, alignment: 'justify' }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/alignment/i)
    }
    expect(system.engine.getNode(nodeId).components.text?.alignment).toBe('left')
    expect(system.undoStack.entries).toHaveLength(undoCount)
    expect(events).toEqual([])
  })

  it('rejects a node without a text component', () => {
    const { system, nodeId } = setupWithPlainNode()

    const result = system.dispatcher.dispatch(
      new SetTextAlignmentCommand({ nodeId, alignment: 'right' }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/text component/i)
    }
  })

  it('rejects a nonexistent node', () => {
    const { system } = setupWithTextNode()

    const result = system.dispatcher.dispatch(
      new SetTextAlignmentCommand({ nodeId: 'ghost', alignment: 'right' }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/node.*not found/i)
    }
  })

  it('serializes to JSON with its type and parameters', () => {
    expect(new SetTextAlignmentCommand({ nodeId: 'n1', alignment: 'right' }).toJSON()).toEqual({
      type: 'SetTextAlignment',
      nodeId: 'n1',
      alignment: 'right',
    })
  })
})
