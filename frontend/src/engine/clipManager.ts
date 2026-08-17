import type { EventBus } from './events'
import type { AnimationProperty } from './animationProperties'
import type { Keyframe } from './keyframe'
import { Keyframe as KeyframeModel, newKeyframeId } from './keyframe'
import type { InterpolationType, KeyframeTangent } from './keyframe'
import { requireKeyframeInterpolation, requireKeyframeTangent } from './keyframe'
import { requireFiniteNumber } from './guards'
import type { ClipParam } from './clipDefinition'
import { ClipDefinition, newClipId } from './clipDefinition'
import type { ClipChannelDef } from './clipDefinition'

export interface ClipChannelKeyframeMove {
  readonly keyframeId: string
  readonly newTime: number
}

export interface ClipChannelKeyframeMoveResult {
  readonly keyframeId: string
  readonly oldTime: number
}

export interface ClipChannelKeyframeTangents {
  readonly tangentIn: KeyframeTangent
  readonly tangentOut: KeyframeTangent
}

interface ValidatedClipMove {
  readonly keyframeId: string
  readonly newTime: number
  readonly oldTime: number
}

/** A clipboard payload for clip channel keyframes. */
export interface ClipPastePayloadKeyframe {
  readonly time: number
  readonly value: unknown
  readonly interpolation: InterpolationType
  readonly tangentIn: KeyframeTangent
  readonly tangentOut: KeyframeTangent
}

export interface ClipPastePayload {
  readonly keyframes: readonly ClipPastePayloadKeyframe[]
}

export class ClipManager {
  readonly #bus: EventBus
  readonly #clips = new Map<string, ClipDefinition>()

  constructor(bus: EventBus) {
    this.#bus = bus
  }

  get clips(): readonly ClipDefinition[] {
    return [...this.#clips.values()]
  }

  getClip(clipId: string): ClipDefinition {
    const clip = this.#clips.get(clipId)
    if (!clip) {
      throw new Error(`Clip not found: ${clipId}`)
    }
    return clip
  }

  createClip(
    name: string,
    duration: number,
    category: string,
    params: ClipParam[],
    channels: ClipChannelDef[],
  ): ClipDefinition {
    const id = newClipId()
    const clip = new ClipDefinition(id, name, duration, category, params, channels)
    this.#clips.set(id, clip)
    this.#bus.emit({ type: 'ClipCreated', clipId: id })
    return clip
  }

  deleteClip(clipId: string): ClipDefinition {
    const clip = this.getClip(clipId)
    this.#clips.delete(clipId)
    this.#bus.emit({ type: 'ClipRemoved', clipId })
    return clip
  }

  renameClip(clipId: string, name: string): void {
    const clip = this.getClip(clipId)
    clip.name = name
    this.#bus.emit({ type: 'ClipRenamed', clipId })
  }

  duplicateClip(clipId: string): ClipDefinition {
    const source = this.getClip(clipId)
    const id = newClipId()
    // Build a JSON with new IDs and parse it
    const sourceJson = source.toJSON()
    // Create a mutable copy of the JSON with new id
    const jsonCopy = { ...sourceJson, id }
    // Regenerate keyframe IDs in the JSON
    if (jsonCopy.channelAnimations) {
      for (const channelAnim of Object.values(jsonCopy.channelAnimations)) {
        if (channelAnim && Array.isArray(channelAnim.keyframes)) {
          for (const kf of channelAnim.keyframes) {
            ;(kf as { id: string }).id = newKeyframeId()
          }
        }
      }
    }
    const clipCopy = ClipDefinition.fromJSON(jsonCopy)
    this.#clips.set(id, clipCopy)
    this.#bus.emit({ type: 'ClipDuplicated', clipId: id })
    return clipCopy
  }

  setDuration(clipId: string, duration: number): void {
    const clip = this.getClip(clipId)
    requireFiniteNumber(duration, 'Clip duration')
    if (duration < 0) {
      throw new Error('Clip duration must be non-negative')
    }
    clip.duration = duration
    this.#bus.emit({ type: 'ClipDurationChanged', clipId })
  }

  setCategory(clipId: string, category: string): void {
    const clip = this.getClip(clipId)
    clip.category = category
    this.#bus.emit({ type: 'ClipCategoryChanged', clipId })
  }

  setParamDefault(clipId: string, paramKey: string, defaultValue: number): void {
    const clip = this.getClip(clipId)
    const param = clip.getParam(paramKey)
    if (!param) {
      throw new Error(`Clip param not found: ${paramKey}`)
    }
    // Mutate param default via clone
    const params = [...clip.params]
    const index = params.findIndex((p) => p.key === paramKey)
    if (index >= 0) {
      params[index] = { ...params[index]!, default: defaultValue }
    }
    // Update via the clip's internal state - we need a setter on ClipDefinition
    clip.setParamDefault(paramKey, defaultValue)
    this.#bus.emit({ type: 'ClipParamDefaultChanged', clipId, paramKey })
  }

  setChannelParamLink(clipId: string, channel: AnimationProperty, paramKey: string | null): void {
    const clip = this.getClip(clipId)
    const channelDef = clip.getChannel(channel)
    if (!channelDef) {
      throw new Error(`Clip channel not found: ${channel}`)
    }
    clip.setChannelParamLink(channel, paramKey)
    this.#bus.emit({ type: 'ClipChannelLinkChanged', clipId, channel })
  }

  /** Check if a clip is referenced by any slide node. */
  findBlockingReferences(
    clipId: string,
    slideScenes: ReadonlyArray<{ nodes: ReadonlyArray<{ clipReference?: string }> }>,
  ): string[] {
    const blockingNodeIds: string[] = []
    for (const scene of slideScenes) {
      for (const node of scene.nodes) {
        if (node.clipReference === clipId) {
          blockingNodeIds.push(node.clipReference)
        }
      }
    }
    return blockingNodeIds
  }

  // --- Clip channel keyframe operations (delegate to ClipDefinition) ---

  getChannelKeyframes(clipId: string, channel: AnimationProperty): readonly Keyframe[] {
    return this.getClip(clipId).getChannelKeyframes(channel)
  }

  getChannelKeyframe(
    clipId: string,
    channel: AnimationProperty,
    keyframeId: string,
  ): Keyframe | undefined {
    return this.getClip(clipId).getChannelKeyframe(channel, keyframeId)
  }

  addChannelKeyframe(
    clipId: string,
    channel: AnimationProperty,
    time: number,
    value: number,
  ): Keyframe {
    const clip = this.getClip(clipId)
    const boundedTime = requireClipKeyframeTime(time)
    const boundedValue = requireClipKeyframeValue(value)
    this.#assertTimeFree(clip, channel, boundedTime, [], [])
    const keyframe = new KeyframeModel(
      newKeyframeId(),
      boundedTime,
      boundedValue,
      previousInterpolation(clip.getChannelKeyframes(channel), boundedTime),
    )
    clip.addChannelKeyframe(channel, keyframe)
    const target = { kind: 'clip' as const, clipId, channel }
    this.#bus.emit({ type: 'KeyframeAdded', target, keyframeId: keyframe.id })
    return keyframe
  }

  deleteChannelKeyframes(
    clipId: string,
    channel: AnimationProperty,
    keyframeIds: readonly string[],
  ): Keyframe[] {
    if (keyframeIds.length === 0) {
      throw new Error('At least one keyframe id is required')
    }
    const clip = this.getClip(clipId)
    const seen = new Set<string>()
    const removed: Keyframe[] = []
    for (const keyframeId of keyframeIds) {
      if (seen.has(keyframeId)) {
        throw new Error(`Duplicate keyframe id in batch: ${keyframeId}`)
      }
      seen.add(keyframeId)
      const keyframe = clip.getChannelKeyframe(channel, keyframeId)
      if (!keyframe) {
        throw new Error(`Keyframe not found: ${keyframeId} on channel ${channel}`)
      }
      removed.push(keyframe)
    }
    for (const keyframe of removed) {
      clip.removeChannelKeyframe(channel, keyframe.id)
    }
    for (const keyframe of removed) {
      const target = { kind: 'clip' as const, clipId, channel }
      this.#bus.emit({ type: 'KeyframeRemoved', target, keyframeId: keyframe.id })
    }
    return removed
  }

  moveChannelKeyframes(
    clipId: string,
    channel: AnimationProperty,
    moves: readonly ClipChannelKeyframeMove[],
  ): ClipChannelKeyframeMoveResult[] {
    const validated = this.#validateMoves(clipId, channel, moves)
    const clip = this.getClip(clipId)
    for (const move of validated) {
      const keyframe = clip.getChannelKeyframe(channel, move.keyframeId)
      if (!keyframe) throw new Error(`Keyframe not found: ${move.keyframeId}`)
      clip.removeChannelKeyframe(channel, move.keyframeId)
      keyframe.time = move.newTime
      clip.addChannelKeyframe(channel, keyframe)
    }
    for (const move of validated) {
      const target = { kind: 'clip' as const, clipId, channel }
      this.#bus.emit({ type: 'KeyframeMoved', target, keyframeId: move.keyframeId })
    }
    return validated.map((m) => ({ keyframeId: m.keyframeId, oldTime: m.oldTime }))
  }

  scaleChannelKeyframes(
    clipId: string,
    channel: AnimationProperty,
    keyframeIds: readonly string[],
    pivot: number,
    factor: number,
  ): ClipChannelKeyframeMoveResult[] {
    if (keyframeIds.length === 0) {
      throw new Error('At least one keyframe id is required')
    }
    requireClipKeyframeTime(pivot)
    requireScaleFactor(factor)
    const clip = this.getClip(clipId)
    const moves: ClipChannelKeyframeMove[] = []
    const seen = new Set<string>()
    for (const keyframeId of keyframeIds) {
      if (seen.has(keyframeId)) {
        throw new Error(`Duplicate keyframe id in batch: ${keyframeId}`)
      }
      seen.add(keyframeId)
      const keyframe = clip.getChannelKeyframe(channel, keyframeId)
      if (!keyframe) throw new Error(`Keyframe not found: ${keyframeId}`)
      moves.push({ keyframeId, newTime: pivot + (keyframe.time - pivot) * factor })
    }
    const validated = this.#validateMoves(clipId, channel, moves)
    for (const move of validated) {
      const keyframe = clip.getChannelKeyframe(channel, move.keyframeId)
      if (!keyframe) throw new Error(`Keyframe not found: ${move.keyframeId}`)
      clip.removeChannelKeyframe(channel, move.keyframeId)
      keyframe.time = move.newTime
      clip.addChannelKeyframe(channel, keyframe)
    }
    for (const move of validated) {
      const target = { kind: 'clip' as const, clipId, channel }
      this.#bus.emit({ type: 'KeyframeMoved', target, keyframeId: move.keyframeId })
    }
    return validated.map((m) => ({ keyframeId: m.keyframeId, oldTime: m.oldTime }))
  }

  setChannelKeyframeValue(
    clipId: string,
    channel: AnimationProperty,
    keyframeId: string,
    value: number,
  ): number {
    const clip = this.getClip(clipId)
    const boundedValue = requireClipKeyframeValue(value)
    const keyframe = clip.getChannelKeyframe(channel, keyframeId)
    if (!keyframe) throw new Error(`Keyframe not found: ${keyframeId}`)
    const oldValue = keyframe.value as number
    keyframe.value = boundedValue
    const target = { kind: 'clip' as const, clipId, channel }
    this.#bus.emit({ type: 'KeyframeValueChanged', target, keyframeId })
    return oldValue
  }

  setChannelKeyframeInterpolation(
    clipId: string,
    channel: AnimationProperty,
    keyframeId: string,
    interpolation: unknown,
  ): InterpolationType {
    const clip = this.getClip(clipId)
    const bounded = requireKeyframeInterpolation(interpolation)
    const keyframe = clip.getChannelKeyframe(channel, keyframeId)
    if (!keyframe) throw new Error(`Keyframe not found: ${keyframeId}`)
    const oldInterpolation = keyframe.interpolation
    keyframe.interpolation = bounded
    const target = { kind: 'clip' as const, clipId, channel }
    this.#bus.emit({ type: 'KeyframeInterpolationChanged', target, keyframeId })
    return oldInterpolation
  }

  setChannelKeyframeTangents(
    clipId: string,
    channel: AnimationProperty,
    keyframeId: string,
    tangentIn: KeyframeTangent,
    tangentOut: KeyframeTangent,
  ): ClipChannelKeyframeTangents {
    const clip = this.getClip(clipId)
    const boundedIn = requireKeyframeTangent(tangentIn, 'Clip keyframe tangent in')
    const boundedOut = requireKeyframeTangent(tangentOut, 'Clip keyframe tangent out')
    const keyframe = clip.getChannelKeyframe(channel, keyframeId)
    if (!keyframe) throw new Error(`Keyframe not found: ${keyframeId}`)
    const old = {
      tangentIn: keyframe.tangentIn,
      tangentOut: keyframe.tangentOut,
    }
    keyframe.tangentIn = boundedIn
    keyframe.tangentOut = boundedOut
    const target = { kind: 'clip' as const, clipId, channel }
    this.#bus.emit({ type: 'KeyframeTangentsChanged', target, keyframeId })
    return old
  }

  pasteChannelKeyframes(
    clipId: string,
    channel: AnimationProperty,
    payload: ClipPastePayload,
    atTime: number,
  ): Keyframe[] {
    if (payload.keyframes.length === 0) {
      throw new Error('At least one keyframe is required to paste')
    }
    const clip = this.getClip(clipId)
    const boundedAtTime = requireClipKeyframeTime(atTime)
    const pending: { time: number; payload: ClipPastePayloadKeyframe }[] = []
    for (const entry of payload.keyframes) {
      const relative = requireFiniteNumber(entry.time, 'Paste payload time')
      if (relative < 0) {
        throw new Error('Paste payload time must be non-negative')
      }
      const time = Math.min(Math.max(boundedAtTime + relative, 0), 1)
      pending.push({ time, payload: entry })
    }
    this.#assertPasteFree(
      clip,
      channel,
      pending.map((e) => e.time),
    )
    const created: Keyframe[] = []
    for (const entry of pending) {
      const value = requireClipKeyframeValue(entry.payload.value as number)
      const keyframe = new KeyframeModel(
        newKeyframeId(),
        entry.time,
        value,
        requireKeyframeInterpolation(entry.payload.interpolation),
        requireKeyframeTangent(entry.payload.tangentIn, 'Keyframe tangent in'),
        requireKeyframeTangent(entry.payload.tangentOut, 'Keyframe tangent out'),
      )
      clip.addChannelKeyframe(channel, keyframe)
      created.push(keyframe)
    }
    for (const keyframe of created) {
      const target = { kind: 'clip' as const, clipId, channel }
      this.#bus.emit({ type: 'KeyframeAdded', target, keyframeId: keyframe.id })
    }
    return created
  }

  duplicateChannelKeyframes(
    clipId: string,
    channel: AnimationProperty,
    keyframeIds: readonly string[],
  ): Keyframe[] {
    if (keyframeIds.length === 0) {
      throw new Error('At least one keyframe id is required')
    }
    const clip = this.getClip(clipId)
    const seen = new Set<string>()
    const sources: Keyframe[] = []
    for (const keyframeId of keyframeIds) {
      if (seen.has(keyframeId)) {
        throw new Error(`Duplicate keyframe id in batch: ${keyframeId}`)
      }
      seen.add(keyframeId)
      const kf = clip.getChannelKeyframe(channel, keyframeId)
      if (!kf) throw new Error(`Keyframe not found: ${keyframeId}`)
      sources.push(kf)
    }
    const firstTime = Math.min(...sources.map((kf) => kf.time))
    const lastTime = Math.max(...sources.map((kf) => kf.time))
    const frameStep = 1 / 60
    const moves: ClipChannelKeyframeMove[] = sources.map((kf) => ({
      keyframeId: kf.id,
      newTime: Math.min(1, lastTime + frameStep + (kf.time - firstTime)),
    }))
    this.#validateMoves(clipId, channel, moves)
    const created: Keyframe[] = []
    for (const move of moves) {
      const source = clip.getChannelKeyframe(channel, move.keyframeId)
      if (!source) throw new Error(`Keyframe not found: ${move.keyframeId}`)
      const keyframe = new KeyframeModel(
        newKeyframeId(),
        move.newTime,
        source.value,
        source.interpolation,
        { time: source.tangentIn.time, value: source.tangentIn.value },
        { time: source.tangentOut.time, value: source.tangentOut.value },
      )
      clip.addChannelKeyframe(channel, keyframe)
      created.push(keyframe)
    }
    for (const keyframe of created) {
      const target = { kind: 'clip' as const, clipId, channel }
      this.#bus.emit({ type: 'KeyframeAdded', target, keyframeId: keyframe.id })
    }
    return created
  }

  #validateMoves(
    clipId: string,
    channel: AnimationProperty,
    moves: readonly ClipChannelKeyframeMove[],
  ): ValidatedClipMove[] {
    if (moves.length === 0) {
      throw new Error('At least one keyframe move is required')
    }
    const clip = this.getClip(clipId)
    const seen = new Set<string>()
    const validated: ValidatedClipMove[] = []
    for (const move of moves) {
      const boundedTime = requireClipKeyframeTime(move.newTime)
      if (seen.has(move.keyframeId)) {
        throw new Error(`Duplicate keyframe move: ${move.keyframeId}`)
      }
      seen.add(move.keyframeId)
      const keyframe = clip.getChannelKeyframe(channel, move.keyframeId)
      if (!keyframe) throw new Error(`Keyframe not found: ${move.keyframeId}`)
      this.#assertTimeFree(
        clip,
        channel,
        boundedTime,
        moves.map((m) => m.keyframeId),
        [move.keyframeId],
      )
      for (const other of moves) {
        if (other !== move && other.newTime === boundedTime) {
          throw new Error(`Two keyframes cannot move to the same time ${boundedTime}`)
        }
      }
      validated.push({ keyframeId: move.keyframeId, newTime: boundedTime, oldTime: keyframe.time })
    }
    return validated
  }

  #assertTimeFree(
    clip: ClipDefinition,
    channel: AnimationProperty,
    time: number,
    batchKeyframeIds: readonly string[],
    excludedKeyframeIds: readonly string[],
  ): void {
    const vacating = new Set(batchKeyframeIds)
    const excluded = new Set(excludedKeyframeIds)
    const occupied = clip
      .getChannelKeyframes(channel)
      .some((kf) => kf.time === time && !vacating.has(kf.id) && !excluded.has(kf.id))
    if (occupied) {
      throw new Error(`Clip already has a keyframe at time ${time} on channel ${channel}`)
    }
  }

  #assertPasteFree(
    clip: ClipDefinition,
    channel: AnimationProperty,
    times: readonly number[],
  ): void {
    const occupied = clip.getChannelKeyframes(channel).map((kf) => kf.time)
    for (const time of times) {
      if (occupied.includes(time)) {
        throw new Error(`Clip already has a keyframe at time ${time} on channel ${channel}`)
      }
    }
    for (let i = 0; i < times.length; i++) {
      for (let j = i + 1; j < times.length; j++) {
        if (times[i] === times[j]) {
          throw new Error(`Two pasted keyframes cannot land at the same time ${times[i]}`)
        }
      }
    }
  }

  importClip(clip: ClipDefinition): void {
    this.#clips.set(clip.id, clip)
  }
}

function requireClipKeyframeTime(time: unknown, what = 'Clip keyframe time'): number {
  const bounded = requireFiniteNumber(time, what)
  if (bounded < 0 || bounded > 1) {
    throw new Error(`${what} must be within [0, 1]`)
  }
  return bounded
}

function requireClipKeyframeValue(value: unknown, what = 'Clip keyframe value'): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${what} must be a finite number`)
  }
  return value
}

function requireScaleFactor(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Scale factor must be a non-negative finite number')
  }
  return value
}

function previousInterpolation(
  keyframes: readonly Keyframe[],
  time: number,
): InterpolationType | undefined {
  let previous: Keyframe | undefined
  for (const kf of keyframes) {
    if (kf.time > time) break
    previous = kf
  }
  return previous?.interpolation
}
