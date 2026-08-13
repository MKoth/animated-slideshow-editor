import type { DispatchCommand } from '../engine/commands'
import {
  CommandDispatcher,
  CreateAssetInstanceCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  UndoStack,
} from '../engine/commands'
import { createEngine } from '../engine/internal'

export interface InspectorHarness {
  dispatch: DispatchCommand
  undoStack: UndoStack
  engine: ReturnType<typeof createEngine>
  nodeId: string
}

export function mountInspector(): InspectorHarness {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack)
  dispatcher.dispatch(new CreateProjectCommand({ name: 'P' }))
  dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' }))
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const definition = engine.defineAsset('Boy')
  const { nodeId } = expectCommandOk(
    dispatcher.dispatch(
      new CreateAssetInstanceCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        definitionId: definition.id,
        name: 'Boy',
        position: { x: 10, y: 20 },
        rotation: 0.5,
        scaleX: 2,
        scaleY: 3,
      }),
    ),
  )
  return { dispatch: (command) => dispatcher.dispatch(command), undoStack, engine, nodeId }
}

export function expectCommandOk<T>(result: { ok: boolean; inverse?: T; error?: Error }): T {
  if (!result.ok) {
    throw new Error(`expected success, got: ${result.error?.message ?? 'unknown error'}`)
  }
  return result.inverse as T
}

export function createNamedNode(
  engine: ReturnType<typeof createEngine>,
  name: string,
  options: {
    transform?: { x?: number; y?: number; rotation?: number; scaleX?: number; scaleY?: number }
    opacity?: number
  } = {},
): string {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const { transform = {}, opacity } = options
  return engine.createNode(slide.scene.id, slide.scene.root.id, name, {
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, ...transform },
    ...(opacity === undefined ? {} : { opacity }),
  }).id
}

export function transactionChildTypes(undoStack: UndoStack, index: number): string[] {
  const children = (undoStack.entries[index].parameters.commands as { type: string }[]).map(
    (command) => command.type,
  )
  return children
}

export function transactionChildInverses(undoStack: UndoStack, index: number): unknown[] {
  const inverse = undoStack.entries[index].inverse as { children: { inverse: unknown }[] }
  return inverse.children.map((child) => child.inverse)
}
