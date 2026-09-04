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
