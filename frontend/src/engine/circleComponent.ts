import type { MeshData, MeshVertex, MeshFace } from './mesh'

export interface CircleComponent {
  readonly kind: 'circle'
  readonly radius: number
  readonly startAngle: number
  readonly endAngle: number
  /** Optional explicit segment count; when omitted, auto = max(16, ceil(arc/10°)) */
  readonly segments?: number
}

export const DEFAULT_CIRCLE_RADIUS = 50
export const DEFAULT_CIRCLE_START_ANGLE = 0
export const DEFAULT_CIRCLE_END_ANGLE = 360
export const MIN_CIRCLE_RADIUS = 0.1
export const MAX_CIRCLE_RADIUS = 5000
export const MIN_CIRCLE_SEGMENTS = 3
export const MAX_CIRCLE_SEGMENTS = 256

export function requireRadius(value: unknown, what = 'Circle radius'): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${what} must be a finite number`)
  }
  if (value < MIN_CIRCLE_RADIUS || value > MAX_CIRCLE_RADIUS) {
    throw new Error(`${what} must be between ${MIN_CIRCLE_RADIUS} and ${MAX_CIRCLE_RADIUS}`)
  }
  return value
}

export function requireCircleAngle(value: unknown, what = 'Circle angle'): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${what} must be a finite number`)
  }
  if (value < 0 || value > 360) {
    throw new Error(`${what} must be between 0 and 360`)
  }
  return value
}

export function requireCircleSegments(value: unknown, what = 'Circle segments'): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${what} must be an integer`)
  }
  if (value < MIN_CIRCLE_SEGMENTS || value > MAX_CIRCLE_SEGMENTS) {
    throw new Error(`${what} must be between ${MIN_CIRCLE_SEGMENTS} and ${MAX_CIRCLE_SEGMENTS}`)
  }
  return value
}

export function circleArcDegrees(startAngle: number, endAngle: number): number {
  const raw = (((endAngle - startAngle) % 360) + 360) % 360
  if (raw === 0) {
    // 0 -> full circle when start/end represent same modulo (0/360) — matches spec 0..360 wedge where 0->360 is full.
    // Treat arc 0 as 360 to generate full circle; 0 wedge is degenerate and would be empty anyway.
    return 360
  }
  return raw
}

export function circleSegmentsForArc(arcDegrees: number): number {
  return Math.max(16, Math.ceil(arcDegrees / 10))
}

export function resolveCircleSegments(
  component: Pick<CircleComponent, 'startAngle' | 'endAngle' | 'segments'>,
): number {
  if (component.segments !== undefined) {
    return component.segments
  }
  const arc = circleArcDegrees(component.startAngle, component.endAngle)
  return circleSegmentsForArc(arc)
}

export function createCircleComponent(
  radius: number = DEFAULT_CIRCLE_RADIUS,
  startAngle: number = DEFAULT_CIRCLE_START_ANGLE,
  endAngle: number = DEFAULT_CIRCLE_END_ANGLE,
  segments?: number,
): CircleComponent {
  const r = requireRadius(radius, 'Circle radius')
  const s = requireCircleAngle(startAngle, 'Circle startAngle')
  const e = requireCircleAngle(endAngle, 'Circle endAngle')
  const seg =
    segments !== undefined ? requireCircleSegments(segments, 'Circle segments') : undefined
  return seg === undefined
    ? { kind: 'circle', radius: r, startAngle: s, endAngle: e }
    : { kind: 'circle', radius: r, startAngle: s, endAngle: e, segments: seg }
}

export function cloneCircleComponent(component: CircleComponent): CircleComponent {
  const base: CircleComponent = {
    kind: 'circle',
    radius: component.radius,
    startAngle: component.startAngle,
    endAngle: component.endAngle,
  }
  if (component.segments !== undefined) {
    return { ...base, segments: component.segments }
  }
  return base
}

export function circleComponentFromJSON(json: unknown, nodeId: string): CircleComponent {
  if (typeof json !== 'object' || json === null) {
    throw new Error(`Node "${nodeId}" circle component must be an object`)
  }
  const record = json as Record<string, unknown>
  if (record.kind !== 'circle') {
    throw new Error(`Node "${nodeId}" has an invalid circle component`)
  }
  const radius = requireRadius(record.radius, `Node "${nodeId}" circle radius`)
  const startAngle = requireCircleAngle(record.startAngle, `Node "${nodeId}" circle startAngle`)
  const endAngle = requireCircleAngle(record.endAngle, `Node "${nodeId}" circle endAngle`)
  if (record.segments !== undefined) {
    const segments = requireCircleSegments(record.segments, `Node "${nodeId}" circle segments`)
    return { kind: 'circle', radius, startAngle, endAngle, segments }
  }
  return { kind: 'circle', radius, startAngle, endAngle }
}

export function circleComponentToJSON(component: CircleComponent): Record<string, unknown> {
  const base: Record<string, unknown> = {
    kind: 'circle',
    radius: component.radius,
    startAngle: component.startAngle,
    endAngle: component.endAngle,
  }
  if (component.segments !== undefined) {
    base.segments = component.segments
  }
  return base
}

export function generateCircleMeshData(
  circle: Pick<CircleComponent, 'radius' | 'startAngle' | 'endAngle' | 'segments'>,
  evaluatedStartAngle?: number,
  evaluatedEndAngle?: number,
): MeshData {
  const radius = circle.radius
  const startAngle = evaluatedStartAngle ?? circle.startAngle
  const endAngle = evaluatedEndAngle ?? circle.endAngle

  if (typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0) {
    throw new Error('Circle radius must be a positive finite number')
  }
  if (
    typeof startAngle !== 'number' ||
    !Number.isFinite(startAngle) ||
    typeof endAngle !== 'number' ||
    !Number.isFinite(endAngle)
  ) {
    throw new Error('Circle angles must be finite numbers')
  }

  const arc = (((endAngle - startAngle) % 360) + 360) % 360
  const effectiveArc = arc === 0 ? 360 : arc
  const segments = circle.segments ?? circleSegmentsForArc(effectiveArc)
  const validatedSegments =
    Number.isInteger(segments) && segments >= MIN_CIRCLE_SEGMENTS && segments <= MAX_CIRCLE_SEGMENTS
      ? segments
      : circleSegmentsForArc(effectiveArc)

  const vertices: MeshVertex[] = [{ x: 0, y: 0 }]
  const uvs: { u: number; v: number }[] = [{ u: 0.5, v: 0.5 }]

  const step = effectiveArc / validatedSegments

  for (let i = 0; i <= validatedSegments; i++) {
    const angleDeg = startAngle + i * step
    const angleRad = (angleDeg * Math.PI) / 180
    const x = radius * Math.cos(angleRad)
    const y = radius * Math.sin(angleRad)
    vertices.push({ x, y })
    // radial UVs: center 0.5,0.5, perimeter maps to unit circle in 0..1 square
    const u = 0.5 + 0.5 * Math.cos(angleRad)
    const v = 0.5 + 0.5 * Math.sin(angleRad)
    uvs.push({ u, v })
  }

  const faces: MeshFace[] = []
  for (let i = 1; i <= validatedSegments; i++) {
    faces.push({ v0: 0, v1: i, v2: i + 1 })
  }

  return { vertices, faces, uvs }
}

export function circleSizeOf(circle: CircleComponent): {
  width: number
  height: number
  offsetX: number
  offsetY: number
} {
  const diameter = circle.radius * 2
  return { width: diameter, height: diameter, offsetX: 0, offsetY: 0 }
}
