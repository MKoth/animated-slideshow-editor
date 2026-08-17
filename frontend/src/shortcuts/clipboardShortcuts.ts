import {
  copySelection,
  deleteSelection,
  duplicateSelection,
  pasteClipboard,
} from '../app/clipboardActions'
import {
  deleteSelectedKeyframes,
  copyKeyframes,
  pasteKeyframes,
  duplicateKeyframes,
} from '../app/keyframeSelectionActions'
import { isKeyframeClipboardEmpty } from '../stores/keyframeClipboardStore'
import { useTimelineSelectionStore, selectedKeyframeIdsOf } from '../stores/timelineSelectionStore'
import type { EnginePublic } from '../engine'
import type { DispatchCommand } from '../engine/commands'
import { registerShortcut } from './shortcutRegistry'

export interface ClipboardShortcutDeps {
  readonly engine: EnginePublic
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
      if (!withSelectedKeyframes(engine, (e) => copyKeyframes(e))) {
        copySelection(engine)
      }
    }),
    registerShortcut('ctrl+v', () => {
      const { engine, dispatch } = getDeps()
      if (!isKeyframeClipboardEmpty()) {
        pasteKeyframes(engine, dispatch)
      } else {
        pasteClipboard(dispatch)
      }
    }),
    registerShortcut('ctrl+d', () => {
      const { engine, dispatch } = getDeps()
      if (!withSelectedKeyframes(engine, (e) => duplicateKeyframes(e, dispatch))) {
        duplicateSelection(engine, dispatch)
      }
    }),
    registerShortcut('delete', deleteHandler),
    registerShortcut('backspace', deleteHandler),
  ]
  return () => disposers.forEach((dispose) => dispose())
}

function withSelectedKeyframes(engine: EnginePublic, action: (e: EnginePublic) => void): boolean {
  const ids = selectedKeyframeIdsOf(useTimelineSelectionStore.getState())
  if (ids.length > 0) {
    action(engine)
    return true
  }
  return false
}
