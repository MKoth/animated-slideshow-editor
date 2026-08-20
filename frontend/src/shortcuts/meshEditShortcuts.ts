import { registerShortcut } from './shortcutRegistry'
import { useMeshEditStore } from '../stores/meshEditStore'

export function registerMeshEditShortcuts(): () => void {
  const disposeEscape = registerShortcut('escape', () => {
    const { meshEditNodeId } = useMeshEditStore.getState()
    if (meshEditNodeId) {
      useMeshEditStore.getState().exitMeshEdit()
    }
  })

  const dispose1 = registerShortcut('1', () => {
    const { meshEditNodeId } = useMeshEditStore.getState()
    if (meshEditNodeId) {
      useMeshEditStore.getState().setSelectMode('vertex')
    }
  })

  const dispose2 = registerShortcut('2', () => {
    const { meshEditNodeId } = useMeshEditStore.getState()
    if (meshEditNodeId) {
      useMeshEditStore.getState().setSelectMode('edge')
    }
  })

  const dispose3 = registerShortcut('3', () => {
    const { meshEditNodeId } = useMeshEditStore.getState()
    if (meshEditNodeId) {
      useMeshEditStore.getState().setSelectMode('face')
    }
  })

  return () => {
    disposeEscape()
    dispose1()
    dispose2()
    dispose3()
  }
}
