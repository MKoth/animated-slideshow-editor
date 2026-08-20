import { create } from 'zustand'

export type MeshEditTool = 'select' | 'delete'

export interface MeshEditState {
  readonly meshEditNodeId: string | null
  readonly meshEditTool: MeshEditTool
  readonly selectedVertexIndices: readonly number[]
  enterMeshEdit(nodeId: string): void
  exitMeshEdit(): void
  setMeshEditTool(tool: MeshEditTool): void
  selectVertex(index: number): void
  selectVertices(indices: readonly number[]): void
  toggleVertex(index: number): void
  extendVertex(index: number): void
  clearVertexSelection(): void
}

export const useMeshEditStore = create<MeshEditState>()((set) => ({
  meshEditNodeId: null,
  meshEditTool: 'select',
  selectedVertexIndices: [],

  enterMeshEdit: (nodeId) =>
    set({ meshEditNodeId: nodeId, meshEditTool: 'select', selectedVertexIndices: [] }),

  exitMeshEdit: () =>
    set({ meshEditNodeId: null, meshEditTool: 'select', selectedVertexIndices: [] }),

  setMeshEditTool: (tool) => set({ meshEditTool: tool }),

  selectVertex: (index) =>
    set({ selectedVertexIndices: [index] }),

  selectVertices: (indices) =>
    set({ selectedVertexIndices: [...indices] }),

  toggleVertex: (index) =>
    set((state) => ({
      selectedVertexIndices: state.selectedVertexIndices.includes(index)
        ? state.selectedVertexIndices.filter((i) => i !== index)
        : [...state.selectedVertexIndices, index],
    })),

  extendVertex: (index) =>
    set((state) => ({
      selectedVertexIndices: state.selectedVertexIndices.includes(index)
        ? state.selectedVertexIndices
        : [...state.selectedVertexIndices, index],
    })),

  clearVertexSelection: () => set({ selectedVertexIndices: [] }),
}))
