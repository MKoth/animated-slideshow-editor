import {
  copySelection,
  deleteSelection,
  duplicateSelection,
  pasteClipboard,
} from '../app/clipboardActions'
import { deleteSelectedKeyframes } from '../app/keyframeSelectionActions'
import type { EngineReadOnly } from '../engine'
import type { DispatchCommand } from '../engine/commands'
import { registerShortcut } from './shortcutRegistry'

export interface ClipboardShortcutDeps {
  readonly engine: EngineReadOnly
  readonly dispatch: DispatchCommand
}

export function registerClipboardShortcuts(getDeps: () => ClipboardShortcutDeps): () => void {
  const deleteHandler = () => {
    const { engine, dispatch } = getDeps()
    if (!deleteSelectedKeyframes(engine, dispatch)) {
      deleteSelection(engine, dispatch)
    }
  }
  const disposers = [
    registerShortcut('ctrl+c', () => {
      const { engine } = getDeps()
      copySelection(engine)
    }),
    registerShortcut('ctrl+v', () => {
      const { dispatch } = getDeps()
      pasteClipboard(dispatch)
    }),
    registerShortcut('ctrl+d', () => {
      const { engine, dispatch } = getDeps()
      duplicateSelection(engine, dispatch)
    }),
    registerShortcut('delete', deleteHandler),
    registerShortcut('backspace', deleteHandler),
  ]
  return () => disposers.forEach((dispose) => dispose())
}
