import { create } from 'zustand'

interface ThumbnailState {
  thumbnails: Record<string, string>
  setThumbnail: (slideId: string, dataUrl: string) => void
  remove: (slideId: string) => void
  clear: () => void
}

export const useThumbnailStore = create<ThumbnailState>()((set) => ({
  thumbnails: {},
  setThumbnail: (slideId, dataUrl) =>
    set((state) => ({ thumbnails: { ...state.thumbnails, [slideId]: dataUrl } })),
  remove: (slideId) =>
    set((state) => {
      if (!(slideId in state.thumbnails)) {
        return state
      }
      const thumbnails = { ...state.thumbnails }
      delete thumbnails[slideId]
      return { thumbnails }
    }),
  clear: () => set({ thumbnails: {} }),
}))
