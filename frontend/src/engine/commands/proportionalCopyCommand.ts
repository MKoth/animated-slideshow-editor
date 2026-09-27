import type { Engine } from '../internal'
import type { Command } from './command'
import { requireString, requireFiniteNumber } from '../guards'
import { requireAnimationProperty } from '../animationProperties'
import type { AnimationProperty } from '../animationProperties'
import { Keyframe as KeyframeModel, newKeyframeId } from '../keyframe'
import {
  collectProportionalCopyPlan,
  isValidNormWindow,
  mapProportionalCopyTangents,
  mapProportionalCopyTime,
  mapProportionalCopyValue,
  requireProportionalCopyMode,
} from '../proportionalCopy'
import type { ProportionalCopyBinding, ProportionalCopyMode } from '../proportionalCopy'

export interface ProportionalCopyCommandParameters {
  readonly sourceCollectionId: string
  readonly fromNorm: number
  readonly toNorm: number
  readonly bindings: readonly {
    readonly semanticName: string
    readonly channels: readonly string[]
  }[]
  readonly destCollectionIds: readonly string[]
  readonly mode: ProportionalCopyMode
  /** Time-reverse the copied span (default false when absent). */
  readonly reverse?: boolean
}

export interface ProportionalCopyCommandInverse {
  /** ClipJSON snapshots of every touched destination clip before the copy. */
  readonly before: readonly unknown[]
  /** ClipJSON snapshots of every touched destination clip after the copy. */
  readonly after: readonly unknown[]
}

function describeSkips(preview: {
  skippedLinked: number
  skippedMissingSemantic: number
  skippedMissingClip: number
  skippedSelf: number
}): string {
  const bits: string[] = []
  if (preview.skippedLinked > 0)
    bits.push(`${preview.skippedLinked} param-linked channel(s) skipped`)
  if (preview.skippedMissingSemantic > 0)
    bits.push(`${preview.skippedMissingSemantic} missing semantic binding(s) skipped`)
  if (preview.skippedMissingClip > 0)
    bits.push(`${preview.skippedMissingClip} missing clip(s) skipped`)
  if (preview.skippedSelf > 0) bits.push(`${preview.skippedSelf} self-copy channel(s) skipped`)
  return bits.join(' · ')
}

/**
 * Granular cross-collection copy: for each selected (semantic, channel), copy
 * the source clip's keyframes inside the normalized window onto the same
 * semantic's clip in every destination collection, replacing destination
 * keyframes inside the window. With reverse, times mirror inside the window
 * (end becomes start, composable with the spatial mirror modes). One undo step via before/after clip snapshots
 * (same pattern as ExtractToClip into an existing clip), so interpolation,
 * tangents, disabled and blend flags survive undo/redo bit-identically.
 */
export class ProportionalCopyCommand implements Command<ProportionalCopyCommandInverse> {
  readonly type = 'ProportionalCopy'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #sourceCollectionId: string
  readonly #fromNorm: number
  readonly #toNorm: number
  readonly #bindings: ProportionalCopyBinding[]
  readonly #destCollectionIds: string[]
  readonly #mode: ProportionalCopyMode
  readonly #reverse: boolean

  constructor(input: ProportionalCopyCommandParameters) {
    requireString(input.sourceCollectionId, 'sourceCollectionId')
    requireFiniteNumber(input.fromNorm, 'fromNorm')
    requireFiniteNumber(input.toNorm, 'toNorm')
    if (!isValidNormWindow(input.fromNorm, input.toNorm)) {
      throw new Error('Source range must be within [0, 1] with from < to')
    }
    if (!Array.isArray(input.bindings) || input.bindings.length === 0) {
      throw new Error('At least one semantic binding is required')
    }
    const bindings: ProportionalCopyBinding[] = input.bindings.map(
      (b: { readonly semanticName: string; readonly channels: readonly string[] }) => {
        requireString(b.semanticName, 'semanticName')
        if (b.semanticName.trim() === '') throw new Error('Binding key must be non-empty string')
        if (!Array.isArray(b.channels) || b.channels.length === 0) {
          throw new Error(`Binding "${b.semanticName}" must list at least one channel`)
        }
        const channels: AnimationProperty[] = b.channels.map((c) => requireAnimationProperty(c))
        return { semanticName: b.semanticName.trim(), channels }
      },
    )
    if (!Array.isArray(input.destCollectionIds) || input.destCollectionIds.length === 0) {
      throw new Error('At least one destination collection is required')
    }
    for (const id of input.destCollectionIds) requireString(id, 'destCollectionId')
    const mode = requireProportionalCopyMode(input.mode)
    if (input.reverse !== undefined && typeof input.reverse !== 'boolean') {
      throw new Error('reverse must be a boolean')
    }
    const reverse = input.reverse ?? false
    this.#sourceCollectionId = input.sourceCollectionId
    this.#fromNorm = input.fromNorm
    this.#toNorm = input.toNorm
    this.#bindings = bindings
    this.#destCollectionIds = [...input.destCollectionIds]
    this.#mode = mode
    this.#reverse = reverse
    this.parameters = {
      sourceCollectionId: input.sourceCollectionId,
      fromNorm: input.fromNorm,
      toNorm: input.toNorm,
      bindings: bindings.map((b) => ({ semanticName: b.semanticName, channels: [...b.channels] })),
      destCollectionIds: [...input.destCollectionIds],
      mode,
      reverse,
    }
  }

  validate(engine: Engine): void {
    if (!engine.project) throw new Error('No project exists in memory')
    engine.getClipCollection(this.#sourceCollectionId)
    for (const destId of new Set(this.#destCollectionIds)) {
      engine.getClipCollection(destId)
    }
  }

  execute(engine: Engine): ProportionalCopyCommandInverse {
    const plan = collectProportionalCopyPlan(engine, {
      sourceCollectionId: this.#sourceCollectionId,
      fromNorm: this.#fromNorm,
      toNorm: this.#toNorm,
      bindings: this.#bindings,
      destCollectionIds: this.#destCollectionIds,
      mode: this.#mode,
      reverse: this.#reverse,
    })
    if (plan.ops.length === 0) {
      const skips = describeSkips(plan.preview)
      throw new Error(
        `Nothing to copy — selected source tracks have no keyframes in the range${skips ? ` (${skips})` : ''}`,
      )
    }
    const touchedClipIds = [...new Set(plan.ops.map((op) => op.destClipId))]
    const before = touchedClipIds.map((id) => engine.getClip(id).toJSON())
    for (const op of plan.ops) {
      if (op.destReplaceIds.length > 0) {
        engine.deleteClipChannelKeyframes(op.destClipId, op.channel, op.destReplaceIds)
      }
      if (!engine.getClip(op.destClipId).hasChannel(op.channel)) {
        engine.addClipChannel(op.destClipId, { property: op.channel })
      }
      const destClip = engine.getClip(op.destClipId)
      for (const src of op.sourceKeyframes) {
        const tangents = mapProportionalCopyTangents(
          src.tangentIn,
          src.tangentOut,
          src.interpolation,
          op.negate,
          op.reverse,
        )
        const kf = new KeyframeModel(
          newKeyframeId(),
          mapProportionalCopyTime(src.time, this.#fromNorm, this.#toNorm, op.reverse),
          mapProportionalCopyValue(src.value, op.negate),
          src.interpolation,
          tangents.tangentIn,
          tangents.tangentOut,
          src.disabled,
          [...src.blend],
        )
        // Direct insertion preserves full keyframe data (interpolation,
        // tangents, disabled, blend); the manager-level add would not.
        destClip.addChannelKeyframe(op.channel, kf)
        engine.emitKeyframeAdded(
          { kind: 'clip', clipId: op.destClipId, channel: op.channel },
          kf.id,
        )
      }
      engine.emitClipChanged(op.destClipId)
    }
    const after = touchedClipIds.map((id) => engine.getClip(id).toJSON())
    return { before, after }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
