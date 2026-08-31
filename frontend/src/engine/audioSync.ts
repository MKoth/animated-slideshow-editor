import type { AudioClip } from './audioClip'
import { getAudioClipPlaybackDuration } from './audioClip'
import type { PrompterPart } from './prompter'

// ---------------------------------------------------------------------------
// Constants — US 40–41 solution
// ---------------------------------------------------------------------------

export const LOOKAHEAD_SECONDS = 0.1 // 100 ms lookahead
export const TICK_MS = 25 // 25 ms tick
export const DRIFT_POLL_MS = 100 // drift poll ~100 ms
export const DRIFT_THRESHOLD_MS = 15 // correct if >15 ms
export const SCRUB_SETTLE_MS = 30 // 30 ms settle after scrub stop
export const SCRUB_DEBOUNCE_MIN_MS = 50 // debounced 50–120 ms
export const SCRUB_DEBOUNCE_MAX_MS = 120
export const SCRUB_DEBOUNCE_MS = 80 // default within 50–120 window
export const SCRUB_BLIP_DURATION_MS = 120
export const MAX_DURATION_GUARD_SECONDS = 600
export const AUDIO_CACHE_MAX_ENTRIES = 12 // 8–12
export const AUDIO_CACHE_MAX_BYTES = 50 * 1024 * 1024 // ~50 MB

// ---------------------------------------------------------------------------
// Prompter highlight — start-inclusive, boundary snaps to next, gaps no highlight
// ---------------------------------------------------------------------------

export function getActivePrompterPart(
  parts: readonly PrompterPart[],
  time: number,
): PrompterPart | null {
  if (parts.length === 0) return null
  for (const part of parts) {
    // startTime <= t < endTime
    if (time >= part.startTime && time < part.endTime) return part
  }
  return null
}

export function getActivePrompterPartId(
  parts: readonly PrompterPart[],
  time: number,
): string | null {
  const active = getActivePrompterPart(parts, time)
  return active ? active.id : null
}

// ---------------------------------------------------------------------------
// Audible window — clipped at Slide duration, no bleed
// ---------------------------------------------------------------------------

export function getClippedPlaybackDuration(clip: AudioClip, slideDuration: number): number {
  const playbackDuration = getAudioClipPlaybackDuration(clip)
  const maxVisible = slideDuration - clip.timelineStart
  if (maxVisible <= 0) return 0
  return Math.min(playbackDuration, maxVisible)
}

export function getClippedEnd(clip: AudioClip, slideDuration: number): number {
  const clippedDuration = getClippedPlaybackDuration(clip, slideDuration)
  if (clippedDuration <= 0) return clip.timelineStart
  return clip.timelineStart + clippedDuration
}

export function isClipAudibleInWindow(
  clip: AudioClip,
  slideDuration: number,
  windowStart: number,
  windowEnd: number,
): boolean {
  const clippedDuration = getClippedPlaybackDuration(clip, slideDuration)
  if (clippedDuration <= 1e-9) return false
  const clipStart = clip.timelineStart
  const clipEnd = clipStart + clippedDuration
  // [clipStart, clipEnd) intersects [windowStart, windowEnd)
  return clipStart < windowEnd && clipEnd > windowStart
}

export function getAudibleClips(
  clips: readonly AudioClip[],
  slideDuration: number,
  audioTime: number,
  lookaheadSeconds: number = LOOKAHEAD_SECONDS,
): AudioClip[] {
  const windowStart = audioTime
  const windowEnd = audioTime + lookaheadSeconds
  return clips.filter((clip) => isClipAudibleInWindow(clip, slideDuration, windowStart, windowEnd))
}

// ---------------------------------------------------------------------------
// Audio time / playhead interpolation
// ---------------------------------------------------------------------------

export function computeAudioTime(
  baseAudioTime: number,
  basePerfNow: number,
  perfNow: number,
): number {
  return baseAudioTime + (perfNow - basePerfNow) / 1000
}

export function computePlayhead(
  basePlayhead: number,
  basePerfNow: number,
  perfNow: number,
  playbackSpeed = 1,
): number {
  return basePlayhead + ((perfNow - basePerfNow) / 1000) * playbackSpeed
}

export function shouldCorrectDrift(
  estimatedTime: number,
  actualAudioTime: number,
  thresholdMs: number = DRIFT_THRESHOLD_MS,
): boolean {
  return Math.abs(estimatedTime - actualAudioTime) * 1000 > thresholdMs
}

// ---------------------------------------------------------------------------
// Scrub audition — returns clip containing time (clipped at duration)
// ---------------------------------------------------------------------------

export function getScrubAuditionClip(
  clips: readonly AudioClip[],
  slideDuration: number,
  time: number,
): AudioClip | null {
  for (const clip of clips) {
    const clippedDuration = getClippedPlaybackDuration(clip, slideDuration)
    if (clippedDuration <= 1e-9) continue
    const start = clip.timelineStart
    const end = start + clippedDuration
    if (time >= start && time < end) return clip
  }
  return null
}

// ---------------------------------------------------------------------------
// Effective gain helper respecting muted/solo (Zustand-only preview)
// ---------------------------------------------------------------------------

export function isClipAudibleWithSoloMute(
  clip: AudioClip,
  mutedTracks: ReadonlySet<string>,
  soloTracks: ReadonlySet<string>,
): boolean {
  if (clip.muted) return false
  if (mutedTracks.has(clip.trackId)) return false
  if (soloTracks.size > 0 && !soloTracks.has(clip.trackId)) return false
  return true
}

export function getClipAudibleGain(
  clip: AudioClip,
  time: number,
  slideDuration: number,
  mutedTracks: ReadonlySet<string>,
  soloTracks: ReadonlySet<string>,
  trackGain = 1,
  masterGain = 1,
): number {
  if (!isClipAudibleWithSoloMute(clip, mutedTracks, soloTracks)) return 0
  const clippedDuration = getClippedPlaybackDuration(clip, slideDuration)
  if (clippedDuration <= 1e-9) return 0
  const start = clip.timelineStart
  const end = start + clippedDuration
  if (time < start || time >= end) return 0
  // reuse deterministic lane mix from audioClip.ts
  // we import audioClipEffectiveGain lazily to avoid circular
  return clip.volume * trackGain * masterGain
}
