import { describe, expect, it, vi } from 'vitest'
import type { Engine } from '../../engine/internal'
import { createEngine } from '../../engine/internal'
import type { Command, CommandResult } from '../../engine/commands'
import {
  CommandDispatcher,
  CreateProjectCommand,
  CreateSlideCommand,
  MoveNodeCommand,
  TransactionCommand,
  UndoStack,
} from '../../engine/commands'

function setup() {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, vi.fn())
  dispatcher.dispatch(new CreateProjectCommand({ name: 'Demo' }))
  dispatcher.dispatch(new CreateSlideCommand({ name: 'Slide 1' }))
  return { engine, undoStack, dispatcher }
}

function createNode(engine: Engine, name: string): { id: string; x: number; y: number } {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('No slide found')
  }
  const node = engine.createNode(slide.scene.id, slide.scene.root.id, name, {
    transform: { x: 100, y: 200, rotation: 0, scaleX: 1, scaleY: 1 },
  })
  return { id: node.id, x: node.transform.x, y: node.transform.y }
}

class ThrowingCommand implements Command<unknown> {
  readonly type = 'Explode'
  readonly parameters = {}

  validate(): void {
    // valid on purpose: the failure happens inside execute
  }

  execute(): never {
    throw new Error('mid-execute failure')
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type }
  }
}

describe('TransactionCommand', () => {
  it('executes several moves as a single history entry', () => {
    const { engine, undoStack, dispatcher } = setup()
    const a = createNode(engine, 'A')
    const b = createNode(engine, 'B')
    const before = undoStack.entries.length

    const result = dispatcher.dispatch(
      new TransactionCommand([
        new MoveNodeCommand({ nodeId: a.id, x: 150, y: 210 }),
        new MoveNodeCommand({ nodeId: b.id, x: 160, y: 220 }),
      ]),
    )

    expect(result.ok).toBe(true)
    expect(undoStack.entries).toHaveLength(before + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')
    expect(engine.getNode(a.id).transform.x).toBe(150)
    expect(engine.getNode(a.id).transform.y).toBe(210)
    expect(engine.getNode(b.id).transform.x).toBe(160)
    expect(engine.getNode(b.id).transform.y).toBe(220)
  })

  it('records the inverse data for each child command', () => {
    const { engine, undoStack, dispatcher } = setup()
    const a = createNode(engine, 'A')

    dispatcher.dispatch(
      new TransactionCommand([new MoveNodeCommand({ nodeId: a.id, x: 500, y: 500 })]),
    )

    const inverse = undoStack.entries[0].inverse as { children: { inverse: unknown }[] }
    expect(inverse.children).toHaveLength(1)
    expect(inverse.children[0].inverse).toEqual({ nodeId: a.id, oldX: 100, oldY: 200 })
  })

  it('serializes its child commands as parameters', () => {
    const { engine } = setup()
    const a = createNode(engine, 'A')
    const command = new TransactionCommand([new MoveNodeCommand({ nodeId: a.id, x: 5, y: 6 })])

    const json = command.toJSON()
    expect(json.type).toBe('Transaction')
    expect((json.commands as { type: string }[])[0].type).toBe('MoveNode')
  })

  it('rejects the whole transaction and leaves the engine unchanged if any child is invalid', () => {
    const { engine, undoStack, dispatcher } = setup()
    const a = createNode(engine, 'A')
    const before = undoStack.entries.length

    const result = dispatcher.dispatch(
      new TransactionCommand([
        new MoveNodeCommand({ nodeId: a.id, x: 150, y: 210 }),
        new MoveNodeCommand({ nodeId: 'missing', x: 1, y: 1 }),
      ]),
    )

    expect((result as CommandResult<unknown>).ok).toBe(false)
    expect(undoStack.entries).toHaveLength(before)
    expect(engine.getNode(a.id).transform.x).toBe(100)
  })

  it('rolls back already-executed moves when a later child throws mid-execute', () => {
    const { engine, undoStack, dispatcher } = setup()
    const a = createNode(engine, 'A')
    const before = undoStack.entries.length

    const result = dispatcher.dispatch(
      new TransactionCommand([
        new MoveNodeCommand({ nodeId: a.id, x: 150, y: 210 }),
        new ThrowingCommand(),
      ]),
    )

    expect((result as CommandResult<unknown>).ok).toBe(false)
    expect(undoStack.entries).toHaveLength(before)
    expect(engine.getNode(a.id).transform.x).toBe(100)
    expect(engine.getNode(a.id).transform.y).toBe(200)
  })
})
