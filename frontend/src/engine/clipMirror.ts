import { ClipDefinition, newClipId } from './clipDefinition'
import type { ClipChannel } from './clipDefinition'
import { ClipChannelAnimation } from './clipDefinition'
import { Keyframe as KeyframeModel, newKeyframeId } from './keyframe'
import type { KeyframeValue } from './keyframe'

/**
 * Spatial mirror axis for Mirror-and-Save (issue #355).
 * X = left-right mirror, Y = top-bottom mirror.
 */
export type MirrorAxis = 'X' | 'Y'

export function requireMirrorAxis(value: unknown): MirrorAxis {
  if (value === 'X' || value === 'Y') return value
  throw new Error(`Unknown mirror axis: ${String(value)} (expected 'X' or 'Y')`)
}

export function mirrorClipDefaultName(sourceName: string, axis: MirrorAxis): string {
  return `${sourceName} Mirrored (${axis})`
}

/**
 * Value-negation table (X-mirror; Y swaps the position roles).
 * Rotation is always negated; scales, opacity, and the untouched axis never are.
 * Gain/offset-linked channels follow the same table: the stored channel
 * keyframes are negated while parameter definitions and defaults stay stable.
 */
export function mirrorNegatesChannel(property: ClipChannel, axis: MirrorAxis): boolean {
  if (property === 'rotation') return true
  if (axis === 'X') return property === 'positionX'
  return property === 'positionY'
}

function mirrorValue(value: KeyframeValue, negate: boolean): KeyframeValue {
  if (!negate) return value
  if (typeof value === 'number') return -value || 0
  return value
}

function negateTangentComponent(value: number, negate: boolean): number {
  if (!negate) return value
  // Normalize -0 to 0 so mirrored zero tangents stay deep-equal to the source
  return -value || 0
}

/**
 * Mirror one channel animation: same keyframe times and interpolation kinds
 * (hold/linear/bezier preserved verbatim; parametric bounce/elastic/spring
 * evaluated at the same normalized position with negated output), fresh ids,
 * bezier tangent time-components kept while tangent value-components are
 * negated exactly when the channel value is negated. Session flags
 * (disabled, blend) are preserved.
 */
function mirrorAnimation(source: ClipChannelAnimation, negate: boolean): ClipChannelAnimation {
  const dest = new ClipChannelAnimation()
  for (const kf of source.keyframes()) {
    dest.add(
      new KeyframeModel(
        newKeyframeId(),
        kf.time,
        mirrorValue(kf.value, negate),
        kf.interpolation,
        {
          time: kf.tangentIn.time,
          value: negateTangentComponent(kf.tangentIn.value, negate),
        },
        {
          time: kf.tangentOut.time,
          value: negateTangentComponent(kf.tangentOut.value, negate),
        },
        kf.disabled,
        [...kf.blend],
      ),
    )
  }
  return dest
}

export interface MirroredClipResult {
  readonly clip: ClipDefinition
  /**
   * Human-readable skip notices for lanes out of scope in v1
   * (circle/table). Shown in the confirm dialog — never silently dropped.
   */
  readonly skipped: readonly string[]
}

/**
 * Single source of truth for circle/table skip notices: only lanes that
 * actually hold keyframes are reported, so empty lanes are never flagged.
 */
export function mirrorSkippedNotices(source: ClipDefinition): readonly string[] {
  const skipped: string[] = []
  for (const prop of source.circleTrackKeys) {
    const count = source.circleAnimation(prop)?.length ?? 0
    if (count === 0) continue
    skipped.push(
      `Circle lane "${prop}" (${count} keyframe${count === 1 ? '' : 's'}) was not mirrored — circle tracks are out of scope for mirror v1 and stay unchanged on the original.`,
    )
  }
  for (const prop of source.tableTrackKeys) {
    const count = source.tableAnimation(prop)?.length ?? 0
    if (count === 0) continue
    skipped.push(
      `Table lane "${prop}" (${count} keyframe${count === 1 ? '' : 's'}) was not mirrored — table tracks are out of scope for mirror v1 and stay unchanged on the original.`,
    )
  }
  return skipped
}

/**
 * Create a spatially mirrored copy of a clip.
 * - new identity, `isReversed=false`, keyframe times untouched
 * - duration, category, channel list, and parameter definitions preserved
 * - visible, zIndex, symmetry-lane, material, morph, and shadow tracks pass
 *   through unchanged (shadow direction mirroring lands in #358; morph
 *   geometry auto-mirror lands in #357)
 * - circle/table lanes are skipped with a visible notice (out of scope v1)
 * - bone (no opacity) and camera (no rotation) constraints are respected by
 *   preserving the channel list: no channels are added or removed, opacity is
 *   never negated, and rotation mirrors only where present
 */
export function createMirroredClipDefinition(
  source: ClipDefinition,
  axis: MirrorAxis,
  newName?: string,
): MirroredClipResult {
  requireMirrorAxis(axis)
  const name = newName ?? mirrorClipDefaultName(source.name, axis)
  const mirrored = new ClipDefinition(
    newClipId(),
    name,
    source.duration,
    source.category,
    [...source.params],
    [...source.channels],
    false, // isReversed
  )

  // uniform-six channels (incl. gain/offset-linked: stored keyframes negated)
  for (const ch of source.channels) {
    if (ch.materialParameter) {
      const srcAnim = source.materialChannelAnimation(ch.materialParameter)
      if (!srcAnim || srcAnim.length === 0) continue
      for (const kf of mirrorAnimation(srcAnim, false).keyframes()) {
        mirrored.addMaterialChannelKeyframe(ch.materialParameter, kf)
      }
    } else {
      const srcAnim = source.channelAnimation(ch.property)
      if (!srcAnim || srcAnim.length === 0) continue
      const negate = mirrorNegatesChannel(ch.property, axis)
      for (const kf of mirrorAnimation(srcAnim, negate).keyframes()) {
        mirrored.addChannelKeyframe(ch.property, kf)
      }
    }
  }

  // pass-through lanes: copied bit-identically (fresh ids, same times/values)
  const visibleAnim = source.visibleAnimation()
  if (visibleAnim.length > 0) {
    for (const kf of mirrorAnimation(visibleAnim, false).keyframes()) {
      mirrored.addVisibleKeyframe(kf)
    }
  }

  const zIndexAnim = source.zIndexAnimation()
  if (zIndexAnim.length > 0) {
    for (const kf of mirrorAnimation(zIndexAnim, false).keyframes()) {
      mirrored.addZIndexKeyframe(kf)
    }
  }

  const symmetryAnim = source.symmetryAnimation()
  if (symmetryAnim.length > 0) {
    for (const kf of mirrorAnimation(symmetryAnim, false).keyframes()) {
      mirrored.addSymmetryKeyframe(kf)
    }
  }

  const morphSrc = source.morphAnimation()
  if (morphSrc.length > 0) {
    for (const kf of mirrorAnimation(morphSrc, false).keyframes()) {
      mirrored.addMorphKeyframe(kf)
    }
  }

  for (const prop of source.shadowChannelKeys) {
    const srcAnim = source.shadowChannelAnimation(prop)
    if (!srcAnim || srcAnim.length === 0) continue
    for (const kf of mirrorAnimation(srcAnim, false).keyframes()) {
      mirrored.addShadowChannelKeyframe(prop, kf)
    }
  }

  // out of scope for v1: skipped with a visible notice, left on the original
  const skipped = mirrorSkippedNotices(source)

  return { clip: mirrored, skipped }
}
