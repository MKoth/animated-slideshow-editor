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

  it('starts with vertex select mode', () => {
    useMeshEditStore.getState().enterMeshEdit('node1')
    expect(useMeshEditStore.getState().selectMode).toBe('vertex')
  })

  it('switches select mode', () => {
    useMeshEditStore.getState().enterMeshEdit('node1')
    useMeshEditStore.getState().setSelectMode('edge')
    expect(useMeshEditStore.getState().selectMode).toBe('edge')
    useMeshEditStore.getState().setSelectMode('face')
    expect(useMeshEditStore.getState().selectMode).toBe('face')
    useMeshEditStore.getState().setSelectMode('vertex')
    expect(useMeshEditStore.getState().selectMode).toBe('vertex')
  })

  it('preserves selections when switching select mode', () => {
    useMeshEditStore.getState().enterMeshEdit('node1')
    useMeshEditStore.getState().selectVertices([0, 1])
    useMeshEditStore.getState().selectEdges([{ v0: 0, v1: 1 }])
    useMeshEditStore.getState().selectFaces([0])
    useMeshEditStore.getState().setSelectMode('edge')
    expect(useMeshEditStore.getState().selectedVertexIndices).toEqual([0, 1])
    expect(useMeshEditStore.getState().selectedEdgeIndices).toEqual([{ v0: 0, v1: 1 }])
    expect(useMeshEditStore.getState().selectedFaceIndices).toEqual([0])
  })

  it('selects a single edge', () => {
    useMeshEditStore.getState().enterMeshEdit('node1')
    useMeshEditStore.getState().selectEdge({ v0: 0, v1: 1 })
    expect(useMeshEditStore.getState().selectedEdgeIndices).toEqual([{ v0: 0, v1: 1 }])
  })

  it('toggles edge selection', () => {
    useMeshEditStore.getState().enterMeshEdit('node1')
    useMeshEditStore.getState().selectEdge({ v0: 0, v1: 1 })
    useMeshEditStore.getState().toggleEdge({ v0: 0, v1: 2 })
    expect(useMeshEditStore.getState().selectedEdgeIndices).toEqual([
      { v0: 0, v1: 1 },
      { v0: 0, v1: 2 },
    ])
    useMeshEditStore.getState().toggleEdge({ v0: 0, v1: 1 })
    expect(useMeshEditStore.getState().selectedEdgeIndices).toEqual([{ v0: 0, v1: 2 }])
  })

  it('extends edge selection', () => {
    useMeshEditStore.getState().enterMeshEdit('node1')
    useMeshEditStore.getState().selectEdge({ v0: 0, v1: 1 })
    useMeshEditStore.getState().extendEdge({ v0: 1, v1: 2 })
    expect(useMeshEditStore.getState().selectedEdgeIndices).toEqual([
      { v0: 0, v1: 1 },
      { v0: 1, v1: 2 },
    ])
    // Extending same edge does not duplicate
    useMeshEditStore.getState().extendEdge({ v0: 1, v1: 2 })
    expect(useMeshEditStore.getState().selectedEdgeIndices).toEqual([
      { v0: 0, v1: 1 },
      { v0: 1, v1: 2 },
    ])
  })

  it('clears edge selection', () => {
    useMeshEditStore.getState().enterMeshEdit('node1')
    useMeshEditStore.getState().selectEdges([
      { v0: 0, v1: 1 },
      { v0: 1, v1: 2 },
    ])
    useMeshEditStore.getState().clearEdgeSelection()
    expect(useMeshEditStore.getState().selectedEdgeIndices).toEqual([])
  })

  it('selects a single face', () => {
    useMeshEditStore.getState().enterMeshEdit('node1')
    useMeshEditStore.getState().selectFace(2)
    expect(useMeshEditStore.getState().selectedFaceIndices).toEqual([2])
  })

  it('toggles face selection', () => {
    useMeshEditStore.getState().enterMeshEdit('node1')
    useMeshEditStore.getState().selectFace(0)
    useMeshEditStore.getState().toggleFace(1)
    expect(useMeshEditStore.getState().selectedFaceIndices).toEqual([0, 1])
    useMeshEditStore.getState().toggleFace(0)
    expect(useMeshEditStore.getState().selectedFaceIndices).toEqual([1])
  })

  it('extends face selection', () => {
    useMeshEditStore.getState().enterMeshEdit('node1')
    useMeshEditStore.getState().selectFace(0)
    useMeshEditStore.getState().extendFace(1)
    expect(useMeshEditStore.getState().selectedFaceIndices).toEqual([0, 1])
    // Extending same face does not duplicate
    useMeshEditStore.getState().extendFace(1)
    expect(useMeshEditStore.getState().selectedFaceIndices).toEqual([0, 1])
  })

  it('clears face selection', () => {
    useMeshEditStore.getState().enterMeshEdit('node1')
    useMeshEditStore.getState().selectFaces([0, 1, 2])
    useMeshEditStore.getState().clearFaceSelection()
    expect(useMeshEditStore.getState().selectedFaceIndices).toEqual([])
  })

  it('resets all selection state when entering mesh edit', () => {
    useMeshEditStore.getState().enterMeshEdit('node1')
    useMeshEditStore.getState().selectVertices([0, 1])
    useMeshEditStore.getState().selectEdges([{ v0: 0, v1: 1 }])
    useMeshEditStore.getState().selectFaces([0])
    useMeshEditStore.getState().setSelectMode('edge')
    useMeshEditStore.getState().enterMeshEdit('node2')
    expect(useMeshEditStore.getState().selectMode).toBe('vertex')
    expect(useMeshEditStore.getState().selectedVertexIndices).toEqual([])
    expect(useMeshEditStore.getState().selectedEdgeIndices).toEqual([])
    expect(useMeshEditStore.getState().selectedFaceIndices).toEqual([])
  })

  it('edge equality ignores vertex order', () => {
    useMeshEditStore.getState().enterMeshEdit('node1')
    useMeshEditStore.getState().selectEdge({ v0: 2, v1: 5 })
    // Toggling with reversed order should remove it
    useMeshEditStore.getState().toggleEdge({ v0: 5, v1: 2 })
    expect(useMeshEditStore.getState().selectedEdgeIndices).toEqual([])
  })
})
