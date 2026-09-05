import type { AnimationProperty, CircleAnimationProperty } from './animationProperties'
import type { Keyframe, KeyframeValue } from './keyframe'
import type { ClipChannelJSON, ClipJSON } from './json'
import { newId } from './ids'
import { Keyframe as KeyframeModel, newKeyframeId, ZERO_TANGENT } from './keyframe'
import { requireKeyframeInterpolation, requireKeyframeTangent } from './keyframe'
import { isRecord, requireFiniteNumber, requireString } from './guards'
import { requireAnimationProperty } from './animationProperties'

/** The recognised kind values for clip parameters. */
export const CLIP_PARAM_KINDS = ['number', 'color', 'vec2'] as const

/** Extensible union type — any of the recognised kinds, or a custom string. */
export type ClipParamKind = (typeof CLIP_PARAM_KINDS)[number] | (string & {})

export function requireClipParamKind(value: unknown): ClipParamKind {
  if (typeof value !== 'string' || value === '') {
    throw new Error('Clip param kind must be a non-empty string')
  }
  return value as ClipParamKind
}

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

export const CLIP_CIRCLE_CHANNELS: readonly CircleAnimationProperty[] = [
  'radius',
  'startAngle',
  'endAngle',
  'segments',
]

/** A parameter that a clip channel can be linked to. */
export interface ClipParam {
  readonly key: string
  readonly label: string
  readonly kind: ClipParamKind
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
  /** Optional material parameter key: if present, this channel targets a material parameter. */
  readonly materialParameter?: string
}

/** Minimal shape for importing a clip from the shared library. */
export interface LibraryClipInput {
  readonly name: string
  readonly duration: number
  readonly category: string | null
  readonly params: readonly ClipParam[]
  readonly channels: readonly ClipChannelDef[]
  readonly channelAnimations: Record<string, unknown> | null
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
    return fromJSONWithValueValidator(json, (value, id) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Clip keyframe "${id}" value must be a finite number`)
      }
      return value
    })
  }

  static fromJSONWithKind(
    json: unknown,
    validator: (value: unknown, id: string) => KeyframeValue,
  ): ClipChannelAnimation {
    return fromJSONWithValueValidator(json, validator)
  }
}

function fromJSONWithValueValidator(
  json: unknown,
  validateValue: (value: unknown, id: string) => KeyframeValue,
): ClipChannelAnimation {
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
    const value = validateValue(record.value, id)
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
  readonly #materialChannelAnimations = new Map<string, ClipChannelAnimation>()
  readonly #visibleAnimation = new ClipChannelAnimation()
  readonly #circleAnimations = new Map<CircleAnimationProperty, ClipChannelAnimation>()
  readonly #morphAnimation = new ClipChannelAnimation()

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
      if (channel.materialParameter) {
        this.#materialChannelAnimations.set(channel.materialParameter, new ClipChannelAnimation())
      } else {
        this.#channelAnimations.set(channel.property, new ClipChannelAnimation())
      }
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

  addParam(param: ClipParam): void {
    if (param.key === '') {
      throw new Error('Clip param key must not be empty')
    }
    if (this.#params.some((p) => p.key === param.key)) {
      throw new Error(`Clip param with key "${param.key}" already exists`)
    }
    this.#params.push(param)
  }

  removeParam(paramKey: string): ClipParam | undefined {
    const index = this.#params.findIndex((p) => p.key === paramKey)
    if (index === -1) return undefined
    const [removed] = this.#params.splice(index, 1)
    // Unlink any channels that referenced this param
    for (let i = 0; i < this.#channels.length; i++) {
      const ch = this.#channels[i]!
      if (ch.paramKey === paramKey) {
        this.#channels[i] = { property: ch.property }
      }
    }
    return removed
  }

  getChannel(property: ClipChannel): ClipChannelDef | undefined {
    return this.#channels.find((ch) => ch.property === property)
  }

  hasChannel(property: ClipChannel): boolean {
    return this.#channels.some((ch) => ch.property === property)
  }

  hasMaterialChannel(parameterKey: string): boolean {
    return this.#channels.some((ch) => ch.materialParameter === parameterKey)
  }

  channelAnimation(property: ClipChannel): ClipChannelAnimation | undefined {
    return this.#channelAnimations.get(property)
  }

  materialChannelAnimation(parameterKey: string): ClipChannelAnimation | undefined {
    return this.#materialChannelAnimations.get(parameterKey)
  }

  get materialChannelParameterKeys(): string[] {
    return [...this.#materialChannelAnimations.keys()]
  }

  getChannelKeyframes(property: ClipChannel): readonly Keyframe[] {
    return this.#channelAnimations.get(property)?.keyframes() ?? []
  }

  getMaterialChannelKeyframes(parameterKey: string): readonly Keyframe[] {
    return this.#materialChannelAnimations.get(parameterKey)?.keyframes() ?? []
  }

  getVisibleKeyframes(): readonly Keyframe[] {
    return this.#visibleAnimation.keyframes()
  }

  hasVisibleTrack(): boolean {
    return this.#visibleAnimation.length > 0
  }

  getCircleKeyframes(property: CircleAnimationProperty): readonly Keyframe[] {
    return this.#circleAnimations.get(property)?.keyframes() ?? []
  }

  hasCircleTrack(property: CircleAnimationProperty): boolean {
    return this.#circleAnimations.has(property)
  }

  get circleTrackKeys(): readonly CircleAnimationProperty[] {
    return [...this.#circleAnimations.keys()]
  }

  getMorphKeyframes(): readonly Keyframe[] {
    return this.#morphAnimation.keyframes()
  }

  hasMorphTrack(): boolean {
    return this.#morphAnimation.length > 0
  }

  visibleAnimation(): ClipChannelAnimation {
    return this.#visibleAnimation
  }

  circleAnimation(property: CircleAnimationProperty): ClipChannelAnimation | undefined {
    return this.#circleAnimations.get(property)
  }

  morphAnimation(): ClipChannelAnimation {
    return this.#morphAnimation
  }

  getChannelKeyframe(property: ClipChannel, keyframeId: string): Keyframe | undefined {
    return this.#channelAnimations.get(property)?.getKeyframe(keyframeId)
  }

  getMaterialChannelKeyframe(parameterKey: string, keyframeId: string): Keyframe | undefined {
    return this.#materialChannelAnimations.get(parameterKey)?.getKeyframe(keyframeId)
  }

  getVisibleKeyframe(keyframeId: string): Keyframe | undefined {
    return this.#visibleAnimation.getKeyframe(keyframeId)
  }

  getCircleKeyframe(property: CircleAnimationProperty, keyframeId: string): Keyframe | undefined {
    return this.#circleAnimations.get(property)?.getKeyframe(keyframeId)
  }

  getMorphKeyframe(keyframeId: string): Keyframe | undefined {
    return this.#morphAnimation.getKeyframe(keyframeId)
  }

  addChannelKeyframe(property: ClipChannel, keyframe: Keyframe): void {
    let anim = this.#channelAnimations.get(property)
    if (!anim) {
      anim = new ClipChannelAnimation()
      this.#channelAnimations.set(property, anim)
    }
    anim.add(keyframe)
  }

  addMaterialChannelKeyframe(parameterKey: string, keyframe: Keyframe): void {
    let anim = this.#materialChannelAnimations.get(parameterKey)
    if (!anim) {
      anim = new ClipChannelAnimation()
      this.#materialChannelAnimations.set(parameterKey, anim)
    }
    anim.add(keyframe)
  }

  addVisibleKeyframe(keyframe: Keyframe): void {
    this.#visibleAnimation.add(keyframe)
  }

  addCircleKeyframe(property: CircleAnimationProperty, keyframe: Keyframe): void {
    let anim = this.#circleAnimations.get(property)
    if (!anim) {
      anim = new ClipChannelAnimation()
      this.#circleAnimations.set(property, anim)
    }
    anim.add(keyframe)
  }

  addMorphKeyframe(keyframe: Keyframe): void {
    this.#morphAnimation.add(keyframe)
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

  removeMaterialChannelKeyframe(parameterKey: string, keyframeId: string): Keyframe | undefined {
    const anim = this.#materialChannelAnimations.get(parameterKey)
    if (!anim) return undefined
    const removed = anim.remove(keyframeId)
    if (anim.length === 0) {
      this.#materialChannelAnimations.delete(parameterKey)
      this.#channels = this.#channels.filter((ch) => ch.materialParameter !== parameterKey)
    }
    return removed
  }

  removeVisibleKeyframe(keyframeId: string): Keyframe | undefined {
    return this.#visibleAnimation.remove(keyframeId)
  }

  removeCircleKeyframe(
    property: CircleAnimationProperty,
    keyframeId: string,
  ): Keyframe | undefined {
    const anim = this.#circleAnimations.get(property)
    if (!anim) return undefined
    const removed = anim.remove(keyframeId)
    if (anim.length === 0) {
      this.#circleAnimations.delete(property)
    }
    return removed
  }

  removeMorphKeyframe(keyframeId: string): Keyframe | undefined {
    return this.#morphAnimation.remove(keyframeId)
  }

  removeChannel(property: ClipChannel): void {
    this.#channels = this.#channels.filter((ch) => ch.property !== property)
    this.#channelAnimations.delete(property)
  }

  removeMaterialChannel(parameterKey: string): void {
    this.#channels = this.#channels.filter((ch) => ch.materialParameter !== parameterKey)
    this.#materialChannelAnimations.delete(parameterKey)
  }

  addChannel(channelDef: ClipChannelDef): void {
    if (channelDef.materialParameter) {
      if (this.#materialChannelAnimations.has(channelDef.materialParameter)) {
        throw new Error(`Clip material channel "${channelDef.materialParameter}" already exists`)
      }
      this.#channels.push(channelDef)
      this.#materialChannelAnimations.set(channelDef.materialParameter, new ClipChannelAnimation())
    } else {
      if (this.hasChannel(channelDef.property)) {
        throw new Error(`Clip channel "${channelDef.property}" already exists`)
      }
      this.#channels.push(channelDef)
      this.#channelAnimations.set(channelDef.property, new ClipChannelAnimation())
    }
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
    for (const [param, anim] of this.#materialChannelAnimations) {
      copy.#materialChannelAnimations.set(param, anim.copy())
    }
    // Copy visible, circle and morph animations
    for (const kf of this.#visibleAnimation.keyframes()) {
      copy.#visibleAnimation.add(
        new KeyframeModel(
          kf.id,
          kf.time,
          kf.value,
          kf.interpolation,
          { time: kf.tangentIn.time, value: kf.tangentIn.value },
          { time: kf.tangentOut.time, value: kf.tangentOut.value },
        ),
      )
    }
    for (const [prop, anim] of this.#circleAnimations) {
      copy.#circleAnimations.set(prop, anim.copy())
    }
    for (const kf of this.#morphAnimation.keyframes()) {
      copy.#morphAnimation.add(
        new KeyframeModel(
          kf.id,
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

  toJSON(): ClipJSON {
    const json: ClipJSON & {
      visibleAnimation?: ReturnType<ClipChannelAnimation['toJSON']>
      circleChannelAnimations?: Record<string, ReturnType<ClipChannelAnimation['toJSON']>>
    } = {
      id: this.id,
      name: this.#name,
      duration: this.#duration,
      category: this.#category,
      params: this.#params.map((p) => ({ ...p })),
      channels: this.#channels.map((ch) => ({
        property: ch.property,
        ...(ch.paramKey !== undefined ? { paramKey: ch.paramKey } : {}),
        ...(ch.linkMode !== undefined ? { linkMode: ch.linkMode } : {}),
        ...(ch.materialParameter !== undefined ? { materialParameter: ch.materialParameter } : {}),
      })),
      channelAnimations: Object.fromEntries(
        [...this.#channelAnimations.entries()].map(([channel, anim]) => [channel, anim.toJSON()]),
      ),
      materialChannelAnimations: Object.fromEntries(
        [...this.#materialChannelAnimations.entries()].map(([param, anim]) => [
          param,
          anim.toJSON(),
        ]),
      ),
    }
    if (this.#visibleAnimation.length > 0) {
      ;(json as Record<string, unknown>).visibleAnimation = this.#visibleAnimation.toJSON()
    }
    if (this.#circleAnimations.size > 0) {
      ;(json as Record<string, unknown>).circleChannelAnimations = Object.fromEntries(
        [...this.#circleAnimations.entries()].map(([prop, anim]) => [prop, anim.toJSON()]),
      )
    }
    if (this.#morphAnimation.length > 0) {
      ;(json as Record<string, unknown>).morphAnimation = this.#morphAnimation.toJSON()
    }
    return json as ClipJSON
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
      const key = requireString(p.key, 'Clip param key')
      return {
        key,
        label: requireString(p.label, 'Clip param label'),
        kind: requireClipParamKind(p.kind),
        default: requireFiniteNumber(p.default, 'Clip param default'),
      }
    })
    const seenParamKeys = new Set<string>()
    for (const p of params) {
      if (seenParamKeys.has(p.key)) {
        throw new Error(`Duplicate clip param key: "${p.key}"`)
      }
      seenParamKeys.add(p.key)
    }
    if (!Array.isArray(json.channels)) {
      throw new Error('Clip channels must be an array')
    }
    const channels: ClipChannelDef[] = json.channels.map((ch) => {
      if (!isRecord(ch)) throw new Error('Clip channel must be an object')
      const property = requireAnimationProperty(ch.property)
      const paramKey =
        ch.paramKey !== undefined ? requireString(ch.paramKey, 'Clip channel paramKey') : undefined
      const linkMode = ch.linkMode !== undefined ? requireLinkMode(ch.linkMode) : undefined
      const materialParameter =
        ch.materialParameter !== undefined
          ? requireString(ch.materialParameter, 'Clip channel materialParameter')
          : undefined
      return {
        property,
        ...(paramKey !== undefined ? { paramKey } : {}),
        ...(linkMode !== undefined ? { linkMode } : {}),
        ...(materialParameter !== undefined ? { materialParameter } : {}),
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
    if (isRecord(json.materialChannelAnimations) && json.materialChannelAnimations !== null) {
      for (const [param, animJson] of Object.entries(
        json.materialChannelAnimations as Record<string, unknown>,
      )) {
        clip.#materialChannelAnimations.set(param, ClipChannelAnimation.fromJSON(animJson))
      }
    }
    const visibleAnim = (json as Record<string, unknown>).visibleAnimation
    if (isRecord(visibleAnim) && visibleAnim !== null) {
      const anim = ClipChannelAnimation.fromJSONWithKind(visibleAnim, (value, id) => {
        if (typeof value !== 'boolean') {
          throw new Error(`Clip visible keyframe "${id}" value must be a boolean`)
        }
        return value
      })
      for (const kf of anim.keyframes()) {
        clip.#visibleAnimation.add(
          new KeyframeModel(
            kf.id,
            kf.time,
            kf.value,
            kf.interpolation,
            { time: kf.tangentIn.time, value: kf.tangentIn.value },
            { time: kf.tangentOut.time, value: kf.tangentOut.value },
          ),
        )
      }
    }
    const circleAnims = (json as Record<string, unknown>).circleChannelAnimations
    if (isRecord(circleAnims) && circleAnims !== null) {
      for (const [prop, animJson] of Object.entries(circleAnims as Record<string, unknown>)) {
        if ((CLIP_CIRCLE_CHANNELS as readonly string[]).includes(prop)) {
          clip.#circleAnimations.set(
            prop as CircleAnimationProperty,
            ClipChannelAnimation.fromJSON(animJson),
          )
        }
      }
    }
    const morphAnim = (json as Record<string, unknown>).morphAnimation
    if (isRecord(morphAnim) && morphAnim !== null) {
      const anim = ClipChannelAnimation.fromJSONWithKind(morphAnim, (value, id) => {
        // Support both legacy scalar 0..1 and new name-based object
        if (typeof value === 'number') {
          if (!Number.isFinite(value) || value < 0 || value > 1) {
            throw new Error(`Clip morph keyframe "${id}" value must be a number between 0 and 1`)
          }
          return { fromShapeName: null, toShapeName: null, coefficient: value }
        }
        if (typeof value === 'object' && value !== null) {
          const rec = value as Record<string, unknown>
          // New clip format: name-based
          if ('fromShapeName' in rec || 'toShapeName' in rec || 'coefficient' in rec) {
            const fromShapeName = rec.fromShapeName
            const toShapeName = rec.toShapeName
            const coeff = rec.coefficient
            if (fromShapeName !== null && typeof fromShapeName !== 'string') {
              throw new Error(`Clip morph keyframe "${id}" fromShapeName must be string or null`)
            }
            if (toShapeName !== null && typeof toShapeName !== 'string') {
              throw new Error(`Clip morph keyframe "${id}" toShapeName must be string or null`)
            }
            if (typeof coeff !== 'number' || !Number.isFinite(coeff) || coeff < 0 || coeff > 1) {
              throw new Error(`Clip morph keyframe "${id}" coefficient must be between 0 and 1`)
            }
            return {
              fromShapeName: fromShapeName as string | null,
              toShapeName: toShapeName as string | null,
              coefficient: coeff as number,
            }
          }
          // legacy id-based object (from old per-keyframe pair using ids) — treat names as ids fallback
          if ('fromShapeId' in rec || 'toShapeId' in rec) {
            const fromId = (rec.fromShapeId as string | null) ?? null
            const toId = (rec.toShapeId as string | null) ?? null
            const coeff = rec.coefficient as number
            if (fromId !== null && typeof fromId !== 'string') {
              throw new Error(`Clip morph keyframe "${id}" fromShapeId must be string or null`)
            }
            if (toId !== null && typeof toId !== 'string') {
              throw new Error(`Clip morph keyframe "${id}" toShapeId must be string or null`)
            }
            if (typeof coeff !== 'number' || !Number.isFinite(coeff) || coeff < 0 || coeff > 1) {
              throw new Error(`Clip morph keyframe "${id}" coefficient must be between 0 and 1`)
            }
            // Map legacy ids to names by using them as names (best-effort)
            return {
              fromShapeName: fromId,
              toShapeName: toId,
              coefficient: coeff,
            }
          }
        }
        throw new Error(`Clip morph keyframe "${id}" value must be number or morph clip object`)
      })
      for (const kf of anim.keyframes()) {
        clip.#morphAnimation.add(
          new KeyframeModel(
            kf.id,
            kf.time,
            kf.value,
            kf.interpolation,
            { time: kf.tangentIn.time, value: kf.tangentIn.value },
            { time: kf.tangentOut.time, value: kf.tangentOut.value },
          ),
        )
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
