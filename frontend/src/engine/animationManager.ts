import type { EventBus } from './events'
import type { SceneNode } from './sceneNode'
import type { Slide } from './slide'
import type { Keyframe } from './keyframe'
import { Keyframe as KeyframeModel, newKeyframeId } from './keyframe'
import type { InterpolationType, KeyframeTangent } from './keyframe'
import { requireKeyframeInterpolation, requireKeyframeTangent } from './keyframe'
import type { AnimationProperty } from './animationProperties'
import { requireKeyframeTime } from './animationProperties'
import { requireFiniteNumber } from './guards'
import type { NodeAnimation } from './nodeAnimation'
import type { KeyframeTarget, KeyframeTrackRef, MaterialParameterKindOf } from './keyframeTarget'
import {
  requireNodeTarget,
  requireScaleFactor,
  requireTrackKeyframeValue,
  resolveKeyframeTrack,
} from './keyframeTarget'

/** The 1/60 s frame step (Spec 07 R7) used by duplicate placement. */
export const KEYFRAME_FRAME_STEP = 1 / 60

export interface KeyframeMove {
  readonly keyframeId: string
  readonly newTime: number
}

export interface KeyframeMoveResult {
  readonly keyframeId: string
  readonly oldTime: number
}

export interface KeyframeTangents {
  readonly tangentIn: KeyframeTangent
  readonly tangentOut: KeyframeTangent
}

/** A clipboard payload: keyframes relative to their earliest keyframe (Spec 07 R10). */
export interface PastePayloadKeyframe {
  readonly time: number
  readonly value: unknown
  readonly interpolation: InterpolationType
  readonly tangentIn: KeyframeTangent
  readonly tangentOut: KeyframeTangent
}

export interface PastePayload {
  readonly keyframes: readonly PastePayloadKeyframe[]
}

interface ValidatedMove {
  readonly keyframeId: string
  readonly newTime: number
  readonly oldTime: number
}

interface ResolvedTarget {
  readonly node: SceneNode
  readonly slide: Slide
  readonly animation: NodeAnimation
  readonly track: KeyframeTrackRef
}

export class AnimationManager {
  readonly #bus: EventBus
  readonly #nodeLookup: (nodeId: string) => SceneNode
  readonly #slideLookup: (nodeId: string) => Slide
  readonly #parameterKindOf: MaterialParameterKindOf

  constructor(
    bus: EventBus,
    nodeLookup: (nodeId: string) => SceneNode,
    slideLookup: (nodeId: string) => Slide,
    parameterKindOf: MaterialParameterKindOf,
  ) {
    this.#bus = bus
    this.#nodeLookup = nodeLookup
    this.#slideLookup = slideLookup
    this.#parameterKindOf = parameterKindOf
  }

  getKeyframes(nodeId: string, property: AnimationProperty): readonly Keyframe[] {
    const slide = this.#slideLookup(nodeId)
    return slide.animation.node(nodeId)?.keyframes(property) ?? []
  }

  getMaterialKeyframes(nodeId: string, parameter: string): readonly Keyframe[] {
    const slide = this.#slideLookup(nodeId)
    return slide.animation.node(nodeId)?.materialKeyframes(parameter) ?? []
  }

  hasMaterialTrack(nodeId: string, parameter: string): boolean {
    const slide = this.#slideLookup(nodeId)
    return slide.animation.node(nodeId)?.hasMaterialTrack(parameter) ?? false
  }

  getVisibleKeyframes(nodeId: string): readonly Keyframe[] {
    const slide = this.#slideLookup(nodeId)
    return slide.animation.node(nodeId)?.visibleKeyframes() ?? []
  }

  hasVisibleTrack(nodeId: string): boolean {
    const slide = this.#slideLookup(nodeId)
    return slide.animation.node(nodeId)?.hasVisibleTrack() ?? false
  }

  getMorphKeyframes(nodeId: string): readonly Keyframe[] {
    const slide = this.#slideLookup(nodeId)
    return slide.animation.node(nodeId)?.morphKeyframes() ?? []
  }

  hasMorphTrack(nodeId: string): boolean {
    const slide = this.#slideLookup(nodeId)
    return slide.animation.node(nodeId)?.hasMorphTrack() ?? false
  }

  addKeyframe(target: KeyframeTarget, time: number, value: unknown): Keyframe {
    const resolved = this.#resolve(target)
    const boundedTime = requireKeyframeTime(time, resolved.slide.duration)
    const boundedValue = requireTrackKeyframeValue(resolved.track, value)
    this.#assertTimeFree(resolved, boundedTime, [], [])
    let interpolation = previousInterpolation(this.#keyframesOf(resolved), boundedTime)
    if (resolved.track.kind === 'visible') {
      interpolation = 'hold'
    }
    const keyframe = new KeyframeModel(newKeyframeId(), boundedTime, boundedValue, interpolation)
    if (resolved.track.kind === 'visible') {
      keyframe.interpolation = 'hold'
    }
    this.#addToTrack(resolved, keyframe)
    this.#bus.emit({ type: 'KeyframeAdded', target, keyframeId: keyframe.id })
    return keyframe
  }

  deleteKeyframes(target: KeyframeTarget, keyframeIds: readonly string[]): Keyframe[] {
    if (keyframeIds.length === 0) {
      throw new Error('At least one keyframe id is required')
    }
    const resolved = this.#resolve(target)
    const seen = new Set<string>()
    const removed: Keyframe[] = []
    for (const keyframeId of keyframeIds) {
      if (seen.has(keyframeId)) {
        throw new Error(`Duplicate keyframe id in batch: ${keyframeId}`)
      }
      seen.add(keyframeId)
      const keyframe = this.#requireKeyframe(resolved, keyframeId)
      removed.push(keyframe)
    }
    for (const keyframe of removed) {
      this.#removeFromTrack(resolved, keyframe.id)
    }
    for (const keyframe of removed) {
      this.#bus.emit({ type: 'KeyframeRemoved', target, keyframeId: keyframe.id })
    }
    return removed
  }

  moveKeyframes(target: KeyframeTarget, moves: readonly KeyframeMove[]): KeyframeMoveResult[] {
    const validated = this.#validateMoves(target, moves)
    const resolved = this.#resolve(target)
    for (const move of validated) {
      const keyframe = this.#requireKeyframe(resolved, move.keyframeId)
      this.#removeFromTrack(resolved, keyframe.id)
      keyframe.time = move.newTime
      this.#addToTrack(resolved, keyframe)
    }
    for (const move of validated) {
      this.#bus.emit({ type: 'KeyframeMoved', target, keyframeId: move.keyframeId })
    }
    return validated.map((move) => ({ keyframeId: move.keyframeId, oldTime: move.oldTime }))
  }

  scaleKeyframes(
    target: KeyframeTarget,
    keyframeIds: readonly string[],
    pivot: number,
    factor: number,
  ): KeyframeMoveResult[] {
    if (keyframeIds.length === 0) {
      throw new Error('At least one keyframe id is required')
    }
    const resolved = this.#resolve(target)
    requireKeyframeTime(pivot, resolved.slide.duration, 'Scale pivot')
    requireScaleFactor(factor)
    const moves: KeyframeMove[] = []
    const seen = new Set<string>()
    for (const keyframeId of keyframeIds) {
      if (seen.has(keyframeId)) {
        throw new Error(`Duplicate keyframe id in batch: ${keyframeId}`)
      }
      seen.add(keyframeId)
      const keyframe = this.#requireKeyframe(resolved, keyframeId)
      moves.push({ keyframeId, newTime: pivot + (keyframe.time - pivot) * factor })
    }
    const validated = this.#validateMoves(target, moves)
    for (const move of validated) {
      const keyframe = this.#requireKeyframe(resolved, move.keyframeId)
      this.#removeFromTrack(resolved, keyframe.id)
      keyframe.time = move.newTime
      this.#addToTrack(resolved, keyframe)
    }
    for (const move of validated) {
      this.#bus.emit({ type: 'KeyframeMoved', target, keyframeId: move.keyframeId })
    }
    return validated.map((move) => ({ keyframeId: move.keyframeId, oldTime: move.oldTime }))
  }

  setKeyframeValue(target: KeyframeTarget, keyframeId: string, value: unknown): unknown {
    const resolved = this.#resolve(target)
    const boundedValue = requireTrackKeyframeValue(resolved.track, value)
    const keyframe = this.#requireKeyframe(resolved, keyframeId)
    const oldValue = keyframe.value
    keyframe.value = boundedValue
    this.#bus.emit({ type: 'KeyframeValueChanged', target, keyframeId })
    return oldValue
  }

  setKeyframeInterpolation(
    target: KeyframeTarget,
    keyframeId: string,
    interpolation: unknown,
  ): InterpolationType {
    const resolved = this.#resolve(target)
    const bounded = requireKeyframeInterpolation(interpolation)
    if (resolved.track.kind === 'visible' && bounded !== 'hold') {
      throw new Error('Visible track only supports hold interpolation')
    }
    const keyframe = this.#requireKeyframe(resolved, keyframeId)
    const oldInterpolation = keyframe.interpolation
    keyframe.interpolation = bounded
    this.#bus.emit({ type: 'KeyframeInterpolationChanged', target, keyframeId })
    return oldInterpolation
  }

  setKeyframeTangents(
    target: KeyframeTarget,
    keyframeId: string,
    tangentIn: unknown,
    tangentOut: unknown,
  ): KeyframeTangents {
    const resolved = this.#resolve(target)
    if (resolved.track.kind === 'visible') {
      throw new Error('Visible track does not support tangents')
    }
    const boundedIn = requireKeyframeTangent(tangentIn, 'Keyframe tangent in')
    const boundedOut = requireKeyframeTangent(tangentOut, 'Keyframe tangent out')
    const keyframe = this.#requireKeyframe(resolved, keyframeId)
    const old = {
      tangentIn: keyframe.tangentIn,
      tangentOut: keyframe.tangentOut,
    }
    keyframe.tangentIn = boundedIn
    keyframe.tangentOut = boundedOut
    this.#bus.emit({ type: 'KeyframeTangentsChanged', target, keyframeId })
    return old
  }

  pasteKeyframes(target: KeyframeTarget, payload: PastePayload, atTime: number): Keyframe[] {
    if (payload.keyframes.length === 0) {
      throw new Error('At least one keyframe is required to paste')
    }
    const resolved = this.#resolve(target)
    const boundedAtTime = requireKeyframeTime(atTime, resolved.slide.duration, 'Paste time')
    const pending: { time: number; payload: PastePayloadKeyframe }[] = []
    for (const entry of payload.keyframes) {
      const relative = requireFiniteNumber(
        entry.time,
        'Paste payload time',
        (value) => value >= 0,
        'a non-negative finite number',
      )
      const time = Math.min(Math.max(boundedAtTime + relative, 0), resolved.slide.duration)
      pending.push({ time, payload: entry })
    }
    this.#assertPasteFree(
      resolved,
      pending.map((entry) => entry.time),
    )
    const created: Keyframe[] = []
    for (const entry of pending) {
      const value = requireTrackKeyframeValue(resolved.track, entry.payload.value)
      let interpolation = requireKeyframeInterpolation(entry.payload.interpolation)
      if (resolved.track.kind === 'visible' && interpolation !== 'hold') {
        throw new Error('Visible track only supports hold interpolation')
      }
      if (resolved.track.kind === 'visible') {
        interpolation = 'hold'
      }
      const keyframe = new KeyframeModel(
        newKeyframeId(),
        entry.time,
        value,
        interpolation,
        requireKeyframeTangent(entry.payload.tangentIn, 'Keyframe tangent in'),
        requireKeyframeTangent(entry.payload.tangentOut, 'Keyframe tangent out'),
      )
      if (resolved.track.kind === 'visible') {
        keyframe.interpolation = 'hold'
      }
      this.#addToTrack(resolved, keyframe)
      created.push(keyframe)
    }
    for (const keyframe of created) {
      this.#bus.emit({ type: 'KeyframeAdded', target, keyframeId: keyframe.id })
    }
    return created
  }

  duplicateKeyframes(target: KeyframeTarget, keyframeIds: readonly string[]): Keyframe[] {
    if (keyframeIds.length === 0) {
      throw new Error('At least one keyframe id is required')
    }
    const resolved = this.#resolve(target)
    const seen = new Set<string>()
    const sources: Keyframe[] = []
    for (const keyframeId of keyframeIds) {
      if (seen.has(keyframeId)) {
        throw new Error(`Duplicate keyframe id in batch: ${keyframeId}`)
      }
      seen.add(keyframeId)
      sources.push(this.#requireKeyframe(resolved, keyframeId))
    }
    const firstTime = Math.min(...sources.map((keyframe) => keyframe.time))
    const lastTime = Math.max(...sources.map((keyframe) => keyframe.time))
    const moves: KeyframeMove[] = sources.map((keyframe) => ({
      keyframeId: keyframe.id,
      newTime: lastTime + KEYFRAME_FRAME_STEP + (keyframe.time - firstTime),
    }))
    this.#validateMoves(target, moves)
    const created: Keyframe[] = []
    for (const move of moves) {
      const source = this.#requireKeyframe(resolved, move.keyframeId)
      const keyframe = new KeyframeModel(
        newKeyframeId(),
        move.newTime,
        source.value,
        source.interpolation,
        { time: source.tangentIn.time, value: source.tangentIn.value },
        { time: source.tangentOut.time, value: source.tangentOut.value },
      )
      this.#addToTrack(resolved, keyframe)
      created.push(keyframe)
    }
    for (const keyframe of created) {
      this.#bus.emit({ type: 'KeyframeAdded', target, keyframeId: keyframe.id })
    }
    return created
  }

  /** Resolve a target's track, rejecting unknown nodes, properties, and parameters. */
  resolveTarget(target: KeyframeTarget): KeyframeTrackRef {
    return this.#resolve(target).track
  }

  #resolve(target: KeyframeTarget): ResolvedTarget {
    const nodeTarget = requireNodeTarget(target)
    const node = this.#nodeLookup(nodeTarget.nodeId)
    const slide = this.#slideLookup(nodeTarget.nodeId)
    const animation = slide.animation.ensure(node.id)
    const track = resolveKeyframeTrack(node, target, this.#parameterKindOf, (parameter) =>
      animation.hasMaterialTrack(parameter),
    )
    return { node, slide, animation, track }
  }

  #keyframesOf(resolved: ResolvedTarget): readonly Keyframe[] {
    const { animation, track } = resolved
    if (track.kind === 'property') {
      return animation.keyframes(track.property)
    }
    if (track.kind === 'visible') {
      return animation.visibleKeyframes()
    }
    if (track.kind === 'morph') {
      return animation.morphKeyframes()
    }
    if (track.kind === 'dataLabel') {
      return animation.dataLabelKeyframes(track.label)
    }
    if (track.kind === 'circle') {
      return animation.circleKeyframes(track.property)
    }
    if (track.kind === 'table') {
      return animation.tableKeyframes(track.property)
    }
    return animation.materialKeyframes(track.parameter)
  }

  #addToTrack(resolved: ResolvedTarget, keyframe: Keyframe): void {
    const { animation, track } = resolved
    if (track.kind === 'property') {
      animation.add(track.property, keyframe)
    } else if (track.kind === 'visible') {
      animation.addVisible(keyframe)
    } else if (track.kind === 'morph') {
      animation.addMorph(keyframe)
    } else if (track.kind === 'dataLabel') {
      animation.addDataLabel(track.label, keyframe)
    } else if (track.kind === 'circle') {
      animation.addCircle(track.property, keyframe)
    } else if (track.kind === 'table') {
      animation.addTable(track.property, keyframe)
    } else {
      animation.addMaterial(track.parameter, keyframe)
    }
  }

  #removeFromTrack(resolved: ResolvedTarget, keyframeId: string): void {
    const { animation, track } = resolved
    if (track.kind === 'property') {
      animation.remove(track.property, keyframeId)
    } else if (track.kind === 'visible') {
      animation.removeVisible(keyframeId)
    } else if (track.kind === 'morph') {
      animation.removeMorph(keyframeId)
    } else if (track.kind === 'dataLabel') {
      animation.removeDataLabel(track.label, keyframeId)
    } else if (track.kind === 'circle') {
      animation.removeCircle(track.property, keyframeId)
    } else if (track.kind === 'table') {
      animation.removeTable(track.property, keyframeId)
    } else {
      animation.removeMaterial(track.parameter, keyframeId)
    }
  }

  #requireKeyframe(resolved: ResolvedTarget, keyframeId: string): Keyframe {
    const { animation, track } = resolved
    let keyframe: Keyframe | undefined
    if (track.kind === 'property') {
      keyframe = animation.get(track.property, keyframeId)
    } else if (track.kind === 'visible') {
      keyframe = animation.getVisible(keyframeId)
    } else if (track.kind === 'morph') {
      keyframe = animation.getMorph(keyframeId)
    } else if (track.kind === 'dataLabel') {
      keyframe = animation.getDataLabel(track.label, keyframeId)
    } else if (track.kind === 'circle') {
      keyframe = animation.getCircle(track.property, keyframeId)
    } else if (track.kind === 'table') {
      keyframe = animation.getTable(track.property, keyframeId)
    } else {
      keyframe = animation.getMaterial(track.parameter, keyframeId)
    }
    if (!keyframe) {
      const on =
        track.kind === 'property'
          ? `property ${track.property}`
          : track.kind === 'visible'
            ? `visible`
            : track.kind === 'morph'
              ? `morph`
              : track.kind === 'dataLabel'
                ? `data label ${track.label}`
                : track.kind === 'circle'
                  ? `circle ${track.property}`
                  : track.kind === 'table'
                    ? `table ${track.property}`
                    : `parameter ${track.parameter}`
      throw new Error(`Keyframe not found: ${keyframeId} on ${on}`)
    }
    return keyframe
  }

  #validateMoves(target: KeyframeTarget, moves: readonly KeyframeMove[]): ValidatedMove[] {
    if (moves.length === 0) {
      throw new Error('At least one keyframe move is required')
    }
    const resolved = this.#resolve(target)
    const seen = new Set<string>()
    const validated: ValidatedMove[] = []
    for (const move of moves) {
      const boundedTime = requireKeyframeTime(move.newTime, resolved.slide.duration)
      if (seen.has(move.keyframeId)) {
        throw new Error(`Duplicate keyframe move: ${move.keyframeId}`)
      }
      seen.add(move.keyframeId)
      const keyframe = this.#requireKeyframe(resolved, move.keyframeId)
      this.#assertTimeFree(
        resolved,
        boundedTime,
        moves.map((entry) => entry.keyframeId),
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

  #assertPasteFree(resolved: ResolvedTarget, times: readonly number[]): void {
    const occupied = this.#keyframesOf(resolved).map((keyframe) => keyframe.time)
    for (const time of times) {
      if (occupied.includes(time)) {
        throw new Error(`Node ${resolved.node.name} already has a keyframe at time ${time}`)
      }
    }
    for (let first = 0; first < times.length; first++) {
      for (let second = first + 1; second < times.length; second++) {
        if (times[first] === times[second]) {
          throw new Error(`Two pasted keyframes cannot land at the same time ${times[first]}`)
        }
      }
    }
  }

  #assertTimeFree(
    resolved: ResolvedTarget,
    time: number,
    batchKeyframeIds: readonly string[],
    excludedKeyframeIds: readonly string[],
  ): void {
    const vacating = new Set(batchKeyframeIds)
    const excluded = new Set(excludedKeyframeIds)
    const occupied = this.#keyframesOf(resolved).some(
      (keyframe) =>
        keyframe.time === time && !vacating.has(keyframe.id) && !excluded.has(keyframe.id),
    )
    if (occupied) {
      throw new Error(
        `Node ${resolved.node.name} already has a keyframe at time ${time} on ${this.#trackLabel(resolved)}`,
      )
    }
  }

  #trackLabel(resolved: ResolvedTarget): string {
    const { track } = resolved
    if (track.kind === 'property') {
      return `property ${track.property}`
    }
    if (track.kind === 'visible') {
      return `visible`
    }
    if (track.kind === 'morph') {
      return `morph`
    }
    if (track.kind === 'dataLabel') {
      return `data label ${track.label}`
    }
    if (track.kind === 'circle') {
      return `circle ${track.property}`
    }
    if (track.kind === 'table') {
      return `table ${track.property}`
    }
    return `parameter ${track.parameter}`
  }
}

function previousInterpolation(
  keyframes: readonly Keyframe[],
  time: number,
): InterpolationType | undefined {
  let previous: Keyframe | undefined
  for (const keyframe of keyframes) {
    if (keyframe.time > time) {
      break
    }
    previous = keyframe
  }
  return previous?.interpolation
}
