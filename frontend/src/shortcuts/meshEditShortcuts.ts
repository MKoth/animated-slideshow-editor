import { registerShortcut } from './shortcutRegistry'
import { useMeshEditStore } from '../stores/meshEditStore'

export function registerMeshEditShortcuts(): () => void {
  const disposeEscape = registerShortcut('escape', () => {
    const { meshEditNodeId } = useMeshEditStore.getState()
    if (meshEditNodeId) {
      useMeshEditStore.getState().exitMeshEdit()
    }
  })

  return () => {
    disposeEscape()
  }
}
