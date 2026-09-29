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
}

interface HostLike {
  id: string
  children: readonly unknown[]
}

export function isSilhouetteCaster(node: { components: Record<string, unknown> }): boolean {
  const c = node.components
  return Boolean(c.mesh || c.circle || c.assetInstance)
}

function worldAabbOfSize(size: ShadowWorldSize, t: ShadowWorldTransform): ShadowWorldAabb {
  const hw = (size.width * t.scaleX) / 2
  const hh = (size.height * t.scaleY) / 2
  const ox = (size.offsetX ?? 0) * t.scaleX
  const oy = (size.offsetY ?? 0) * t.scaleY
  const cos = Math.cos(t.rotation)
  const sin = Math.sin(t.rotation)
  const cx = t.x + ox * cos - oy * sin
  const cy = t.y + ox * sin + oy * cos
  const corners = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ].map((p) => ({
    x: cx + p.x * cos - p.y * sin,
    y: cy + p.x * sin + p.y * cos,
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
    const aabb = worldAabbOfSize(size, world)
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

export type { HostLike }
