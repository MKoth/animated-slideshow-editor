import type { AnimationProperty } from './animationProperties'
import type { Keyframe } from './keyframe'
import type { ClipChannelJSON, ClipJSON } from './json'
import { newId } from './ids'
import { Keyframe as KeyframeModel, newKeyframeId, ZERO_TANGENT } from './keyframe'
import { requireKeyframeInterpolation, requireKeyframeTangent } from './keyframe'
import { isRecord, requireFiniteNumber, requireString } from './guards'
import { requireAnimationProperty } from './animationProperties'

/** The uniform-six channels a clip can animate. */
export type ClipChannel = AnimationProperty

export const CLIP_CHANNELS: readonly ClipChannel[] = [
  'positionX',
  'positionY',
  'rotation',
  'scaleX',
  'scaleY',
  'opacity',
]

/** A parameter that a clip channel can be linked to. */
export interface ClipParam {
  readonly key: string
  readonly label: string
  readonly kind: string
  readonly default: number
}

/** How a linked channel combines with the base value. */
export type ClipLinkMode = 'gain' | 'offset'

/** A channel in a clip definition. */
export interface ClipChannelDef {
  /** The uniform-six property this channel animates. */
  readonly property: ClipChannel
  /** Optional param key: if present, the channel is linked to a param. */
  readonly paramKey?: string
  /** How the linked channel combines with the base: 'gain' (multiply) or 'offset' (add). Default: 'gain'. */
  readonly linkMode?: ClipLinkMode
}

export class ClipChannelAnimation {
  readonly #keyframes: Keyframe[] = []

  get length(): number {
    return this.#keyframes.length
  }

  keyframes(): readonly Keyframe[] {
    return this.#keyframes
  }

  getKeyframe(keyframeId: string): Keyframe | undefined {
    return this.#keyframes.find((kf) => kf.id === keyframeId)
  }

  add(keyframe: Keyframe): void {
    insertSortedKeyframes(this.#keyframes, keyframe)
  }

  remove(keyframeId: string): Keyframe | undefined {
    const index = this.#keyframes.findIndex((kf) => kf.id === keyframeId)
    if (index === -1) return undefined
    const [removed] = this.#keyframes.splice(index, 1)
    return removed
  }

  copy(): ClipChannelAnimation {
    const copy = new ClipChannelAnimation()
    for (const kf of this.#keyframes) {
      copy.add(
        new KeyframeModel(
          newKeyframeId(),
          kf.time,
          kf.value,
          kf.interpolation,
          { time: kf.tangentIn.time, value: kf.tangentIn.value },
          { time: kf.tangentOut.time, value: kf.tangentOut.value },
        ),
      )
    }
    return copy
  }

  toJSON(): ClipChannelJSON {
    return {
      keyframes: this.#keyframes.map((kf) => kf.toJSON()),
    }
  }

  static fromJSON(json: unknown): ClipChannelAnimation {
    const anim = new ClipChannelAnimation()
    if (!isRecord(json) || !Array.isArray(json.keyframes)) {
      throw new Error('Clip channel animation must have a keyframes array')
    }
    let previousTime = -Infinity
    const seenIds = new Set<string>()
    for (const kfJson of json.keyframes) {
      if (typeof kfJson !== 'object' || kfJson === null) {
        throw new Error('Clip channel keyframe must be an object')
      }
      const record = kfJson as Record<string, unknown>
      const id = requireString(record.id, 'Clip keyframe id')
      if (seenIds.has(id)) {
        throw new Error(`Duplicate clip keyframe id: ${id}`)
      }
      seenIds.add(id)
      const time = requireFiniteNumber(record.time, `Clip keyframe "${id}" time`)
      if (time < 0 || time > 1) {
        throw new Error(`Clip keyframe time must be within [0, 1]`)
      }
      if (time < previousTime) {
        throw new Error(`Clip keyframe times must not decrease (out-of-order time ${time})`)
      }
      if (time === previousTime && time !== 1) {
        throw new Error(`Clip keyframe times must be distinct (duplicate time ${time} not at 1)`)
      }
      previousTime = time
      if (typeof record.value !== 'number' || !Number.isFinite(record.value)) {
        throw new Error(`Clip keyframe "${id}" value must be a finite number`)
      }
      const value = record.value
      const interpolation =
        record.interpolation === undefined
          ? 'linear'
          : requireKeyframeInterpolation(record.interpolation)
      const tangentIn =
        record.tangentIn === undefined ? ZERO_TANGENT : requireKeyframeTangent(record.tangentIn)
      const tangentOut =
        record.tangentOut === undefined ? ZERO_TANGENT : requireKeyframeTangent(record.tangentOut)
      anim.add(new KeyframeModel(id, time, value, interpolation, tangentIn, tangentOut))
    }
    return anim
  }
}

function insertSortedKeyframes(keyframes: Keyframe[], keyframe: Keyframe): void {
  const index = keyframes.findIndex((kf) => kf.time > keyframe.time)
  if (index === -1) {
    keyframes.push(keyframe)
  } else {
    keyframes.splice(index, 0, keyframe)
  }
}

export class ClipDefinition {
  readonly id: string
  #name: string
  #duration: number
  #category: string
  #params: ClipParam[]
  #channels: ClipChannelDef[]
  readonly #channelAnimations = new Map<ClipChannel, ClipChannelAnimation>()

  constructor(
    id: string,
    name: string,
    duration: number,
    category: string,
    params: ClipParam[],
    channels: ClipChannelDef[],
  ) {
    this.id = id
    this.#name = name
    this.#duration = duration
    this.#category = category
    this.#params = [...params]
    this.#channels = [...channels]
    for (const channel of channels) {
      this.#channelAnimations.set(channel.property, new ClipChannelAnimation())
    }
  }

  get name(): string {
    return this.#name
  }

  set name(value: string) {
    this.#name = value
  }

  get duration(): number {
    return this.#duration
  }

  set duration(value: number) {
    this.#duration = value
  }

  get category(): string {
    return this.#category
  }

  set category(value: string) {
    this.#category = value
  }

  get params(): readonly ClipParam[] {
    return this.#params
  }

  get channels(): readonly ClipChannelDef[] {
    return this.#channels
  }

  getParam(key: string): ClipParam | undefined {
    return this.#params.find((p) => p.key === key)
  }

  getChannel(property: ClipChannel): ClipChannelDef | undefined {
    return this.#channels.find((ch) => ch.property === property)
  }

  hasChannel(property: ClipChannel): boolean {
    return this.#channels.some((ch) => ch.property === property)
  }

  channelAnimation(property: ClipChannel): ClipChannelAnimation | undefined {
    return this.#channelAnimations.get(property)
  }

  getChannelKeyframes(property: ClipChannel): readonly Keyframe[] {
    return this.#channelAnimations.get(property)?.keyframes() ?? []
  }

  getChannelKeyframe(property: ClipChannel, keyframeId: string): Keyframe | undefined {
    return this.#channelAnimations.get(property)?.getKeyframe(keyframeId)
  }

  addChannelKeyframe(property: ClipChannel, keyframe: Keyframe): void {
    let anim = this.#channelAnimations.get(property)
    if (!anim) {
      anim = new ClipChannelAnimation()
      this.#channelAnimations.set(property, anim)
    }
    anim.add(keyframe)
  }

  removeChannelKeyframe(property: ClipChannel, keyframeId: string): Keyframe | undefined {
    const anim = this.#channelAnimations.get(property)
    if (!anim) return undefined
    const removed = anim.remove(keyframeId)
    if (anim.length === 0) {
      this.#channelAnimations.delete(property)
      // Remove channel from definition when last keyframe is deleted (Spec: "a channel exists while it has >= 1 keyframe")
      this.#channels = this.#channels.filter((ch) => ch.property !== property)
    }
    return removed
  }

  removeChannel(property: ClipChannel): void {
    this.#channelAnimations.delete(property)
  }

  setParamDefault(paramKey: string, defaultValue: number): void {
    const index = this.#params.findIndex((p) => p.key === paramKey)
    if (index >= 0) {
      this.#params[index] = { ...this.#params[index]!, default: defaultValue }
    }
  }

  setChannelParamLink(
    channel: ClipChannel,
    paramKey: string | null,
    linkMode?: ClipLinkMode,
  ): void {
    const index = this.#channels.findIndex((ch) => ch.property === channel)
    if (index >= 0) {
      const existing = this.#channels[index]!
      if (paramKey === null || paramKey === undefined) {
        this.#channels[index] = { property: existing.property }
      } else {
        this.#channels[index] = {
          ...existing,
          paramKey,
          ...(linkMode !== undefined ? { linkMode } : {}),
        }
      }
    }
  }

  copy(): ClipDefinition {
    const copy = new ClipDefinition(
      this.id,
      this.#name,
      this.#duration,
      this.#category,
      this.#params,
      this.#channels,
    )
    for (const [channel, anim] of this.#channelAnimations) {
      copy.#channelAnimations.set(channel, anim.copy())
    }
    return copy
  }

  toJSON(): ClipJSON {
    return {
      id: this.id,
      name: this.#name,
      duration: this.#duration,
      category: this.#category,
      params: this.#params.map((p) => ({ ...p })),
      channels: this.#channels.map((ch) => ({
        property: ch.property,
        ...(ch.paramKey !== undefined ? { paramKey: ch.paramKey } : {}),
        ...(ch.linkMode !== undefined ? { linkMode: ch.linkMode } : {}),
      })),
      channelAnimations: Object.fromEntries(
        [...this.#channelAnimations.entries()].map(([channel, anim]) => [channel, anim.toJSON()]),
      ),
    }
  }

  static fromJSON(json: unknown): ClipDefinition {
    if (!isRecord(json)) {
      throw new Error('Clip definition must be an object')
    }
    const id = requireString(json.id, 'Clip id')
    const name = requireString(json.name, 'Clip name')
    const duration = requireFiniteNumber(json.duration, 'Clip duration')
    if (duration < 0) {
      throw new Error('Clip duration must be non-negative')
    }
    const category = typeof json.category === 'string' ? json.category : ''
    if (!Array.isArray(json.params)) {
      throw new Error('Clip params must be an array')
    }
    const params: ClipParam[] = json.params.map((p) => {
      if (!isRecord(p)) throw new Error('Clip param must be an object')
      return {
        key: requireString(p.key, 'Clip param key'),
        label: requireString(p.label, 'Clip param label'),
        kind: requireString(p.kind, 'Clip param kind'),
        default: requireFiniteNumber(p.default, 'Clip param default'),
      }
    })
    if (!Array.isArray(json.channels)) {
      throw new Error('Clip channels must be an array')
    }
    const channels: ClipChannelDef[] = json.channels.map((ch) => {
      if (!isRecord(ch)) throw new Error('Clip channel must be an object')
      const property = requireAnimationProperty(ch.property)
      const paramKey =
        ch.paramKey !== undefined ? requireString(ch.paramKey, 'Clip channel paramKey') : undefined
      const linkMode = ch.linkMode !== undefined ? requireLinkMode(ch.linkMode) : undefined
      return {
        property,
        ...(paramKey !== undefined ? { paramKey } : {}),
        ...(linkMode !== undefined ? { linkMode } : {}),
      }
    })
    const clip = new ClipDefinition(id, name, duration, category, params, channels)
    if (isRecord(json.channelAnimations) && json.channelAnimations !== null) {
      for (const [channel, animJson] of Object.entries(
        json.channelAnimations as Record<string, unknown>,
      )) {
        if (CLIP_CHANNELS.includes(channel as ClipChannel)) {
          clip.#channelAnimations.set(
            channel as ClipChannel,
            ClipChannelAnimation.fromJSON(animJson),
          )
        }
      }
    }
    return clip
  }
}

export function newClipId(): string {
  return newId('clip')
}

function requireLinkMode(value: unknown): ClipLinkMode {
  if (value === 'gain' || value === 'offset') {
    return value
  }
  throw new Error(`Unknown clip link mode: ${String(value)}`)
}
