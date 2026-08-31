import { create } from 'zustand'

export interface AudioPlaybackState {
  readonly isAuditioning: boolean
  readonly auditionClipId: string | null
  setAuditioning(clipId: string | null): void
}

export const useAudioPlaybackStore = create<AudioPlaybackState>()((set) => ({
  isAuditioning: false,
  auditionClipId: null,

  setAuditioning: (clipId: string | null): void => {
    set({ isAuditioning: clipId !== null, auditionClipId: clipId })
  },
}))
