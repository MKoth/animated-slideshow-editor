import { requireFiniteNumber, requireString } from './guards'
import { newId } from './ids'
import type { AudioClipJSON } from './json'

export const AUDIO_TRACK_IDS = ['voice', 'sfx', 'music'] as const
export type AudioTrackId = (typeof AUDIO_TRACK_IDS)[number]

export function isAudioTrackId(value: unknown): value is AudioTrackId {
  return typeof value === 'string' && (AUDIO_TRACK_IDS as readonly string[]).includes(value)
}

export function requireAudioTrackId(value: unknown, what: string): AudioTrackId {
  if (!isAudioTrackId(value)) {
    throw new Error(`${what} must be one of ${AUDIO_TRACK_IDS.join(', ')}`)
  }
  return value
}

export interface AudioClip {
  readonly id: string
  readonly assetId: string
  trackId: AudioTrackId
  timelineStart: number
  sourceStart: number
  sourceEnd: number
  volume: number
  muted: boolean
  fadeIn?: number
  fadeOut?: number
  playbackRate: number
}

export function newAudioClipId(): string {
  return newId('audio-clip')
}

export function createAudioClip(input: {
  id?: string
  assetId: string
  trackId: AudioTrackId
  timelineStart: number
  sourceStart?: number
  sourceEnd: number
  volume?: number
  muted?: boolean
  fadeIn?: number
  fadeOut?: number
  playbackRate?: number
}): AudioClip {
  const id = input.id ?? newAudioClipId()
  requireString(id, 'AudioClip id')
  requireString(input.assetId, 'AudioClip assetId')
  requireAudioTrackId(input.trackId, 'AudioClip trackId')
  const clip: AudioClip = {
    id,
    assetId: input.assetId,
    trackId: input.trackId,
    timelineStart: requireFiniteNumber(input.timelineStart, 'AudioClip timelineStart', (v) => v >= 0),
    sourceStart: requireFiniteNumber(input.sourceStart ?? 0, 'AudioClip sourceStart', (v) => v >= 0),
    sourceEnd: requireFiniteNumber(input.sourceEnd, 'AudioClip sourceEnd', (v) => v > 0),
    volume: input.volume !== undefined ? requireFiniteNumber(input.volume, 'AudioClip volume', (v) => v >= 0 && v <= 1) : 1,
    muted: input.muted ?? false,
    playbackRate: input.playbackRate !== undefined ? requireFiniteNumber(input.playbackRate, 'AudioClip playbackRate', (v) => v > 0) : 1,
  }
  if (input.fadeIn !== undefined) {
    clip.fadeIn = requireFiniteNumber(input.fadeIn, 'AudioClip fadeIn', (v) => v >= 0)
  }
  if (input.fadeOut !== undefined) {
    clip.fadeOut = requireFiniteNumber(input.fadeOut, 'AudioClip fadeOut', (v) => v >= 0)
  }
  if (clip.sourceEnd <= clip.sourceStart) {
    throw new Error('AudioClip sourceEnd must be greater than sourceStart')
  }
  return clip
}

export function audioClipToJSON(clip: AudioClip): AudioClipJSON {
  return {
    id: clip.id,
    assetId: clip.assetId,
    trackId: clip.trackId,
    timelineStart: clip.timelineStart,
    sourceStart: clip.sourceStart,
    sourceEnd: clip.sourceEnd,
    volume: clip.volume,
    muted: clip.muted,
    ...(clip.fadeIn !== undefined ? { fadeIn: clip.fadeIn } : {}),
    ...(clip.fadeOut !== undefined ? { fadeOut: clip.fadeOut } : {}),
    playbackRate: clip.playbackRate,
  }
}

export function audioClipFromJSON(json: AudioClipJSON): AudioClip {
  return createAudioClip({
    id: requireString(json.id, 'AudioClip id'),
    assetId: requireString(json.assetId, 'AudioClip assetId'),
    trackId: requireAudioTrackId(json.trackId, 'AudioClip trackId'),
    timelineStart: json.timelineStart,
    sourceStart: json.sourceStart,
    sourceEnd: json.sourceEnd,
    volume: json.volume,
    muted: json.muted,
    fadeIn: json.fadeIn,
    fadeOut: json.fadeOut,
    playbackRate: json.playbackRate ?? 1,
  })
}

export function validateAudioClipJSON(errors: string[], value: unknown, where: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push(`${where} must be an object`)
    return
  }
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string' || v.id === '') errors.push(`${where} id must be a non-empty string`)
  if (typeof v.assetId !== 'string' || v.assetId === '') errors.push(`${where} assetId must be a non-empty string`)
  if (!isAudioTrackId(v.trackId)) errors.push(`${where} trackId must be one of ${AUDIO_TRACK_IDS.join(', ')}`)
  if (typeof v.timelineStart !== 'number' || !Number.isFinite(v.timelineStart) || v.timelineStart < 0) errors.push(`${where} timelineStart must be a non-negative finite number`)
  if (typeof v.sourceStart !== 'number' || !Number.isFinite(v.sourceStart) || v.sourceStart < 0) errors.push(`${where} sourceStart must be a non-negative finite number`)
  if (typeof v.sourceEnd !== 'number' || !Number.isFinite(v.sourceEnd) || v.sourceEnd <= 0) errors.push(`${where} sourceEnd must be a positive finite number`)
  if (typeof v.volume !== 'number' || !Number.isFinite(v.volume) || v.volume < 0 || v.volume > 1) errors.push(`${where} volume must be between 0 and 1`)
  if (typeof v.muted !== 'boolean') errors.push(`${where} muted must be a boolean`)
  if (v.fadeIn !== undefined && (typeof v.fadeIn !== 'number' || !Number.isFinite(v.fadeIn) || v.fadeIn < 0)) errors.push(`${where} fadeIn must be a non-negative finite number`)
  if (v.fadeOut !== undefined && (typeof v.fadeOut !== 'number' || !Number.isFinite(v.fadeOut) || v.fadeOut < 0)) errors.push(`${where} fadeOut must be a non-negative finite number`)
  if (v.playbackRate !== undefined && (typeof v.playbackRate !== 'number' || !Number.isFinite(v.playbackRate) || v.playbackRate <= 0)) errors.push(`${where} playbackRate must be a positive finite number`)
  if (typeof v.sourceStart === 'number' && typeof v.sourceEnd === 'number' && v.sourceEnd <= v.sourceStart) errors.push(`${where} sourceEnd must be greater than sourceStart`)
}
