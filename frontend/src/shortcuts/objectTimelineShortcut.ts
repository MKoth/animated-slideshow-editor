import { registerShortcut } from './shortcutRegistry'
import { useObjectTimelineStore } from '../stores/objectTimelineStore'
import { useSelectionStore } from '../stores/selectionStore'
import { useTimelineSelectionStore } from '../stores/timelineSelectionStore'

/**
 * L opens the focused animation-lane modal for the primary selected object.
 * Suppressed while the Animation Manager is open and in clip-edit context so
 * the shortcut cannot target a different timeline than the one on screen.
 */
export function registerObjectTimelineShortcut(): () => void {
  return registerShortcut('l', () => {
    if (
      typeof document !== 'undefined' &&
      document.querySelector('[data-testid="animation-manager-overlay"]')
    ) {
      return
    }
    if (useTimelineSelectionStore.getState().editingContext === 'clip-edit') {
      return
    }
    const nodeId = useSelectionStore.getState().selectedIds[0]
    if (!nodeId) {
      return
    }
    useObjectTimelineStore.getState().open(nodeId)
  })
}
