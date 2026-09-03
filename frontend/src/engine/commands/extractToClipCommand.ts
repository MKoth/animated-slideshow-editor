import type { Engine } from '../internal'
import type { Command } from './command'
import { requireString, requireFiniteNumber } from '../guards'
import type { KeyframeTarget } from '../keyframeTarget'
import { requireKeyframeTarget } from '../keyframeTarget'
import type { ClipChannelDef } from '../clipDefinition'
import type { ExtractableKeyframe } from '../clipExtraction'
import {
  computeExtractionBounds,
  normalizeExtractable,
  channelKeyOf,
  validateNoDuplicateTimes,
} from '../clipExtraction'
import { Keyframe as KeyframeModel, newKeyframeId } from '../keyframe'


export interface ExtractToNewClipParams {
  readonly keyframes: readonly ExtractableKeyframe[]
  readonly name: string
  readonly duration?: number
  readonly category?: string
}

export interface ExtractToExistingClipParams {
  readonly keyframes: readonly ExtractableKeyframe[]
  readonly clipId: string
}

export type ExtractToClipParameters = ExtractToNewClipParams | ExtractToExistingClipParams

export interface ExtractToClipInverseExisting {
  readonly mode: 'existing'
  readonly clipId: string
  readonly snapshot: unknown // ClipJSON snapshot before extraction
  readonly afterSnapshot: unknown // ClipJSON after extraction (for redo)
}

export interface ExtractToClipInverseNew {
  readonly mode: 'new'
  readonly clipId: string
  readonly snapshot: unknown // ClipJSON snapshot of newly created clip
}

export type ExtractToClipInverse = ExtractToClipInverseExisting | ExtractToClipInverseNew

function isExistingParams(
  params: ExtractToClipParameters,
): params is ExtractToExistingClipParams {
  return 'clipId' in params
}

export class ExtractToClipCommand implements Command<ExtractToClipInverse> {
  readonly type = 'ExtractToClip'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #keyframes: readonly ExtractableKeyframe[]
  readonly #destination: { mode: 'new'; name: string; duration?: number; category?: string } | { mode: 'existing'; clipId: string }

  constructor(input: ExtractToClipParameters) {
    if (isExistingParams(input)) {
      requireString(input.clipId, 'Extract clipId')
      this.#keyframes = [...input.keyframes]
      this.#destination = { mode: 'existing', clipId: input.clipId }
      this.parameters = {
        mode: 'existing',
        clipId: input.clipId,
        keyframes: input.keyframes as unknown as Record<string, unknown>[],
      }
    } else {
      requireString(input.name, 'Extract clip name')
      if (input.duration !== undefined) {
        requireFiniteNumber(input.duration, 'Extract clip duration')
        if (input.duration < 0) throw new Error('Clip duration must be non-negative')
      }
      this.#keyframes = [...input.keyframes]
      this.#destination = {
        mode: 'new',
        name: input.name,
        duration: input.duration,
        category: input.category ?? '',
      }
      this.parameters = {
        mode: 'new',
        name: input.name,
        ...(input.duration !== undefined ? { duration: input.duration } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        keyframes: input.keyframes as unknown as Record<string, unknown>[],
      }
    }
    if (this.#keyframes.length === 0) {
      throw new Error('At least one keyframe is required for extraction')
    }
    // Validate targets
    for (const kf of this.#keyframes) {
      requireKeyframeTarget(kf.target as unknown as Record<string, unknown>)
      requireFiniteNumber(kf.time, 'Keyframe time')
      if (kf.value === undefined) throw new Error('Keyframe value is required')
    }
  }

  validate(engine: Engine): void {
    if (!engine.project) {
      throw new Error('No project exists in memory')
    }
    if (this.#destination.mode === 'existing') {
      // Will throw if not found
      engine.getClip(this.#destination.clipId)
    }
    // Validate normalization and duplicate times without mutating
    const bounds = computeExtractionBounds(this.#keyframes)
    const normalized = this.#keyframes.map((kf) => normalizeExtractable(kf, bounds))
    const groups = new Map<string, typeof normalized>()
    for (const nk of normalized) {
      const key = channelKeyOf(nk.target)
      const arr = groups.get(key)
      if (arr) arr.push(nk)
      else groups.set(key, [nk])
    }
    // For existing, check against existing clip times
    if (this.#destination.mode === 'existing') {
      const clip = engine.getClip(this.#destination.clipId)
      const existingTimesByKey = new Map<string, readonly number[]>()
      // Collect existing times per channel key
      for (const [key, arr] of groups) {
        const nkTarget = arr[0].target
        let existing: readonly number[] | undefined
        if (nkTarget.kind === 'node' && 'property' in nkTarget) {
          existing = clip.getChannelKeyframes(nkTarget.property).map((k) => k.time)
        } else if (nkTarget.kind === 'visible') {
          existing = clip.getVisibleKeyframes().map((k) => k.time)
        } else if (nkTarget.kind === 'circle') {
          existing = clip.getCircleKeyframes(nkTarget.property).map((k) => k.time)
        } else if (nkTarget.kind === 'node' && 'parameter' in nkTarget) {
          existing = clip.getMaterialChannelKeyframes(nkTarget.parameter).map((k) => k.time)
        }
        if (existing && existing.length > 0) {
          existingTimesByKey.set(key, existing)
        }
      }
      validateNoDuplicateTimes(groups, existingTimesByKey)
    } else {
      validateNoDuplicateTimes(groups)
    }
  }

  execute(engine: Engine): ExtractToClipInverse {
    const bounds = computeExtractionBounds(this.#keyframes)
    const normalized = this.#keyframes.map((kf) => normalizeExtractable(kf, bounds))

    if (this.#destination.mode === 'new') {
      const clipDuration = this.#destination.duration ?? bounds.clipDuration
      requireFiniteNumber(clipDuration, 'Clip duration')
      if (clipDuration < 0) throw new Error('Clip duration must be non-negative')

      // Group by channel
      const groups = new Map<string, typeof normalized>()
      for (const nk of normalized) {
        const key = channelKeyOf(nk.target)
        const arr = groups.get(key)
        if (arr) arr.push(nk)
        else groups.set(key, [nk])
      }

      // Build channels for uniform-six property groups
      const channels: ClipChannelDef[] = []
      for (const [, arr] of groups) {
        const sample = arr[0].target
        if (sample.kind === 'node' && 'property' in sample) {
          // Ensure not duplicate
          if (!channels.some((ch) => ch.property === sample.property)) {
            channels.push({ property: sample.property })
          }
        } else if (sample.kind === 'node' && 'parameter' in sample) {
          // Material parameter channel
          const param = sample.parameter
          if (!channels.some((ch) => ch.materialParameter === param)) {
            // For material params we need a dummy property; use first uniform prop
            channels.push({ property: 'opacity', materialParameter: param } as ClipChannelDef)
          }
        }
        // Visible and circle are implicit, no channelDef needed
      }

      const clip = engine.createClip(
        this.#destination.name,
        clipDuration,
        this.#destination.category ?? '',
        [],
        channels,
      )

      // Insert normalized keyframes
      for (const [, arr] of groups) {
        const sample = arr[0].target
        for (const nk of arr) {
          const kf = new KeyframeModel(
            newKeyframeId(),
            nk.time,
            nk.value,
            nk.interpolation,
            { time: nk.tangentIn.time, value: nk.tangentIn.value },
            { time: nk.tangentOut.time, value: nk.tangentOut.value },
          )
          // Visible tracks in clips use hold interpolation only
          if (sample.kind === 'visible' && kf.interpolation !== 'hold') {
            kf.interpolation = 'hold'
          }
          if (sample.kind === 'node' && 'property' in sample) {
            clip.addChannelKeyframe(sample.property, kf)
            engine.emitKeyframeAdded({ kind: 'clip', clipId: clip.id, channel: sample.property }, kf.id)
          } else if (sample.kind === 'visible') {
            clip.addVisibleKeyframe(kf)
            engine.emitKeyframeAdded({ kind: 'visible', nodeId: 'clip-' + clip.id } as unknown as KeyframeTarget, kf.id)
            // Also emit clip-specific event for UI refresh
            engine.emitClipChanged(clip.id)
          } else if (sample.kind === 'circle') {
            clip.addCircleKeyframe(sample.property, kf)
            engine.emitKeyframeAdded({ kind: 'circle', nodeId: 'clip-' + clip.id, property: sample.property } as unknown as KeyframeTarget, kf.id)
            engine.emitClipChanged(clip.id)
          } else if (sample.kind === 'node' && 'parameter' in sample) {
            const param = (sample as { parameter: string }).parameter
            clip.addMaterialChannelKeyframe(param, kf)
            engine.emitKeyframeAdded({ kind: 'clip', clipId: clip.id, channel: param } as unknown as KeyframeTarget, kf.id)
          } else if (sample.kind === 'dataLabel') {
            // Not supported in clips; skip
          } else if (sample.kind === 'table') {
            // Not supported; skip
          }
        }
      }

      const snapshot = clip.toJSON()
      return { mode: 'new', clipId: clip.id, snapshot }
    } else {
      const clip = engine.getClip(this.#destination.clipId)
      const snapshot = clip.toJSON()
      const groups = new Map<string, typeof normalized>()
      for (const nk of normalized) {
        const key = channelKeyOf(nk.target)
        const arr = groups.get(key)
        if (arr) arr.push(nk)
        else groups.set(key, [nk])
      }

      // Ensure channels exist for property groups
      for (const [, arr] of groups) {
        const sample = arr[0].target
        if (sample.kind === 'node' && 'property' in sample) {
          if (!clip.hasChannel(sample.property)) {
            engine.addClipChannel(clip.id, { property: sample.property })
          }
        } else if (sample.kind === 'node' && 'parameter' in sample) {
          const param = (sample as { parameter: string }).parameter
          if (!clip.hasMaterialChannel(param)) {
            engine.addClipChannel(clip.id, { property: 'opacity', materialParameter: param } as ClipChannelDef)
          }
        }
      }

      // Insert keyframes
      for (const [, arr] of groups) {
        const sample = arr[0].target
        for (const nk of arr) {
          const kf = new KeyframeModel(
            newKeyframeId(),
            nk.time,
            nk.value,
            nk.interpolation,
            { time: nk.tangentIn.time, value: nk.tangentIn.value },
            { time: nk.tangentOut.time, value: nk.tangentOut.value },
          )
          if (sample.kind === 'visible' && kf.interpolation !== 'hold') {
            kf.interpolation = 'hold'
          }
          if (sample.kind === 'node' && 'property' in sample) {
            // Use direct clip insertion to preserve full data, but emit via manager
            clip.addChannelKeyframe(sample.property, kf)
            engine.emitKeyframeAdded({ kind: 'clip', clipId: clip.id, channel: sample.property }, kf.id)
          } else if (sample.kind === 'visible') {
            clip.addVisibleKeyframe(kf)
            engine.emitKeyframeAdded({ kind: 'visible', nodeId: 'clip-' + clip.id } as unknown as KeyframeTarget, kf.id)
            engine.emitClipChanged(clip.id)
          } else if (sample.kind === 'circle') {
            clip.addCircleKeyframe(sample.property, kf)
            engine.emitKeyframeAdded({ kind: 'circle', nodeId: 'clip-' + clip.id, property: sample.property } as unknown as KeyframeTarget, kf.id)
            engine.emitClipChanged(clip.id)
          } else if (sample.kind === 'node' && 'parameter' in sample) {
            const param2 = (sample as { parameter: string }).parameter
            clip.addMaterialChannelKeyframe(param2, kf)
            engine.emitKeyframeAdded({ kind: 'clip', clipId: clip.id, channel: param2 } as unknown as KeyframeTarget, kf.id)
          }
        }
      }

      const afterSnapshot = clip.toJSON()
      return { mode: 'existing', clipId: clip.id, snapshot, afterSnapshot }
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
