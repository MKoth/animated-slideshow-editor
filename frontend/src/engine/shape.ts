// Shape — absolute per-mesh snapshots sharing topology (ADR 0007)
// Shapes live inline in MeshComponent, not library. faces/uvs/boneWeights/bindPose stay on mesh.
import type { MeshVertex } from './mesh'
import { newId } from './ids'

export interface Shape {
  readonly id: string
  readonly name: string
  readonly vertices: readonly MeshVertex[]
}

export interface ShapeJSON {
  readonly id: string
  readonly name: string
  readonly vertices: readonly { readonly x: number; readonly y: number }[]
}

export function createShape(name: string, vertices: readonly MeshVertex[]): Shape {
  return { id: newId('shape'), name, vertices: vertices.map((v) => ({ x: v.x, y: v.y })) }
}

export function duplicateShape(shape: Shape, name: string): Shape {
  return createShape(name, shape.vertices)
}

export function shapeFromJSON(json: unknown): Shape {
  if (typeof json !== 'object' || json === null) throw new Error('Shape JSON must be object')
  const r = json as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || !Array.isArray(r.vertices)) {
    throw new Error('Shape JSON missing id/name/vertices')
  }
  const vertices: MeshVertex[] = []
  for (const v of r.vertices) {
    const rec = v as Record<string, unknown>
    if (typeof rec.x !== 'number' || typeof rec.y !== 'number')
      throw new Error('Shape vertex must have x,y numbers')
    vertices.push({ x: rec.x as number, y: rec.y as number })
  }
  return { id: r.id as string, name: r.name as string, vertices }
}

export function shapeToJSON(shape: Shape): ShapeJSON {
  return {
    id: shape.id,
    name: shape.name,
    vertices: shape.vertices.map((v) => ({ x: v.x, y: v.y })),
  }
}

export function validateShapesInvariant(
  baseVertices: readonly MeshVertex[],
  shapes: readonly Shape[] | undefined,
): string | null {
  if (!shapes || shapes.length === 0) return null
  for (const s of shapes) {
    if (s.vertices.length !== baseVertices.length) {
      return `Shape "${s.name}" vertices length ${s.vertices.length} != mesh vertices ${baseVertices.length}`
    }
  }
  return null
}

// --- Morph helpers (ADR 0007 + #273: one active morph, absolute lerp, morph-then-bones) ---

export interface MorphBinding {
  readonly fromShapeId: string | null
  readonly toShapeId: string | null
}

export interface MorphState {
  readonly binding: MorphBinding | null
  readonly coefficient: number // 0..1 (store), preview allows 1.5
}

export interface MorphKeyframeValue {
  readonly fromShapeId: string | null
  readonly toShapeId: string | null
  readonly coefficient: number // 0..1
}

export interface MorphClipKeyframeValue {
  readonly fromShapeName: string | null
  readonly toShapeName: string | null
  readonly coefficient: number // 0..1
}

export function lerpVertex(a: MeshVertex, b: MeshVertex, t: number): MeshVertex {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/**
 * Resolve morphed rest vertices for a mesh given its base vertices and Shapes.
 * Returns base vertices if binding is incomplete or stale (soft warn, fallback to base).
 * This is the `morph-then-bones` insertion point: caller feeds result into evaluateMeshDeformation
 * as the `mesh.vertices` substitute while reusing faces/uvs/boneWeights/bindPose.
 */
export function resolveMorphedVertices(
  baseVertices: readonly MeshVertex[],
  shapes: readonly Shape[] | undefined,
  morph: MorphState | null,
): readonly MeshVertex[] {
  if (!morph || !morph.binding) {
    return baseVertices
  }
  if (morph.binding.fromShapeId === null || morph.binding.toShapeId === null) {
    console.warn(
      `[morph] Incomplete binding from=${morph.binding.fromShapeId} to=${morph.binding.toShapeId} — falling back to base`,
    )
    return baseVertices
  }
  if (!shapes || shapes.length === 0) {
    return baseVertices
  }
  const from = shapes.find((s) => s.id === morph.binding!.fromShapeId)
  const to = shapes.find((s) => s.id === morph.binding!.toShapeId)
  if (!from || !to) {
    console.warn(
      `[morph] Missing shape id from=${morph.binding.fromShapeId} to=${morph.binding.toShapeId} — falling back to base`,
    )
    return baseVertices
  }
  if (from.vertices.length !== baseVertices.length || to.vertices.length !== baseVertices.length) {
    console.warn('[morph] Shape vertex length mismatch — falling back to base')
    return baseVertices
  }
  const t = morph.coefficient
  // clamp for store 0..1, but allow exaggeration up to 1.5 at preview (no clamp upper, evaluator may clamp)
  const clamped = Math.max(0, Math.min(t, 1.5))
  const out: MeshVertex[] = []
  for (let i = 0; i < baseVertices.length; i += 1) {
    out.push(lerpVertex(from.vertices[i], to.vertices[i], clamped))
  }
  return out
}

export function uniqueShapeName(base: string, existing: readonly Shape[]): string {
  const names = new Set(existing.map((s) => s.name))
  if (!names.has(base)) return base
  let i = 2
  while (names.has(`${base} ${i}`)) i += 1
  return `${base} ${i}`
}

export function requireMorphCoefficientValue(value: unknown, what = 'Morph coefficient'): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${what} must be a number between 0 and 1`)
  }
  return value
}

export function requireMorphKeyframeValue(
  value: unknown,
  what = 'Morph keyframe value',
): MorphKeyframeValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${what} must be an object with fromShapeId, toShapeId, coefficient`)
  }
  const r = value as Record<string, unknown>
  const fromShapeId = r.fromShapeId
  const toShapeId = r.toShapeId
  const coefficient = r.coefficient
  if (fromShapeId !== null && typeof fromShapeId !== 'string') {
    throw new Error(`${what} fromShapeId must be string or null`)
  }
  if (toShapeId !== null && typeof toShapeId !== 'string') {
    throw new Error(`${what} toShapeId must be string or null`)
  }
  if (typeof coefficient !== 'number' || !Number.isFinite(coefficient) || coefficient < 0 || coefficient > 1) {
    throw new Error(`${what} coefficient must be a number between 0 and 1`)
  }
  return {
    fromShapeId: fromShapeId as string | null,
    toShapeId: toShapeId as string | null,
    coefficient: coefficient as number,
  }
}

export function requireMorphClipKeyframeValue(
  value: unknown,
  what = 'Morph clip keyframe value',
): MorphClipKeyframeValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${what} must be an object with fromShapeName, toShapeName, coefficient`)
  }
  const r = value as Record<string, unknown>
  const fromShapeName = r.fromShapeName
  const toShapeName = r.toShapeName
  const coefficient = r.coefficient
  if (fromShapeName !== null && typeof fromShapeName !== 'string') {
    throw new Error(`${what} fromShapeName must be string or null`)
  }
  if (toShapeName !== null && typeof toShapeName !== 'string') {
    throw new Error(`${what} toShapeName must be string or null`)
  }
  if (typeof coefficient !== 'number' || !Number.isFinite(coefficient) || coefficient < 0 || coefficient > 1) {
    throw new Error(`${what} coefficient must be a number between 0 and 1`)
  }
  return {
    fromShapeName: fromShapeName as string | null,
    toShapeName: toShapeName as string | null,
    coefficient: coefficient as number,
  }
}

export function morphKeyframeValueEquals(a: MorphKeyframeValue, b: MorphKeyframeValue): boolean {
  return (
    a.fromShapeId === b.fromShapeId && a.toShapeId === b.toShapeId && a.coefficient === b.coefficient
  )
}

export function isMorphBindingEqual(
  a: MorphBinding | null,
  b: MorphBinding | null,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.fromShapeId === b.fromShapeId && a.toShapeId === b.toShapeId
}

export function resolveMorphedVerticesFromKeyframe(
  baseVertices: readonly MeshVertex[],
  shapes: readonly Shape[] | undefined,
  value: MorphKeyframeValue | null,
): readonly MeshVertex[] {
  if (!value) return baseVertices
  return resolveMorphedVertices(baseVertices, shapes, {
    binding: { fromShapeId: value.fromShapeId, toShapeId: value.toShapeId },
    coefficient: value.coefficient,
  })
}

/**
 * Cross-blend interpolation between two morph keyframe values.
 * If bindings are equal (or both keyframes share from/to), interpolates coefficient then single lerp.
 * Otherwise computes geom0 = lerp(from0,to0,c0) and geom1 = lerp(from1,to1,c1) then lerps between geoms by eased u.
 * Handles hold (no blend), missing/incomplete bindings → base fallback, stale/mismatched → base warning path reused.
 */
export function resolveCrossBlendedVertices(
  baseVertices: readonly MeshVertex[],
  shapes: readonly Shape[] | undefined,
  fromValue: MorphKeyframeValue,
  toValue: MorphKeyframeValue,
  u: number,
): readonly MeshVertex[] {
  if (fromValue.fromShapeId === toValue.fromShapeId && fromValue.toShapeId === toValue.toShapeId) {
    const coeff = fromValue.coefficient + (toValue.coefficient - fromValue.coefficient) * u
    return resolveMorphedVertices(baseVertices, shapes, {
      binding: { fromShapeId: fromValue.fromShapeId, toShapeId: fromValue.toShapeId },
      coefficient: coeff,
    })
  }
  const geom0 = resolveMorphedVerticesFromKeyframe(baseVertices, shapes, fromValue)
  const geom1 = resolveMorphedVerticesFromKeyframe(baseVertices, shapes, toValue)
  if (geom0 === baseVertices && geom1 === baseVertices) return baseVertices
  const out: MeshVertex[] = []
  for (let i = 0; i < baseVertices.length; i += 1) {
    const a = geom0[i] ?? baseVertices[i]
    const b = geom1[i] ?? baseVertices[i]
    out.push(lerpVertex(a, b, u))
  }
  return out
}
