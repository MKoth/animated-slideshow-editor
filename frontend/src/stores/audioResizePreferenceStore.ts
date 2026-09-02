import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AudioTrackId } from '../engine/audioClip'

export type AudioResizeMode = 'trim' | 'stretch'

export interface AudioResizePreferenceState {
  readonly preferences: Record<AudioTrackId, AudioResizeMode | null>
  getPreference(trackId: AudioTrackId): AudioResizeMode | null
  setPreference(trackId: AudioTrackId, mode: AudioResizeMode): void
  clearPreference(trackId: AudioTrackId): void
  clearAll(): void
}

export const useAudioResizePreferenceStore = create<AudioResizePreferenceState>()(
  persist(
    (set, get) => ({
      preferences: {
        voice: null,
        sfx: null,
        music: null,
      },

      getPreference: (trackId: AudioTrackId): AudioResizeMode | null => {
        return get().preferences[trackId] ?? null
      },

      setPreference: (trackId: AudioTrackId, mode: AudioResizeMode): void => {
        set((state) => ({
          preferences: { ...state.preferences, [trackId]: mode },
        }))
      },

      clearPreference: (trackId: AudioTrackId): void => {
        set((state) => ({
          preferences: { ...state.preferences, [trackId]: null },
        }))
      },

      clearAll: (): void => {
        set({
          preferences: {
            voice: null,
            sfx: null,
            music: null,
          },
        })
      },
    }),
    {
      name: 'audio-resize-preference',
      partialize: (state) => ({ preferences: state.preferences }),
    },
  ),
)
