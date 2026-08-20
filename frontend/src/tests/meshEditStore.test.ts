import { describe, expect, it } from 'vitest'
import { useMeshEditStore } from '../stores/meshEditStore'

describe('meshEditStore', () => {
  it('starts with no mesh edit node', () => {
    const state = useMeshEditStore.getState()
    expect(state.meshEditNodeId).toBeNull()
    expect(state.meshEditTool).toBe('select')
    expect(state.selectedVertexIndices).toEqual([])
  })

  it('enters and exits mesh edit mode', () => {
    useMeshEditStore.getState().enterMeshEdit('node1')
    expect(useMeshEditStore.getState().meshEditNodeId).toBe('node1')
    expect(useMeshEditStore.getState().meshEditTool).toBe('select')
    expect(useMeshEditStore.getState().selectedVertexIndices).toEqual([])

    useMeshEditStore.getState().exitMeshEdit()
    expect(useMeshEditStore.getState().meshEditNodeId).toBeNull()
  })

  it('selects a single vertex', () => {
    useMeshEditStore.getState().enterMeshEdit('node1')
    useMeshEditStore.getState().selectVertex(2)
    expect(useMeshEditStore.getState().selectedVertexIndices).toEqual([2])
  })

  it('toggles vertex selection', () => {
    useMeshEditStore.getState().enterMeshEdit('node1')
    useMeshEditStore.getState().selectVertex(0)
    useMeshEditStore.getState().toggleVertex(1)
    expect(useMeshEditStore.getState().selectedVertexIndices).toEqual([0, 1])
    useMeshEditStore.getState().toggleVertex(0)
    expect(useMeshEditStore.getState().selectedVertexIndices).toEqual([1])
  })

  it('extends vertex selection', () => {
    useMeshEditStore.getState().enterMeshEdit('node1')
    useMeshEditStore.getState().selectVertex(0)
    useMeshEditStore.getState().extendVertex(1)
    expect(useMeshEditStore.getState().selectedVertexIndices).toEqual([0, 1])
    // Extending same vertex does not duplicate
    useMeshEditStore.getState().extendVertex(1)
    expect(useMeshEditStore.getState().selectedVertexIndices).toEqual([0, 1])
  })

  it('clears vertex selection', () => {
    useMeshEditStore.getState().enterMeshEdit('node1')
    useMeshEditStore.getState().selectVertices([0, 1, 2])
    useMeshEditStore.getState().clearVertexSelection()
    expect(useMeshEditStore.getState().selectedVertexIndices).toEqual([])
  })

  it('switches mesh edit tool', () => {
    useMeshEditStore.getState().enterMeshEdit('node1')
    useMeshEditStore.getState().setMeshEditTool('delete')
    expect(useMeshEditStore.getState().meshEditTool).toBe('delete')
  })

  it('resets state when entering mesh edit', () => {
    useMeshEditStore.getState().enterMeshEdit('node1')
    useMeshEditStore.getState().selectVertices([0, 1, 2])
    useMeshEditStore.getState().setMeshEditTool('delete')
    useMeshEditStore.getState().enterMeshEdit('node2')
    expect(useMeshEditStore.getState().meshEditNodeId).toBe('node2')
    expect(useMeshEditStore.getState().meshEditTool).toBe('select')
    expect(useMeshEditStore.getState().selectedVertexIndices).toEqual([])
  })
})
