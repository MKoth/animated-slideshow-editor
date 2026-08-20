import { registerShortcut } from './shortcutRegistry'
import { useMeshEditStore } from '../stores/meshEditStore'
import { useEditingModeStore } from '../stores/editingModeStore'

export function registerMeshEditShortcuts(): () => void {
  const disposeEscape = registerShortcut('escape', () => {
    const { meshEditNodeId } = useMeshEditStore.getState()
    if (meshEditNodeId) {
      useMeshEditStore.getState().exitMeshEdit()
    }
    const { mode } = useEditingModeStore.getState()
    if (mode !== 'default') {
      useEditingModeStore.getState().exitMode()
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

  const disposeW = registerShortcut('w', () => {
    const { meshEditNodeId } = useMeshEditStore.getState()
    if (meshEditNodeId) {
      useMeshEditStore.getState().setMeshEditTool('weightPaint')
    }
  })

  const dispose1Num = registerShortcut('1', () => {
    const { meshEditNodeId, meshEditTool } = useMeshEditStore.getState()
    if (meshEditNodeId && meshEditTool === 'weightPaint') {
      useMeshEditStore.getState().setWeightPaintTool('paint')
    }
  })

  const dispose2Num = registerShortcut('2', () => {
    const { meshEditNodeId, meshEditTool } = useMeshEditStore.getState()
    if (meshEditNodeId && meshEditTool === 'weightPaint') {
      useMeshEditStore.getState().setWeightPaintTool('smooth')
    }
  })

  const dispose3Num = registerShortcut('3', () => {
    const { meshEditNodeId, meshEditTool } = useMeshEditStore.getState()
    if (meshEditNodeId && meshEditTool === 'weightPaint') {
      useMeshEditStore.getState().setWeightPaintTool('fill')
    }
  })

  const dispose4Num = registerShortcut('4', () => {
    const { meshEditNodeId, meshEditTool } = useMeshEditStore.getState()
    if (meshEditNodeId && meshEditTool === 'weightPaint') {
      useMeshEditStore.getState().setWeightPaintTool('blur')
    }
  })

  const dispose5Num = registerShortcut('5', () => {
    const { meshEditNodeId, meshEditTool } = useMeshEditStore.getState()
    if (meshEditNodeId && meshEditTool === 'weightPaint') {
      useMeshEditStore.getState().setWeightPaintTool('autoWeights')
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
    disposeW()
    dispose1Num()
    dispose2Num()
    dispose3Num()
    dispose4Num()
    dispose5Num()
  }
}
