import { create } from 'zustand'
import type { MeshData } from '../engine/mesh'

export interface MeshPreviewState {
  readonly previewMesh: MeshData | null
  readonly nodeId: string | null
  setPreviewMesh(nodeId: string, mesh: MeshData): void
  clearPreviewMesh(): void
}

export const useMeshPreviewStore = create<MeshPreviewState>()((set) => ({
  previewMesh: null,
  nodeId: null,

  setPreviewMesh: (nodeId, mesh) => set({ previewMesh: mesh, nodeId }),
  clearPreviewMesh: () => set({ previewMesh: null, nodeId: null }),
}))
