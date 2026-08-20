import { create } from 'zustand'
import type { MeshEdge } from '../engine/mesh'
import { edgeKey } from '../engine/mesh'

export type MeshEditTool = 'select' | 'delete' | 'extrude' | 'subdivide' | 'mirror' | 'weightPaint'
export type MeshSelectMode = 'vertex' | 'edge' | 'face'
export type WeightPaintTool = 'paint' | 'smooth' | 'fill' | 'blur' | 'autoWeights'

export interface MeshEditState {
  readonly meshEditNodeId: string | null
  readonly meshEditTool: MeshEditTool
  readonly selectMode: MeshSelectMode
  readonly mirrorAxis: 'x' | 'y'
  readonly selectedVertexIndices: readonly number[]
  readonly selectedEdgeIndices: readonly MeshEdge[]
  readonly selectedFaceIndices: readonly number[]
  readonly weightPaintTool: WeightPaintTool
  readonly selectedBoneId: string | null
  readonly brushRadius: number
  readonly brushStrength: number
  readonly heatmapVisible: boolean
  enterMeshEdit(nodeId: string): void
  exitMeshEdit(): void
  setMeshEditTool(tool: MeshEditTool): void
  setSelectMode(mode: MeshSelectMode): void
  setMirrorAxis(axis: 'x' | 'y'): void
  selectVertex(index: number): void
  selectVertices(indices: readonly number[]): void
  toggleVertex(index: number): void
  extendVertex(index: number): void
  clearVertexSelection(): void
  selectEdge(edge: MeshEdge): void
  selectEdges(edges: readonly MeshEdge[]): void
  toggleEdge(edge: MeshEdge): void
  extendEdge(edge: MeshEdge): void
  clearEdgeSelection(): void
  selectFace(index: number): void
  selectFaces(indices: readonly number[]): void
  toggleFace(index: number): void
  extendFace(index: number): void
  clearFaceSelection(): void
  clearAllSelection(): void
  setWeightPaintTool(tool: WeightPaintTool): void
  setSelectedBoneId(boneId: string | null): void
  setBrushRadius(radius: number): void
  setBrushStrength(strength: number): void
  toggleHeatmap(): void
  setHeatmapVisible(visible: boolean): void
}

function edgesEqual(a: MeshEdge, b: MeshEdge): boolean {
  return edgeKey(a.v0, a.v1) === edgeKey(b.v0, b.v1)
}

function includesEdge(edges: readonly MeshEdge[], edge: MeshEdge): boolean {
  return edges.some((e) => edgesEqual(e, edge))
}

export const useMeshEditStore = create<MeshEditState>()((set) => ({
  meshEditNodeId: null,
  meshEditTool: 'select',
  selectMode: 'vertex',
  mirrorAxis: 'x',
  selectedVertexIndices: [],
  selectedEdgeIndices: [],
  selectedFaceIndices: [],
  weightPaintTool: 'paint',
  selectedBoneId: null,
  brushRadius: 0.5,
  brushStrength: 1.0,
  heatmapVisible: true,

  enterMeshEdit: (nodeId) =>
    set({
      meshEditNodeId: nodeId,
      meshEditTool: 'select',
      selectMode: 'vertex',
      mirrorAxis: 'x',
      selectedVertexIndices: [],
      selectedEdgeIndices: [],
      selectedFaceIndices: [],
      weightPaintTool: 'paint',
      selectedBoneId: null,
      brushRadius: 0.5,
      brushStrength: 1.0,
      heatmapVisible: true,
    }),

  exitMeshEdit: () =>
    set({
      meshEditNodeId: null,
      meshEditTool: 'select',
      selectMode: 'vertex',
      mirrorAxis: 'x',
      selectedVertexIndices: [],
      selectedEdgeIndices: [],
      selectedFaceIndices: [],
      weightPaintTool: 'paint',
      selectedBoneId: null,
      brushRadius: 0.5,
      brushStrength: 1.0,
      heatmapVisible: true,
    }),

  setMeshEditTool: (tool) => set({ meshEditTool: tool }),

  setSelectMode: (mode) => set({ selectMode: mode }),

  setMirrorAxis: (axis) => set({ mirrorAxis: axis }),

  selectVertex: (index) => set({ selectedVertexIndices: [index] }),

  selectVertices: (indices) => set({ selectedVertexIndices: [...indices] }),

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

  selectEdge: (edge) => set({ selectedEdgeIndices: [{ v0: edge.v0, v1: edge.v1 }] }),

  selectEdges: (edges) => set({ selectedEdgeIndices: edges.map((e) => ({ v0: e.v0, v1: e.v1 })) }),

  toggleEdge: (edge) =>
    set((state) => ({
      selectedEdgeIndices: includesEdge(state.selectedEdgeIndices, edge)
        ? state.selectedEdgeIndices.filter((e) => !edgesEqual(e, edge))
        : [...state.selectedEdgeIndices, { v0: edge.v0, v1: edge.v1 }],
    })),

  extendEdge: (edge) =>
    set((state) => ({
      selectedEdgeIndices: includesEdge(state.selectedEdgeIndices, edge)
        ? state.selectedEdgeIndices
        : [...state.selectedEdgeIndices, { v0: edge.v0, v1: edge.v1 }],
    })),

  clearEdgeSelection: () => set({ selectedEdgeIndices: [] }),

  selectFace: (index) => set({ selectedFaceIndices: [index] }),

  selectFaces: (indices) => set({ selectedFaceIndices: [...indices] }),

  toggleFace: (index) =>
    set((state) => ({
      selectedFaceIndices: state.selectedFaceIndices.includes(index)
        ? state.selectedFaceIndices.filter((i) => i !== index)
        : [...state.selectedFaceIndices, index],
    })),

  extendFace: (index) =>
    set((state) => ({
      selectedFaceIndices: state.selectedFaceIndices.includes(index)
        ? state.selectedFaceIndices
        : [...state.selectedFaceIndices, index],
    })),

  clearFaceSelection: () => set({ selectedFaceIndices: [] }),

  clearAllSelection: () =>
    set({
      selectedVertexIndices: [],
      selectedEdgeIndices: [],
      selectedFaceIndices: [],
    }),

  setWeightPaintTool: (tool) => set({ weightPaintTool: tool }),
  setSelectedBoneId: (boneId) => set({ selectedBoneId: boneId }),
  setBrushRadius: (radius) => set({ brushRadius: radius }),
  setBrushStrength: (strength) => set({ brushStrength: strength }),
  toggleHeatmap: () => set((state) => ({ heatmapVisible: !state.heatmapVisible })),
  setHeatmapVisible: (visible) => set({ heatmapVisible: visible }),
}))
