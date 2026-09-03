import type { Engine } from '../internal'
import type { Command } from './command'
import { requireString, requireFiniteNumber } from '../guards'
import { requireAudioTrackId } from '../audioClip'
import type { AudioTrackId } from '../audioClip'
import { newAudioClipId } from '../audioClip'

export interface CreateAudioClipParameters {
  readonly id?: string
  readonly slideId: string
  readonly assetId: string
  readonly trackId: AudioTrackId
  readonly timelineStart: number
  readonly sourceStart?: number
  readonly sourceEnd: number
  readonly volume?: number
  readonly muted?: boolean
  readonly fadeIn?: number
  readonly fadeOut?: number
  readonly playbackRate?: number
  readonly pitchSemitones?: number
  readonly noiseReduction?: number
}

export interface CreateAudioClipInverse {
  readonly slideId: string
  readonly clipId: string
}

export class CreateAudioClipCommand implements Command<CreateAudioClipInverse> {
  readonly type = 'CreateAudioClip'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #id: string | undefined
  readonly #slideId: string
  readonly #assetId: string
  readonly #trackId: AudioTrackId
  readonly #timelineStart: number
  readonly #sourceStart: number
  readonly #sourceEnd: number
  readonly #volume: number
  readonly #muted: boolean
  readonly #fadeIn?: number
  readonly #fadeOut?: number
  readonly #playbackRate: number
  readonly #pitchSemitones: number
  readonly #noiseReduction: number

  constructor(input: CreateAudioClipParameters) {
    this.#id = input.id
    this.#slideId = input.slideId
    this.#assetId = input.assetId
    this.#trackId = requireAudioTrackId(input.trackId, 'AudioClip trackId')
    this.#timelineStart = input.timelineStart
    this.#sourceStart = input.sourceStart ?? 0
    this.#sourceEnd = input.sourceEnd
    this.#volume = input.volume ?? 1
    this.#muted = input.muted ?? false
    this.#fadeIn = input.fadeIn
    this.#fadeOut = input.fadeOut
    this.#playbackRate = input.playbackRate ?? 1
    this.#pitchSemitones = input.pitchSemitones ?? 0
    this.#noiseReduction = input.noiseReduction ?? 0
    this.parameters = {
      ...(input.id ? { id: input.id } : {}),
      slideId: input.slideId,
      assetId: input.assetId,
      trackId: this.#trackId,
      timelineStart: this.#timelineStart,
      sourceStart: this.#sourceStart,
      sourceEnd: this.#sourceEnd,
      volume: this.#volume,
      muted: this.#muted,
      ...(input.fadeIn !== undefined ? { fadeIn: input.fadeIn } : {}),
      ...(input.fadeOut !== undefined ? { fadeOut: input.fadeOut } : {}),
      playbackRate: this.#playbackRate,
      ...(input.pitchSemitones !== undefined ? { pitchSemitones: this.#pitchSemitones } : {}),
      ...(input.noiseReduction !== undefined ? { noiseReduction: this.#noiseReduction } : {}),
    }
  }

  validate(engine: Engine): void {
    engine.getSlide(this.#slideId)
    requireString(this.#assetId, 'AudioClip assetId')
    const embedded = engine.getEmbeddedAsset(this.#assetId)
    if (embedded) {
      if (!embedded.mimeType.startsWith('audio/')) {
        throw new Error('AudioClip asset must have audio/* mimeType')
      }
    } else {
      // Allow global audio assets via asset library sync (imported audio)
      let foundGlobal = false
      try {
        const def = engine.getAssetDefinition(this.#assetId)
        if (def) foundGlobal = true
      } catch {
        foundGlobal = false
      }
      if (!foundGlobal) {
        throw new Error(`Audio asset not found: ${this.#assetId}`)
      }
      // global audio assets are assumed valid (category='audio' or audio/* mime handled at import)
    }
    requireAudioTrackId(this.#trackId, 'AudioClip trackId')
    requireFiniteNumber(this.#timelineStart, 'AudioClip timelineStart', (v) => v >= 0)
    requireFiniteNumber(this.#sourceStart, 'AudioClip sourceStart', (v) => v >= 0)
    requireFiniteNumber(this.#sourceEnd, 'AudioClip sourceEnd', (v) => v > 0)
    if (this.#sourceEnd <= this.#sourceStart) throw new Error('AudioClip sourceEnd must be greater than sourceStart')
    requireFiniteNumber(this.#volume, 'AudioClip volume', (v) => v >= 0 && v <= 1)
    requireFiniteNumber(this.#playbackRate, 'AudioClip playbackRate', (v) => v > 0)
    requireFiniteNumber(this.#pitchSemitones, 'AudioClip pitchSemitones', (v) => v >= -12 && v <= 12)
    requireFiniteNumber(this.#noiseReduction, 'AudioClip noiseReduction', (v) => v >= 0 && v <= 1)
    if (this.#fadeIn !== undefined) requireFiniteNumber(this.#fadeIn, 'AudioClip fadeIn', (v) => v >= 0)
    if (this.#fadeOut !== undefined) requireFiniteNumber(this.#fadeOut, 'AudioClip fadeOut', (v) => v >= 0)
  }

  execute(engine: Engine): CreateAudioClipInverse {
    const clip = engine.createAudioClip(this.#slideId, {
      id: this.#id ?? newAudioClipId(),
      assetId: this.#assetId,
      trackId: this.#trackId,
      timelineStart: this.#timelineStart,
      sourceStart: this.#sourceStart,
      sourceEnd: this.#sourceEnd,
      volume: this.#volume,
      muted: this.#muted,
      fadeIn: this.#fadeIn,
      fadeOut: this.#fadeOut,
      playbackRate: this.#playbackRate,
      pitchSemitones: this.#pitchSemitones,
      noiseReduction: this.#noiseReduction,
    })
    return { slideId: this.#slideId, clipId: clip.id }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
