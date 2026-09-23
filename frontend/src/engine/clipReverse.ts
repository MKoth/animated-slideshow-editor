import { ClipDefinition, newClipId } from './clipDefinition'
import { ClipChannelAnimation } from './clipDefinition'
import {
  Keyframe as KeyframeModel,
  newKeyframeId,
  ZERO_TANGENT,
  isParametricInterpolation,
} from './keyframe'

function isParametricAnimation(anim: ClipChannelAnimation): boolean {
  for (const kf of anim.keyframes()) {
    if (isParametricInterpolation(kf.interpolation)) return true
  }
  return false
}

const HOLD_REVERSE_EPS = 1e-9

/** Snap `1 - t` float dust (e.g. `1 - 0.8 = 0.19999999999999996`) back to clean clip times. */
function snapHoldTime(time: number): number {
  return Math.round(time * 1e9) / 1e9
}

/**
 * Time-reverse a forward-hold lane (visible, zIndex) so its hold segments
 * play back in reverse order.
 *
 * A naive `t' = 1 - t` mirror keeps each value on the wrong segment: with
 * source keys `(0, 1), (0.8, 2)` the naive mirror holds 2 across almost the
 * whole clip, while the true reverse holds 2 on `[0, 0.2)` then 1. The
 * correct reversed keys are `0 -> last value` (unless the source already
 * ends at 1) plus `1 - t[i] -> value[i - 1]` for every later source key,
 * i.e. each reversed segment `[1 - t[i+1], 1 - t[i])` carries `value[i]`.
 *
 * Approximation note: a source key exactly at `t = 1` contributes its value
 * only at the single instant `u = 0`, which forward-hold keys cannot express
 * (duplicate times are rejected outside `t = 1`), so that leading instant is
 * dropped. Everything else is exact, and the transform round-trips whenever
 * the source does not end exactly at 1.
 */
export function reverseHoldAnimation(source: ClipChannelAnimation): ClipChannelAnimation {
  const dest = new ClipChannelAnimation()
  const kfs = source.keyframes()
  if (kfs.length === 0) return dest
  if (kfs.length === 1) {
    const only = kfs[0]!
    dest.add(
      new KeyframeModel(
        newKeyframeId(),
        0,
        only.value,
        only.interpolation,
        { ...ZERO_TANGENT },
        { ...ZERO_TANGENT },
        only.disabled,
        [...only.blend],
      ),
    )
    return dest
  }
  const last = kfs[kfs.length - 1]!
  if (last.time < 1 - HOLD_REVERSE_EPS) {
    dest.add(
      new KeyframeModel(
        newKeyframeId(),
        0,
        last.value,
        last.interpolation,
        { ...ZERO_TANGENT },
        { ...ZERO_TANGENT },
        last.disabled,
        [...last.blend],
      ),
    )
  }
  for (let i = 1; i < kfs.length; i += 1) {
    const prev = kfs[i - 1]!
    dest.add(
      new KeyframeModel(
        newKeyframeId(),
        snapHoldTime(1 - kfs[i]!.time),
        prev.value,
        prev.interpolation,
        { ...ZERO_TANGENT },
        { ...ZERO_TANGENT },
        prev.disabled,
        [...prev.blend],
      ),
    )
  }
  return dest
}

function reverseAnimation(
  source: ClipChannelAnimation,
  shouldMirror: boolean,
): ClipChannelAnimation {
  const dest = new ClipChannelAnimation()
  const kfs = source.keyframes()
  if (kfs.length === 0) return dest
  const parametric = isParametricAnimation(source)
  // If parametric channel and we decide not to mirror, just copy with new ids
  if (parametric && !shouldMirror) {
    // Keep times as is (not mirrored), but still new ids
    for (const kf of kfs) {
      dest.add(
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
    return dest
  }
  // For non-parametric or mirrored parametric (if we choose to mirror), do time mirror + tangent swap
  for (const kf of kfs) {
    const newTime = 1 - kf.time
    let tangentIn = ZERO_TANGENT
    let tangentOut = ZERO_TANGENT
    if (kf.interpolation === 'bezier') {
      tangentIn = { time: -kf.tangentOut.time, value: -kf.tangentOut.value }
      tangentOut = { time: -kf.tangentIn.time, value: -kf.tangentIn.value }
    } else {
      // hold/linear keep zero
      tangentIn = ZERO_TANGENT
      tangentOut = ZERO_TANGENT
    }
    // For parametric when mirroring (not used currently), keep interpolation but tangents zero
    if (isParametricInterpolation(kf.interpolation)) {
      tangentIn = ZERO_TANGENT
      tangentOut = ZERO_TANGENT
    }
    dest.add(
      new KeyframeModel(
        newKeyframeId(),
        newTime,
        kf.value,
        kf.interpolation,
        tangentIn,
        tangentOut,
      ),
    )
  }
  return dest
}

/**
 * Create a reversed copy of a clip.
 * - duration unchanged
 * - new name default "<original> Reversed"
 * - for non-parametric channels: t' = 1 - t, value unchanged, hold/linear preserved, bezier tangents swapped+negated
 * - for parametric channels: keep times (no mirror) and rely on evaluator 1-u; also keep isReversed flag
 * - visible/zIndex are forward-hold lanes: reversed with {@link reverseHoldAnimation}
 *   so hold segments play back in reverse order (naive t' = 1 - t keeps each
 *   value on the wrong segment)
 */
export function createReversedClipDefinition(
  source: ClipDefinition,
  newName?: string,
): ClipDefinition {
  const name = newName ?? `${source.name} Reversed`
  const reversed = new ClipDefinition(
    newClipId(),
    name,
    source.duration,
    source.category,
    [...source.params],
    [...source.channels],
    true, // isReversed
  )

  // channel animations
  for (const ch of source.channels) {
    if (ch.materialParameter) {
      const srcAnim = source.materialChannelAnimation(ch.materialParameter)
      if (!srcAnim || srcAnim.length === 0) continue
      const isParametric = isParametricAnimation(srcAnim)
      const shouldMirror = !isParametric // mirror only non-parametric
      const revAnim = reverseAnimation(srcAnim, shouldMirror)
      for (const kf of revAnim.keyframes()) {
        reversed.addMaterialChannelKeyframe(ch.materialParameter, kf)
      }
    } else {
      const srcAnim = source.channelAnimation(ch.property)
      if (!srcAnim || srcAnim.length === 0) continue
      const isParametric = isParametricAnimation(srcAnim)
      const shouldMirror = !isParametric
      const revAnim = reverseAnimation(srcAnim, shouldMirror)
      for (const kf of revAnim.keyframes()) {
        reversed.addChannelKeyframe(ch.property, kf)
      }
    }
  }

  // visible (forward-hold: segments play back in reverse order, not naive t' = 1 - t)
  const visibleAnim = source.visibleAnimation()
  if (visibleAnim.length > 0) {
    const rev = reverseHoldAnimation(visibleAnim)
    for (const kf of rev.keyframes()) reversed.addVisibleKeyframe(kf)
  }

  // zIndex (hold-only, same hold-correct reversal as visible)
  const zIndexAnim = source.zIndexAnimation()
  if (zIndexAnim.length > 0) {
    const rev = reverseHoldAnimation(zIndexAnim)
    for (const kf of rev.keyframes()) reversed.addZIndexKeyframe(kf)
  }

  // circle
  for (const prop of source.circleTrackKeys) {
    const srcAnim = source.circleAnimation(prop)
    if (!srcAnim || srcAnim.length === 0) continue
    const isParametric = isParametricAnimation(srcAnim)
    const shouldMirror = !isParametric
    const rev = reverseAnimation(srcAnim, shouldMirror)
    for (const kf of rev.keyframes()) reversed.addCircleKeyframe(prop, kf)
  }

  // morph
  const morphSrc = source.morphAnimation()
  if (morphSrc.length > 0) {
    const isParametric = isParametricAnimation(morphSrc)
    const shouldMirror = !isParametric
    const rev = reverseAnimation(morphSrc, shouldMirror)
    for (const kf of rev.keyframes()) reversed.addMorphKeyframe(kf)
  }

  // shadow
  for (const prop of source.shadowChannelKeys) {
    const srcAnim = source.shadowChannelAnimation(prop)
    if (!srcAnim || srcAnim.length === 0) continue
    const isParametric = isParametricAnimation(srcAnim)
    const shouldMirror = !isParametric
    const rev = reverseAnimation(srcAnim, shouldMirror)
    for (const kf of rev.keyframes()) reversed.addShadowChannelKeyframe(prop, kf)
  }

  return reversed
}

/**
 * Helper to check if a clip has any parametric keyframe
 */
export function clipHasParametric(clip: ClipDefinition): boolean {
  for (const ch of clip.channels) {
    if (ch.materialParameter) {
      const anim = clip.materialChannelAnimation(ch.materialParameter)
      if (anim && isParametricAnimation(anim)) return true
    } else {
      const anim = clip.channelAnimation(ch.property)
      if (anim && isParametricAnimation(anim)) return true
    }
  }
  const v = clip.visibleAnimation()
  if (v.length > 0 && isParametricAnimation(v)) return true
  const z = clip.zIndexAnimation()
  if (z.length > 0 && isParametricAnimation(z)) return true
  for (const k of clip.circleTrackKeys) {
    const anim = clip.circleAnimation(k)
    if (anim && isParametricAnimation(anim)) return true
  }
  const m = clip.morphAnimation()
  if (m.length > 0 && isParametricAnimation(m)) return true
  for (const k of clip.shadowChannelKeys) {
    const anim = clip.shadowChannelAnimation(k)
    if (anim && isParametricAnimation(anim)) return true
  }
  return false
}
