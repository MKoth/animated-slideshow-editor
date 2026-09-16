import { ClipDefinition, newClipId } from './clipDefinition'
import type { ClipChannel } from './clipDefinition'
import { ClipChannelAnimation } from './clipDefinition'
import { Keyframe as KeyframeModel, newKeyframeId } from './keyframe'
import type { KeyframeValue } from './keyframe'
import { normalizeAzimuth } from './shadowEffect'
import type { ShadowProperty } from './shadowEffect'

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
 * Collection-level default name: same "<original> Mirrored (X)" format as
 * single clips (issue #356). Kept as a separate export so collection surfaces
 * do not depend on the clip naming helper by accident.
 */
export function mirrorCollectionDefaultName(sourceName: string, axis: MirrorAxis): string {
  requireMirrorAxis(axis)
  return mirrorClipDefaultName(sourceName, axis)
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Swap delimiter-prefixed lateral markers (`_L`/`_R`, `.L`/`.R`) only when
 * not followed by a letter, so `_Left` is left for the word rule instead of
 * becoming `_Reft`, while `arm_L`, `arm_L_end`, and `arm.L` still swap.
 */
function swapDelimitedMarker(source: string, delimiter: '_' | '.'): string {
  const d = escapeRegExp(delimiter)
  const pattern = new RegExp(`${d}L(?![A-Za-z])|${d}R(?![A-Za-z])`, 'g')
  return source.replace(pattern, (match) =>
    match === `${delimiter}L` ? `${delimiter}R` : `${delimiter}L`,
  )
}

/**
 * Lateral Semantic Name swap (issue #356).
 *
 * Exact-match involution over the common bilateral conventions: `_L`/`_R`
 * and `.L`/`.R` (delimiter + letter, swapped wherever they occur), plus the
 * `left`/`right` words matched as whole tokens — delimited by `_`, `.`, `-`,
 * whitespace, string boundaries, or camelCase transitions — in lower,
 * capitalized, and upper casing. `left_hand`, `LeftArm`, `armLeft`, and
 * `LEFT_HAND` all mirror; `leftover`, `highlight`, `torso`, and `head` pass
 * through unchanged so unexpected renames never silently rewire a rig.
 *
 * The function is its own inverse: `swap(swap(x)) === x`, so distinct source
 * keys always map to distinct mirrored keys and shared-clip collections can
 * exchange both sides without collisions.
 */
export function swapLateralSemanticName(name: string): string {
  let result = name
  result = swapDelimitedMarker(result, '_')
  result = swapDelimitedMarker(result, '.')
  return swapLeftRightWords(result)
}

/** Swap a whole token, preserving lower/Capitalized/UPPER casing. */
function swapLeftRightToken(token: string): string {
  const lower = token.toLowerCase()
  const target = lower === 'left' ? 'right' : 'left'
  if (token === token.toUpperCase()) return target.toUpperCase()
  if (
    token.length > 0 &&
    token[0] === token[0]!.toUpperCase() &&
    token.slice(1) === token.slice(1).toLowerCase()
  ) {
    return target[0]!.toUpperCase() + target.slice(1)
  }
  return target
}

function swapLeftRightWords(name: string): string {
  return name
    .split(/([_.\-\s]+)/g)
    .map((part) => {
      if (part === '' || /^[_.\-\s]+$/.test(part)) return part
      return part
        .split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)
        .map((word) => {
          const lower = word.toLowerCase()
          if (lower !== 'left' && lower !== 'right') return word
          return swapLeftRightToken(word)
        })
        .join('')
    })
    .join('')
}

export interface MirrorSwapPreviewEntry {
  readonly source: string
  readonly mirrored: string
  readonly swapped: boolean
}

/**
 * Preview model for the Mirror confirm dialog: one entry per source binding
 * key in input order, with `swapped=false` for unpaired pass-through names.
 * Accepts a bindings record, a bindings map, or a plain key list so engine,
 * command, and UI layers can share one implementation.
 */
export function buildMirrorSwapPreview(
  keys: Record<string, string> | ReadonlyMap<string, string> | readonly string[],
): readonly MirrorSwapPreviewEntry[] {
  const names: string[] = Array.isArray(keys)
    ? [...keys]
    : keys instanceof Map
      ? [...keys.keys()]
      : Object.keys(keys)
  return names.map((source) => {
    const mirrored = swapLateralSemanticName(source)
    return { source, mirrored, swapped: mirrored !== source }
  })
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
 * Shadow light-azimuth mirror (issue #358).
 *
 * X-mirror maps azimuth to 180−azimuth (normalized to 0–360): cos flips sign
 * while sin is preserved, so the re-derived projection negates offsetX and
 * keeps offsetY — the same side-switch as negating a manual offsetX.
 * Y-mirror maps azimuth to −azimuth (normalized to 0–360): sin flips sign
 * while cos is preserved, so the re-derived projection negates offsetY and
 * keeps offsetX. Both use {@link normalizeAzimuth} for the 0–360 range.
 */
export function mirrorShadowAzimuth(value: number, axis: MirrorAxis): number {
  requireMirrorAxis(axis)
  return normalizeAzimuth(axis === 'X' ? 180 - value : -value)
}

/**
 * Shadow angle mirror (issue #358): negate a manual rotation/skew value and
 * wrap it into (−180, 180], matching the projection's own normalization so
 * mirrored slants lean the mirrored way without 360° jumps.
 */
export function mirrorShadowAngle(value: number): number {
  const negated = -value || 0
  if (negated > 180 || negated <= -180) {
    return ((((negated + 180) % 360) + 360) % 360) - 180
  }
  return negated
}

/**
 * Whether a shadow lane carries the auto-derived light direction. A clip with
 * a lightAzimuth lane mirrors via the azimuth only and lets the projection
 * re-derive downstream; otherwise it is a manual clip and mirrors via the
 * raw offset/rotation/skew values. Either way there is exactly one mirroring
 * path per lane — never a double application.
 */
function isAutoShadowClip(source: ClipDefinition): boolean {
  return (source.shadowChannelAnimation('lightAzimuth')?.length ?? 0) > 0
}

/**
 * Mirror one shadow lane with a value map: fresh keyframe ids, same times and
 * interpolation kinds, tangent time-components kept while tangent
 * value-components are negated exactly when `negateTangents` says so.
 * Session flags (disabled, blend) are preserved.
 */
function mapShadowLane(
  source: ClipChannelAnimation,
  mapValue: (value: KeyframeValue) => KeyframeValue,
  negateTangents: (value: KeyframeValue) => boolean,
): ClipChannelAnimation {
  const dest = new ClipChannelAnimation()
  for (const kf of source.keyframes()) {
    const negate = negateTangents(kf.value)
    dest.add(
      new KeyframeModel(
        newKeyframeId(),
        kf.time,
        mapValue(kf.value),
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

/**
 * Mirror one azimuth lane: values map through {@link mirrorShadowAzimuth}
 * while tangent value-components are negated (the map has derivative −1).
 */
function mirrorShadowAzimuthAnimation(
  source: ClipChannelAnimation,
  axis: MirrorAxis,
): ClipChannelAnimation {
  return mapShadowLane(
    source,
    (value) => (typeof value === 'number' ? mirrorShadowAzimuth(value, axis) : value),
    () => true,
  )
}

/**
 * Mirror one manual angle lane (rotation/skewX/skewY): values negate with
 * {@link mirrorShadowAngle} normalization. Non-numeric values (never expected
 * here) pass through with preserved tangents.
 */
function mirrorShadowAngleAnimation(source: ClipChannelAnimation): ClipChannelAnimation {
  return mapShadowLane(
    source,
    (value) => (typeof value === 'number' ? mirrorShadowAngle(value) : value),
    (value) => typeof value === 'number',
  )
}

/** Mirror one shadow lane by property name (issue #358 value table). */
function mirrorShadowAnimation(
  source: ClipDefinition,
  prop: ShadowProperty,
  axis: MirrorAxis,
  isAuto: boolean,
): ClipChannelAnimation | undefined {
  const srcAnim = source.shadowChannelAnimation(prop)
  if (!srcAnim || srcAnim.length === 0) return undefined
  if (prop === 'lightAzimuth') {
    return mirrorShadowAzimuthAnimation(srcAnim, axis)
  }
  if (isAuto) {
    // Auto-derived mode: the raw projection re-derives from the mirrored
    // azimuth downstream, so raw lanes pass through with no double application.
    return mirrorAnimation(srcAnim, false)
  }
  if (prop === 'offsetX') return mirrorAnimation(srcAnim, axis === 'X')
  if (prop === 'offsetY') return mirrorAnimation(srcAnim, axis === 'Y')
  if (prop === 'rotation' || prop === 'skewX' || prop === 'skewY') {
    return mirrorShadowAngleAnimation(srcAnim)
  }
  // Scales are never negated (silhouette flip stays behind the dedicated
  // mirror flag); blur, opacity, color, elevation, distance, and the
  // unaffected-axis offset pass through unchanged.
  return mirrorAnimation(srcAnim, false)
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
 * - visible, zIndex, symmetry-lane, material, and morph tracks pass through
 *   unchanged (morph geometry auto-mirror lands in #357)
 * - shadow lanes mirror by direction (issue #358): X-mirror negates offsetX
 *   (Y-mirror negates offsetY), rotation/skews negate with angular
 *   normalization, light azimuth maps to 180−azimuth on X (−azimuth on Y,
 *   both normalized to 0–360); auto clips (lightAzimuth lane present) mirror
 *   via the azimuth only while raw lanes pass through for the projection to
 *   re-derive, manual clips mirror via the raw values; scales are never
 *   negated and blur/opacity/color/elevation/distance plus the
 *   unaffected-axis offset are unchanged
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

  const autoShadow = isAutoShadowClip(source)
  for (const prop of source.shadowChannelKeys) {
    const mirroredAnim = mirrorShadowAnimation(source, prop, axis, autoShadow)
    if (!mirroredAnim) continue
    for (const kf of mirroredAnim.keyframes()) {
      mirrored.addShadowChannelKeyframe(prop, kf)
    }
  }

  // out of scope for v1: skipped with a visible notice, left on the original
  const skipped = mirrorSkippedNotices(source)

  return { clip: mirrored, skipped }
}
