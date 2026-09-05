import { create } from 'zustand'

export interface ShapePreviewState {
  readonly previewNodeId: string | null
  readonly previewShapeId: string | null
  setPreview(nodeId: string, shapeId: string | null): void
  clearPreview(): void
}

export const useShapePreviewStore = create<ShapePreviewState>()((set) => ({
  previewNodeId: null,
  previewShapeId: null,
  setPreview: (nodeId, shapeId) =>
    set({
      previewNodeId: shapeId ? nodeId : null,
      previewShapeId: shapeId,
    }),
  clearPreview: () => set({ previewNodeId: null, previewShapeId: null }),
}))
