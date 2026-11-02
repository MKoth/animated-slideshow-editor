import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface PopularAudio {
  id: string
  name: string
  data: string
  mimeType: string
  duration: number
  waveformPeaks?: number[]
  sourceStart: number
  sourceEnd: number
  volume: number
  playbackRate: number
  pitchSemitones: number
  noiseReduction: number
}

interface PopularAudioState {
  recordings: PopularAudio[]
  add: (recording: PopularAudio) => void
  rename: (id: string, name: string) => void
  update: (
    id: string,
    values: Partial<
      Pick<
        PopularAudio,
        'sourceStart' | 'sourceEnd' | 'playbackRate' | 'pitchSemitones' | 'noiseReduction'
      >
    >,
  ) => void
  remove: (id: string) => void
}

export const usePopularAudioStore = create<PopularAudioState>()(
  persist(
    (set) => ({
      recordings: [],
      add: (recording) => set((state) => ({ recordings: [...state.recordings, recording] })),
      rename: (id, name) =>
        set((state) => ({
          recordings: state.recordings.map((recording) =>
            recording.id === id ? { ...recording, name } : recording,
          ),
        })),
      update: (id, values) =>
        set((state) => ({
          recordings: state.recordings.map((recording) =>
            recording.id === id ? { ...recording, ...values } : recording,
          ),
        })),
      remove: (id) =>
        set((state) => ({
          recordings: state.recordings.filter((recording) => recording.id !== id),
        })),
    }),
    { name: 'animated-slides-popular-audio' },
  ),
)
