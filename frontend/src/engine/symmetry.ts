// Symmetry — per-mesh in-place negate helpers and animatable factor (ADR symmetry)
import type { MeshVertex } from './mesh'
import type { Transform, Pivot } from './transform'

export type SymmetryAxis = 'x' | 'y'

export interface SymmetryKeyframeValue {
  readonly axis: SymmetryAxis
  readonly factor: number // 0..1, 0 = base, 1 = fully mirrored
}

export function requireSymmetryAxis(value: unknown, what = 'Symmetry axis'): SymmetryAxis {
  if (value !== 'x' && value !== 'y') {
    throw new Error(`${what} must be "x" or "y", got ${JSON.stringify(value)}`)
  }
  return value
}

export function requireSymmetryFactor(value: unknown, what = 'Symmetry factor'): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${what} must be a number between 0 and 1`)
  }
  return value
}

export function requireSymmetryKeyframeValue(
  value: unknown,
  what = 'Symmetry keyframe value',
): SymmetryKeyframeValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${what} must be an object with axis and factor`)
  }
  const r = value as Record<string, unknown>
  const axis = requireSymmetryAxis(r.axis, `${what}.axis`)
  const factor = requireSymmetryFactor(r.factor, `${what}.factor`)
  return { axis, factor }
}

export function symmetryKeyframeValueEquals(
  a: SymmetryKeyframeValue,
  b: SymmetryKeyframeValue,
): boolean {
  return a.axis === b.axis && a.factor === b.factor
}

export function mirroredVertex(v: MeshVertex, axis: SymmetryAxis): MeshVertex {
  return axis === 'x' ? { x: -v.x, y: v.y } : { x: v.x, y: -v.y }
}

export function mirroredUV(uv: { u: number; v: number }, axis: SymmetryAxis): { u: number; v: number } {
  return axis === 'x' ? { u: 1 - uv.u, v: uv.v } : { u: uv.u, v: 1 - uv.v }
}

export function mirroredTransform(transform: Transform, axis: SymmetryAxis): Transform {
  const next: Transform = {
    x: axis === 'x' ? -transform.x : transform.x,
    y: axis === 'y' ? -transform.y : transform.y,
    rotation: -transform.rotation,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
  }
  if (transform.localPivot) {
    const p: Pivot = {
      x: axis === 'x' ? -transform.localPivot.x : transform.localPivot.x,
      y: axis === 'y' ? -transform.localPivot.y : transform.localPivot.y,
    }
    if (p.x !== 0 || p.y !== 0) {
      ;(next as unknown as Record<string, unknown>).localPivot = p
    }
  }
  return next
}

export function lerpVertex(a: MeshVertex, b: MeshVertex, t: number): MeshVertex {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

export function mirroredUVTransform(
  transform: import('./uvTransform').UVTransform | undefined,
  axis: SymmetryAxis,
): import('./uvTransform').UVTransform | undefined {
  const base =
    transform ?? {
      uvScale: { u: 1, v: 1 },
      uvOffset: { u: 0, v: 0 },
      fitMode: 'stretch' as const,
    }
  const nextOffset = {
    u: axis === 'x' ? 1 - base.uvScale.u - base.uvOffset.u : base.uvOffset.u,
    v: axis === 'y' ? 1 - base.uvScale.v - base.uvOffset.v : base.uvOffset.v,
  }
  // Only flip offset/scale anchor; fitMode unchanged (centered crop stays centered - flipping base U/V already flips within fit)
  return {
    uvScale: { ...base.uvScale },
    uvOffset: nextOffset,
    fitMode: base.fitMode,
  }
}

export function lerpUVTransform(
  a: import('./uvTransform').UVTransform,
  b: import('./uvTransform').UVTransform,
  t: number,
): import('./uvTransform').UVTransform {
  return {
    uvScale: {
      u: a.uvScale.u + (b.uvScale.u - a.uvScale.u) * t,
      v: a.uvScale.v + (b.uvScale.v - a.uvScale.v) * t,
    },
    uvOffset: {
      u: a.uvOffset.u + (b.uvOffset.u - a.uvOffset.u) * t,
      v: a.uvOffset.v + (b.uvOffset.v - a.uvOffset.v) * t,
    },
    fitMode: t < 0.5 ? a.fitMode : b.fitMode,
  }
}

/** Blend between base and mirrored vertices by factor (0..1). */
export function resolveSymmetrizedVertices(
  baseVertices: readonly MeshVertex[],
  axis: SymmetryAxis,
  factor: number,
): readonly MeshVertex[] {
  const clamped = Math.max(0, Math.min(1, factor))
  if (clamped === 0) return baseVertices
  if (clamped === 1) {
    return baseVertices.map((v) => mirroredVertex(v, axis))
  }
  return baseVertices.map((v) => {
    const mv = mirroredVertex(v, axis)
    return lerpVertex(v, mv, clamped)
  })
}

export function resolveSymmetrizedUVs(
  baseUvs: readonly { readonly u: number; readonly v: number }[],
  axis: SymmetryAxis,
  factor: number,
): readonly { readonly u: number; readonly v: number }[] {
  const clamped = Math.max(0, Math.min(1, factor))
  if (clamped === 0) return baseUvs
  if (clamped === 1) return baseUvs.map((uv) => mirroredUV(uv, axis))
  return baseUvs.map((uv) => {
    const mv = mirroredUV(uv, axis)
    return { u: uv.u + (mv.u - uv.u) * clamped, v: uv.v + (mv.v - uv.v) * clamped }
  })
}

/** Default symmetry for new tracks: x axis, factor 0. */
export const DEFAULT_SYMMETRY: SymmetryKeyframeValue = { axis: 'x', factor: 0 }
