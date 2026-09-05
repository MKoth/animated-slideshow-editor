// Sculpt brush utilities — world+screen hybrid with deformed-world hit-testing (ADR 0007 + #280)
// Pure helpers for seam 2 isolated tests: falloff, drag direction, shift invert.
export interface BrushVertex {
  readonly x: number
  readonly y: number
}

/**
 * Falloff following `pow(1 - dist/radius, falloff)` (default 1.0).
 * Returns 0 if outside radius, otherwise factor in (0,1].
 */
export function sculptFalloff(distScreen: number, radiusScreen: number, falloff: number): number {
  if (radiusScreen <= 0) return 0
  if (distScreen < 0) distScreen = 0
  if (distScreen > radiusScreen) return 0
  let factor = 1 - distScreen / radiusScreen
  if (factor < 0) factor = 0
  if (factor > 1) factor = 1
  if (falloff !== 1) {
    // clamp factor before pow to avoid NaN for negative
    factor = Math.pow(Math.max(0, factor), falloff)
  }
  return factor
}

/**
 * Hit-test: true if world point lies inside any face triangle (face guard).
 * Uses same point-in-triangle test as weightPaintInteraction.
 */
export function isBrushOverMesh(
  worldX: number,
  worldY: number,
  worldVertices: readonly BrushVertex[],
  faces: readonly { readonly v0: number; readonly v1: number; readonly v2: number }[],
): boolean {
  for (const f of faces) {
    const a = worldVertices[f.v0]
    const b = worldVertices[f.v1]
    const c = worldVertices[f.v2]
    if (!a || !b || !c) continue
    if (pointInTriangle(worldX, worldY, a.x, a.y, b.x, b.y, c.x, c.y)) return true
  }
  return false
}

function pointInTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

/**
 * Compute per-vertex offsets for a sculpt dab/drag segment.
 *
 * - worldVerts: deformed world vertices (for distance + face guard is external)
 * - brushWorld: current brush center in world space
 * - radiusScreen: brush radius in screen pixels (default 25)
 * - scale: max(abs(camera.scaleX), abs(camera.scaleY)) for world->screen conversion, clamped >=0.1
 * - falloff: exponent for `pow(1 - dist/radius, falloff)` (default 1.0)
 * - strength: symmetric strength multiplier (default 1.0)
 * - dragDeltaWorld: screen-space drag delta mapped to world (worldX - prevWorldX, worldY - prevWorldY)
 * - invert: if true (Shift), push direction is inverted subtractively
 *
 * Returns map of vertexIndex -> { dx, dy, factor } where dx/dy are world-space offsets to apply
 * to the rest vertices (added to basePositions). Factor is the per-vertex falloff weight.
 * Brute-force O(vertices) — sufficient to ~5k vertices; spatial index deferred per spec.
 */
export function computeSculptOffsets(params: {
  readonly worldVerts: readonly BrushVertex[]
  readonly brushWorld: BrushVertex
  readonly radiusScreen: number
  readonly scale: number
  readonly falloff: number
  readonly strength: number
  readonly dragDeltaWorld: BrushVertex
  readonly invert: boolean
}): Map<number, { dx: number; dy: number; factor: number }> {
  const { worldVerts, brushWorld, radiusScreen, scale, falloff, strength, dragDeltaWorld, invert } =
    params
  const effectiveScale = Math.max(Math.abs(scale), 0.1)
  const result = new Map<number, { dx: number; dy: number; factor: number }>()
  // If drag delta is zero, no directional push — return empty (no-op dab)
  // This ensures single-click without drag doesn't sculpt; caller may still handle hit-testing.
  if (Math.hypot(dragDeltaWorld.x, dragDeltaWorld.y) < 1e-9) return result
  const sign = invert ? -1 : 1
  for (let i = 0; i < worldVerts.length; i++) {
    const v = worldVerts[i]
    if (!v) continue
    const distWorld = Math.hypot(v.x - brushWorld.x, v.y - brushWorld.y)
    const distScreen = distWorld * effectiveScale
    if (distScreen > radiusScreen) continue
    const factor = sculptFalloff(distScreen, radiusScreen, falloff)
    if (factor <= 0) continue
    const deltaScale = strength * factor * sign
    const dx = dragDeltaWorld.x * deltaScale
    const dy = dragDeltaWorld.y * deltaScale
    // Consider near-zero offsets as no-op to avoid noise
    if (Math.hypot(dx, dy) < 1e-9) continue
    result.set(i, { dx, dy, factor })
  }
  return result
}

/**
 * Compute preview vertex positions after applying sculpt offsets to base rest positions.
 * baseRestPositions: map of vertexIdx -> base rest position (usually shape vertices)
 * offsets: map from computeSculptOffsets
 * Returns new preview map: idx -> {x,y} (rest-space positions)
 */
export function applySculptPreview(
  baseRestPositions: ReadonlyMap<number, BrushVertex>,
  offsets: ReadonlyMap<number, { dx: number; dy: number }>,
): Map<number, BrushVertex> {
  const preview = new Map<number, BrushVertex>()
  for (const [idx, base] of baseRestPositions) {
    const off = offsets.get(idx)
    if (off) {
      preview.set(idx, { x: base.x + off.dx, y: base.y + off.dy })
    } else {
      preview.set(idx, { x: base.x, y: base.y })
    }
  }
  // Also include vertices that have offsets but weren't in baseRestPositions (fallback)
  for (const [idx, off] of offsets) {
    if (!preview.has(idx)) {
      const base = baseRestPositions.get(idx)
      if (base) preview.set(idx, { x: base.x + off.dx, y: base.y + off.dy })
    }
  }
  return preview
}
