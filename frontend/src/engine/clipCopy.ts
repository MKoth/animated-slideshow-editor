import { ClipDefinition, newClipId } from './clipDefinition'
import { ClipChannelAnimation } from './clipDefinition'
import { Keyframe as KeyframeModel, newKeyframeId } from './keyframe'
import type { KeyframeValue } from './keyframe'

function cloneValue(value: KeyframeValue): KeyframeValue {
  if (typeof value === 'object' && value !== null) {
    return JSON.parse(JSON.stringify(value)) as KeyframeValue
  }
  return value
}

function copyAnimation(source: ClipChannelAnimation): ClipChannelAnimation {
  const dest = new ClipChannelAnimation()
  for (const kf of source.keyframes()) {
    dest.add(
      new KeyframeModel(
        newKeyframeId(),
        kf.time,
        cloneValue(kf.value),
        kf.interpolation,
        { time: kf.tangentIn.time, value: kf.tangentIn.value },
        { time: kf.tangentOut.time, value: kf.tangentOut.value },
        kf.disabled,
        [...kf.blend],
      ),
    )
  }
  return dest
}

export function copyClipDefaultName(sourceName: string): string {
  return `${sourceName} Copy`
}

export function copyCollectionDefaultName(sourceName: string): string {
  return `${sourceName} Copy`
}

/**
 * Create an exact duplicate of a clip with new identity.
 * - new id, new name (default "<original> Copy")
 * - duration, category, params, channels preserved
 * - isReversed flag preserved (copy of a reversed clip stays reversed)
 * - all lanes copied verbatim with fresh keyframe ids:
 *   channels, material, visible, zIndex, circle, table, symmetry, morph, shadow
 */
export function createCopiedClipDefinition(
  source: ClipDefinition,
  newName?: string,
): ClipDefinition {
  const name = newName ?? copyClipDefaultName(source.name)
  const copied = new ClipDefinition(
    newClipId(),
    name,
    source.duration,
    source.category,
    source.params.map((p) => ({ ...p })),
    source.channels.map((ch) => ({ ...ch })),
    source.isReversed,
  )

  for (const ch of source.channels) {
    if (ch.materialParameter) {
      const srcAnim = source.materialChannelAnimation(ch.materialParameter)
      if (!srcAnim || srcAnim.length === 0) continue
      for (const kf of copyAnimation(srcAnim).keyframes()) {
        copied.addMaterialChannelKeyframe(ch.materialParameter, kf)
      }
    } else {
      const srcAnim = source.channelAnimation(ch.property)
      if (!srcAnim || srcAnim.length === 0) continue
      for (const kf of copyAnimation(srcAnim).keyframes()) {
        copied.addChannelKeyframe(ch.property, kf)
      }
    }
  }

  const visibleAnim = source.visibleAnimation()
  if (visibleAnim.length > 0) {
    for (const kf of copyAnimation(visibleAnim).keyframes()) copied.addVisibleKeyframe(kf)
  }

  const zIndexAnim = source.zIndexAnimation()
  if (zIndexAnim.length > 0) {
    for (const kf of copyAnimation(zIndexAnim).keyframes()) copied.addZIndexKeyframe(kf)
  }

  for (const prop of source.circleTrackKeys) {
    const srcAnim = source.circleAnimation(prop)
    if (!srcAnim || srcAnim.length === 0) continue
    for (const kf of copyAnimation(srcAnim).keyframes()) copied.addCircleKeyframe(prop, kf)
  }

  for (const prop of source.tableTrackKeys) {
    const srcAnim = source.tableAnimation(prop)
    if (!srcAnim || srcAnim.length === 0) continue
    for (const kf of copyAnimation(srcAnim).keyframes()) copied.addTableKeyframe(prop, kf)
  }

  const symmetryAnim = source.symmetryAnimation()
  if (symmetryAnim.length > 0) {
    for (const kf of copyAnimation(symmetryAnim).keyframes()) copied.addSymmetryKeyframe(kf)
  }

  const morphSrc = source.morphAnimation()
  if (morphSrc.length > 0) {
    for (const kf of copyAnimation(morphSrc).keyframes()) copied.addMorphKeyframe(kf)
  }

  for (const prop of source.shadowChannelKeys) {
    const srcAnim = source.shadowChannelAnimation(prop)
    if (!srcAnim || srcAnim.length === 0) continue
    for (const kf of copyAnimation(srcAnim).keyframes()) {
      copied.addShadowChannelKeyframe(prop, kf)
    }
  }

  return copied
}
