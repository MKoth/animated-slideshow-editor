import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Spanish (foreign-language) voice for the Script batch: when set, batch
 * blocks resolved to the foreign language are cloned from this reference
 * recording (Base voice-clone) instead of the default speaker — otherwise
 * Spanish comes out in an English voice (Ryan / the standard recording).
 * English blocks are untouched. Null = no override (default speaker).
 *
 * The transcript must match the recording word-for-word; voice cloning
 * needs it. Applies to Base voice-clone models only — CustomVoice models
 * ignore reference audio (they use their fixed speakers).
 */
interface TtsForeignVoiceState {
  readonly referenceAssetId: string | null
  readonly referenceTranscript: string
  setReferenceAssetId: (assetId: string | null) => void
  setReferenceTranscript: (transcript: string) => void
}

export const useTtsForeignVoiceStore = create<TtsForeignVoiceState>()(
  persist(
    (set) => ({
      referenceAssetId: null,
      referenceTranscript: '',
      setReferenceAssetId: (referenceAssetId) => set({ referenceAssetId }),
      setReferenceTranscript: (referenceTranscript) => set({ referenceTranscript }),
    }),
    {
      name: 'tts-foreign-voice',
      partialize: (state) => ({
        referenceAssetId: state.referenceAssetId,
        referenceTranscript: state.referenceTranscript,
      }),
    },
  ),
)
