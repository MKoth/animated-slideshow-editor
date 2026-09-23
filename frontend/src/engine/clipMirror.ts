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

/**
 * Mirror one morph lane (issue #357): times, coefficients, interpolation
 * kinds, and tangents are copied verbatim (fresh ids, same disabled/blend);
 * only the lateral shape-name pair is remapped through the same
 * left↔right dictionary as collection bindings, so lateralized morphs land
 * on the correct side of mirrored geometry. Unpaired names, nulls, and
 * legacy numeric scalars pass through unchanged.
 */
function mirrorMorphShapeName(name: string | null): string | null {
  if (name === null) return null
  return swapLateralSemanticName(name)
}

function mirrorMorphKeyframeValue(value: KeyframeValue, preserveNames = false): KeyframeValue {
  if (typeof value === 'number') return value
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const rec = value as unknown as Record<string, unknown>
    // Name-based clip values (canonical): remap lateral pairs, keep
    // everything else (coefficient and any future fields) verbatim.
    // Note: id-based legacy values also carry `coefficient`, so the name
    // path must key on the name fields themselves — never on `coefficient`.
    // Reverse+mirror passes preserveNames so a "turn left" morph stays
    // "turn left" — only the symmetry bracket mirrors playback.
    if ('fromShapeName' in rec || 'toShapeName' in rec) {
      const remap = preserveNames ? (n: string | null) => n : mirrorMorphShapeName
      const mirrorPath = (p: unknown): unknown => {
        if (preserveNames) return p
        if (p === undefined || p === null) return p
        if (Array.isArray(p)) {
          return p.map((seg) => (typeof seg === 'string' ? mirrorMorphShapeName(seg) : seg))
        }
        return p
      }
      return {
        ...(rec as object),
        fromShapeName: remap((rec.fromShapeName as string | null) ?? null),
        toShapeName: remap((rec.toShapeName as string | null) ?? null),
        ...('fromCategoryPath' in rec
          ? { fromCategoryPath: mirrorPath(rec.fromCategoryPath) }
          : {}),
        ...('toCategoryPath' in rec ? { toCategoryPath: mirrorPath(rec.toCategoryPath) } : {}),
      } as unknown as KeyframeValue
    }
    // Legacy id-based objects reference node-local random ids (kept stable
    // by mirrorMorphGeometry's same-ids invariant), so they pass through
    // verbatim — the lateral dictionary applies to names only.
  }
  return value
}

function mirrorMorphAnimation(
  source: ClipChannelAnimation,
  preserveNames = false,
): ClipChannelAnimation {
  const dest = new ClipChannelAnimation()
  for (const kf of source.keyframes()) {
    dest.add(
      new KeyframeModel(
        newKeyframeId(),
        kf.time,
        mirrorMorphKeyframeValue(kf.value, preserveNames),
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

/**
 * Index-preserving morph-geometry auto-mirror (issue #357).
 *
 * Mirrors rest vertices plus every Shape's vertices (same ids, names, order;
 * face winding corrected once on the shared topology) so verbatim-copied
 * morph coefficient curves keep resolving on mirrored geometry instead of
 * falling back to the base mesh. The mirror operator commutes with the morph
 * lerp, so `lerp(mirroredA, mirroredB, t) == mirror(lerp(A, B, t))`.
 *
 * UVs stay attached to their vertices (no UV mirror — reflecting the geometry
 * already reflects the sampled image with it, matching SymmetrizeSubtree).
 * Bone weights and bind pose are preserved (same per-vertex indices).
 * `-0` is normalized to `0` so double-mirroring round-trips deep-equal.
 *
 * Vertex-count mismatches warn and leave that shape unmirrored (eval falls
 * back to base geometry per `resolveMorphedVertices`); the rest of the mesh
 * still mirrors and the call never throws for shape data.
 */
export interface MirroredMorphGeometry {
  readonly mesh: import('./mesh').MeshData
  readonly shapes: readonly import('./shape').Shape[]
  readonly warnings: readonly string[]
}

function negateMorphCoordinate(value: number): number {
  return -value || 0
}

function mirrorMorphPoint(
  v: { readonly x: number; readonly y: number },
  axis: MirrorAxis,
): { x: number; y: number } {
  return axis === 'X'
    ? { x: negateMorphCoordinate(v.x), y: v.y }
    : { x: v.x, y: negateMorphCoordinate(v.y) }
}

function mirrorBindPose(
  bindPose: NonNullable<import('./mesh').MeshData['bindPose']> | undefined,
  axis: MirrorAxis,
): NonNullable<import('./mesh').MeshData['bindPose']> | undefined {
  if (!bindPose) return undefined
  return Object.fromEntries(
    Object.entries(bindPose).map(([boneId, pose]) => [
      boneId,
      {
        ...pose,
        x: axis === 'X' ? negateMorphCoordinate(pose.x) : pose.x,
        y: axis === 'Y' ? negateMorphCoordinate(pose.y) : pose.y,
        rotation: negateMorphCoordinate(pose.rotation),
      },
    ]),
  )
}

export function mirrorMorphGeometry(
  mesh: import('./mesh').MeshData,
  shapes: readonly import('./shape').Shape[] | undefined,
  axis: MirrorAxis,
  opts?: { readonly nodeName?: string },
): MirroredMorphGeometry {
  requireMirrorAxis(axis)
  const warnings: string[] = []
  const label = opts?.nodeName ? ` on node "${opts.nodeName}"` : ''
  const vertices = mesh.vertices.map((v) => mirrorMorphPoint(v, axis))
  // Shared topology: flip winding once (v1↔v2), same as SymmetrizeSubtree.
  const faces = mesh.faces.map((f) => ({ v0: f.v0, v1: f.v2, v2: f.v1 }))
  const uvs = mesh.uvs.map((uv) => ({ u: uv.u, v: uv.v }))
  const mirroredMesh: import('./mesh').MeshData = {
    ...mesh,
    vertices,
    faces,
    uvs,
    ...(mesh.bindPose ? { bindPose: mirrorBindPose(mesh.bindPose, axis) } : {}),
  }
  const mirroredShapes: import('./shape').Shape[] = []
  for (const shape of shapes ?? []) {
    if (shape.vertices.length !== mesh.vertices.length) {
      const warning =
        `[morph-mirror] Shape "${shape.name}"${label} has ${shape.vertices.length} vertices ` +
        `but the mesh has ${mesh.vertices.length} — leaving it unmirrored; ` +
        `morphs fall back to base geometry`
      warnings.push(warning)
      console.warn(warning)
      mirroredShapes.push({
        id: shape.id,
        name: shape.name,
        categoryId: shape.categoryId ?? null,
        vertices: shape.vertices.map((v) => ({ x: v.x, y: v.y })),
      })
      continue
    }
    mirroredShapes.push({
      id: shape.id,
      name: shape.name,
      categoryId: shape.categoryId ?? null,
      vertices: shape.vertices.map((v) => mirrorMorphPoint(v, axis)),
    })
  }
  return { mesh: mirroredMesh, shapes: mirroredShapes, warnings }
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
 * Compact lane names behind {@link mirrorSkippedNotices}: only lanes that
 * actually hold keyframes are reported, so empty lanes are never flagged.
 * Shared by every Mirror confirm dialog so the preview cannot diverge from
 * the engine's skip decision.
 */
export function mirrorSkippedLaneNames(source: ClipDefinition): readonly string[] {
  if (mirrorSkippedNotices(source).length === 0) return []
  const names: string[] = []
  for (const prop of source.circleTrackKeys) {
    if ((source.circleAnimation(prop)?.length ?? 0) > 0) names.push(prop)
  }
  for (const prop of source.tableTrackKeys) {
    if ((source.tableAnimation(prop)?.length ?? 0) > 0) names.push(prop)
  }
  return names
}

/**
 * Union of {@link mirrorSkippedLaneNames} across a collection's member clips,
 * in first-seen order. Callers resolve ids to clips (skipping failures); the
 * lane-name decision itself stays in this module.
 */
export function collectMirrorSkippedLaneNames(clips: Iterable<ClipDefinition>): readonly string[] {
  const lanes: string[] = []
  const seen = new Set<string>()
  for (const clip of clips) {
    for (const name of mirrorSkippedLaneNames(clip)) {
      if (!seen.has(name)) {
        seen.add(name)
        lanes.push(name)
      }
    }
  }
  return lanes
}

/**
 * Create a spatially mirrored copy of a clip.
 * - new identity, `isReversed=false`, keyframe times untouched
 * - duration, category, channel list, and parameter definitions preserved
 * - visible, zIndex, symmetry-lane, and material tracks pass through
 *   unchanged; morph coefficient curves (times, coefficients, tangents,
 *   interpolation, disabled/blend) are copied verbatim with only the lateral
 *   shape-name pair remapped through the same left↔right dictionary as
 *   collection bindings (issue #357). Collection placement appends missing
 *   lateral Shape copies without replacing the target's existing geometry.
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
 * - `opts.preserveMorphNames` skips the lateral morph rename (used by
 *   reverse+mirror so shape names stay on their original side)
 */
export function createMirroredClipDefinition(
  source: ClipDefinition,
  axis: MirrorAxis,
  newName?: string,
  opts?: { preserveMorphNames?: boolean },
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
    source.isReversed, // temporal reversal survives the spatial mirror (reverse-then-mirror stays reversed)
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
    for (const kf of mirrorMorphAnimation(
      morphSrc,
      opts?.preserveMorphNames === true,
    ).keyframes()) {
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
