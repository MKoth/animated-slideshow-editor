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

  const disposeE = registerShortcut('e', () => {
    const { meshEditNodeId } = useMeshEditStore.getState()
    if (meshEditNodeId) {
      useMeshEditStore.getState().setMeshEditTool('extrude')
    }
  })

  const disposeS = registerShortcut('s', () => {
    const { meshEditNodeId } = useMeshEditStore.getState()
    if (meshEditNodeId) {
      useMeshEditStore.getState().setMeshEditTool('subdivide')
    }
  })

  const disposeM = registerShortcut('m', () => {
    const { meshEditNodeId } = useMeshEditStore.getState()
    if (meshEditNodeId) {
      useMeshEditStore.getState().setMeshEditTool('mirror')
    }
  })

  const disposeX = registerShortcut('x', () => {
    const { meshEditNodeId, meshEditTool } = useMeshEditStore.getState()
    if (meshEditNodeId && meshEditTool === 'mirror') {
      useMeshEditStore.getState().setMirrorAxis('x')
    }
  })

  const disposeY = registerShortcut('y', () => {
    const { meshEditNodeId, meshEditTool } = useMeshEditStore.getState()
    if (meshEditNodeId && meshEditTool === 'mirror') {
      useMeshEditStore.getState().setMirrorAxis('y')
    }
  })

  return () => {
    disposeEscape()
    dispose1()
    dispose2()
    dispose3()
    disposeE()
    disposeS()
    disposeM()
    disposeX()
    disposeY()
  }
}
