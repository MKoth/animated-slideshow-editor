import type { AudioTrackId } from '../engine/audioClip'

/** Keep effect sounds behind narration in both preview and exported audio. */
export const TRACK_GAINS: Record<AudioTrackId, number> = {
  voice: 1,
  sfx: 0.25,
  music: 1,
}
