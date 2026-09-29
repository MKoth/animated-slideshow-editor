/**
 * Shadow tight bounds — single source of truth for Auto projection input.
 *
 * The Auto shadow projection (`deriveShadowProjection`) is a pure function of
 * (tight caster union w/h, anchor, light). It must NEVER consume the renderer's
 * grow-only RT envelope (`#shadowRenderBounds`): that feedback loop made the
 * same azimuth/elevation produce different offsets depending on drag history,
 * and made group moves look distorted until toggle-off/on cleared the cache.
 *
 * This helper computes the live tight union of silhouette-capable casters
 * (mesh | circle | assetInstance only — text/table/chart contribute no
 * silhouette pixels, so including them in the union detached bounds from
 * pixels). Both the renderer and the inspector use it, so display, snapshot,
 * and render agree.
 */

export interface ShadowWorldAabb {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface ShadowWorldTransform {
  x: number
  y: number
  rotation: number
  scaleX: number
  scaleY: number
}

export interface ShadowWorldSize {
  width: number
  height: number
  offsetX?: number
  offsetY?: number
}

interface CasterLike {
  id: string
  visible: boolean
  opacity: number
  components: Record<string, unknown>
  transform?: {
    localPivot?: { x: number; y: number } | null
  }
}

interface HostLike {
  id: string
  children: readonly unknown[]
}

export function isSilhouetteCaster(node: { components: Record<string, unknown> }): boolean {
  const c = node.components
  return Boolean(c.mesh || c.circle || c.assetInstance)
}

/**
 * World AABB of a size box under a world transform. Mirrors hitTest.aabbOf
 * exactly (pivot-aware): the world transform x/y is the PIVOT point, the box
 * spans [offset-half, offset+half] in local space, and corners are shifted by
 * -pivotOffset + offset before scale/rotate. The silhouette drawing uses the
 * same convention (verts minus pivotOffset), so the union and the drawn pixels
 * agree — otherwise the tight render target clips the silhouette and only a
 * fragment of the shadow survives.
 */
function worldAabbOfSize(
  size: ShadowWorldSize,
  t: ShadowWorldTransform,
  pivot?: { x: number; y: number } | null,
): ShadowWorldAabb | null {
  if (
    t.scaleX === 0 ||
    t.scaleY === 0 ||
    !Number.isFinite(t.scaleX) ||
    !Number.isFinite(t.scaleY)
  ) {
    return null
  }
  const pivotOffset = pivot ? { x: pivot.x * size.width, y: pivot.y * size.height } : { x: 0, y: 0 }
  const offsetX = size.offsetX ?? 0
  const offsetY = size.offsetY ?? 0
  const cos = Math.cos(t.rotation)
  const sin = Math.sin(t.rotation)
  // Box corners in center-relative coords; each maps to local space by
  // (+offset) then to pivot-relative space (minus pivotOffset), matching both
  // aabbOf and the silhouette vertex math ((v - pivotOffset) * scale + t).
  const local = (cx: number, cy: number) => ({
    x: (cx - pivotOffset.x + offsetX) * t.scaleX,
    y: (cy - pivotOffset.y + offsetY) * t.scaleY,
  })
  const half = { x: size.width / 2, y: size.height / 2 }
  const corners = [
    local(-half.x, -half.y),
    local(half.x, -half.y),
    local(half.x, half.y),
    local(-half.x, half.y),
  ].map((p) => ({
    x: t.x + p.x * cos - p.y * sin,
    y: t.y + p.x * sin + p.y * cos,
  }))
  return {
    minX: Math.min(...corners.map((c) => c.x)),
    minY: Math.min(...corners.map((c) => c.y)),
    maxX: Math.max(...corners.map((c) => c.x)),
    maxY: Math.max(...corners.map((c) => c.y)),
  }
}

export interface TightBoundsDeps {
  /** Filtered casters (already pruned by castShadow + renderable). */
  casters: CasterLike[]
  hostId: string
  time: number
  sizeOf: (nodeId: string) => ShadowWorldSize | null
  worldOf: (nodeId: string, time: number) => ShadowWorldTransform | null
  evaluatedOf: (nodeId: string, time: number) => { visible: boolean; opacity: number } | null
}

/**
 * Tight union of silhouette-capable, visible casters. Returns null when no
 * caster contributes pixels (empty group, all hidden, text-only group, …).
 */
export function tightCasterUnion(deps: TightBoundsDeps): ShadowWorldAabb | null {
  let union: ShadowWorldAabb | null = null
  for (const caster of deps.casters) {
    if (caster.id === deps.hostId) continue
    if (!isSilhouetteCaster(caster as { components: Record<string, unknown> })) continue
    let visible = caster.visible
    let opacity = caster.opacity
    try {
      const st = deps.evaluatedOf(caster.id, deps.time)
      if (st) {
        visible = st.visible
        opacity = st.opacity
      }
    } catch {
      // fall back to static flags
    }
    if (!visible || opacity <= 0.01) continue
    const size = deps.sizeOf(caster.id)
    if (!size) continue
    const world = deps.worldOf(caster.id, deps.time)
    if (!world) continue
    const aabb = worldAabbOfSize(size, world, caster.transform?.localPivot ?? null)
    if (!aabb) continue
    union = union
      ? {
          minX: Math.min(union.minX, aabb.minX),
          minY: Math.min(union.minY, aabb.minY),
          maxX: Math.max(union.maxX, aabb.maxX),
          maxY: Math.max(union.maxY, aabb.maxY),
        }
      : aabb
  }
  return union
}

export function tightBoundsSize(
  union: ShadowWorldAabb | null,
): { w: number; h: number } | undefined {
  if (!union) return undefined
  const w = union.maxX - union.minX
  const h = union.maxY - union.minY
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 0 || h < 0) return undefined
  return { w, h }
}

/**
 * Effective silhouette scale after the render texture size cap is applied.
 * Geometry and the texture must use the same scale or a clamped texture clips
 * the silhouette to its corner.
 */
export function shadowRenderScale(
  baseScale: number,
  width: number,
  height: number,
  cap: number,
): number {
  if (
    !Number.isFinite(baseScale) ||
    baseScale <= 0 ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 0 ||
    height < 0 ||
    !Number.isFinite(cap) ||
    cap <= 0
  ) {
    return 1
  }
  const unclamped = Math.max(width, height) * baseScale
  return baseScale * Math.min(1, cap / Math.max(1, unclamped))
}

export type { HostLike }
