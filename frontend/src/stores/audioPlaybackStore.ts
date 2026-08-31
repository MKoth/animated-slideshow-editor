import { create } from 'zustand'
import type { AudioTrackId } from '../engine/audioClip'

export interface AudioPlaybackState {
  readonly isAuditioning: boolean
  readonly auditionClipId: string | null
  /** Lane mute/solo preview — Zustand-only, never persisted or in undo */
  readonly mutedTracks: ReadonlySet<AudioTrackId>
  readonly soloTracks: ReadonlySet<AudioTrackId>
  setAuditioning(clipId: string | null): void
  setMuted(trackId: AudioTrackId, muted: boolean): void
  setSolo(trackId: AudioTrackId, solo: boolean): void
  toggleMute(trackId: AudioTrackId): void
  toggleSolo(trackId: AudioTrackId): void
  clearMuteSolo(): void
}

export const useAudioPlaybackStore = create<AudioPlaybackState>()((set, get) => ({
  isAuditioning: false,
  auditionClipId: null,
  mutedTracks: new Set<AudioTrackId>(),
  soloTracks: new Set<AudioTrackId>(),

  setAuditioning: (clipId: string | null): void => {
    set({ isAuditioning: clipId !== null, auditionClipId: clipId })
  },

  setMuted: (trackId: AudioTrackId, muted: boolean): void => {
    const next = new Set(get().mutedTracks)
    if (muted) next.add(trackId)
    else next.delete(trackId)
    set({ mutedTracks: next })
  },

  setSolo: (trackId: AudioTrackId, solo: boolean): void => {
    const next = new Set(get().soloTracks)
    if (solo) next.add(trackId)
    else next.delete(trackId)
    set({ soloTracks: next })
  },

  toggleMute: (trackId: AudioTrackId): void => {
    const next = new Set(get().mutedTracks)
    if (next.has(trackId)) next.delete(trackId)
    else next.add(trackId)
    set({ mutedTracks: next })
  },

  toggleSolo: (trackId: AudioTrackId): void => {
    const next = new Set(get().soloTracks)
    if (next.has(trackId)) next.delete(trackId)
    else next.add(trackId)
    set({ soloTracks: next })
  },

  clearMuteSolo: (): void => {
    set({ mutedTracks: new Set<AudioTrackId>(), soloTracks: new Set<AudioTrackId>() })
  },
}))
