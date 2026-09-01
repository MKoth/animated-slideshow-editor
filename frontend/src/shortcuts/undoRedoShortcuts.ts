import { registerShortcut } from './shortcutRegistry'
import type { CommandDispatcher } from '../engine/commands'

export interface UndoRedoShortcutDeps {
  readonly dispatcher: CommandDispatcher
}

export function registerUndoRedoShortcuts(getDeps: () => UndoRedoShortcutDeps): () => void {
  const undoHandler = () => {
    const { dispatcher } = getDeps()
    dispatcher.undo()
  }
  const redoHandler = () => {
    const { dispatcher } = getDeps()
    dispatcher.redo()
  }
  const disposers = [
    registerShortcut('ctrl+z', undoHandler),
    registerShortcut('ctrl+shift+z', redoHandler),
    registerShortcut('ctrl+y', redoHandler),
  ]
  return () => disposers.forEach((dispose) => dispose())
}
