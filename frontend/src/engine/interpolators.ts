import type { Keyframe } from './keyframe'

/**
 * The interpolation rule for the values between two keyframes of a track.
 * Holds for the segment from `from` to `to` at absolute track `time`
 * (Spec 07 R12). Read-only, deterministic, and allocation-free.
 */
export type SegmentInterpolator = (from: Keyframe, to: Keyframe, time: number) => number

const registry = new Map<string, SegmentInterpolator>()

/**
 * Register a segment interpolator under a name; returns an unregister
 * function. The registry is the closed insertion point for future parametric
 * interpolator types (Bounce/Elastic/Spring) — evaluation logic never changes.
 */
export function registerSegmentInterpolator(
  name: string,
  interpolator: SegmentInterpolator,
): () => void {
  registry.set(name, interpolator)
  return () => {
    registry.delete(name)
  }
}

/** Evaluate one segment, dispatching on the from-keyframe's interpolation. */
export function evaluateSegment(from: Keyframe, to: Keyframe, time: number): number {
  const interpolator = registry.get(from.interpolation)
  return interpolator ? interpolator(from, to, time) : linearSegment(from, to, time)
}

function holdSegment(from: Keyframe): number {
  return from.value as number
}

function linearSegment(from: Keyframe, to: Keyframe, time: number): number {
  const ratio = (time - from.time) / (to.time - from.time)
  return (from.value as number) + ((to.value as number) - (from.value as number)) * ratio
}

/**
 * Cubic bezier through the segment's keyframe tangents: control points are
 * `from + tangentOut` and `to + tangentIn` in (time, value) offsets. The
 * curve time is solved analytically (Cardano) — no sampling, deterministic.
 */
function bezierSegment(from: Keyframe, to: Keyframe, time: number): number {
  const segmentTime = to.time - from.time
  const ratio = (time - from.time) / segmentTime
  const x1 = from.tangentOut.time / segmentTime
  const x2 = 1 + to.tangentIn.time / segmentTime
  const u = cubicRootInUnitInterval(x1, x2, ratio) ?? ratio
  const v0 = from.value as number
  const v1 = v0 + from.tangentOut.value
  const v2 = (to.value as number) + to.tangentIn.value
  const v3 = to.value as number
  const oneMinus = 1 - u
  return (
    oneMinus * oneMinus * oneMinus * v0 +
    3 * oneMinus * oneMinus * u * v1 +
    3 * oneMinus * u * u * v2 +
    u * u * u * v3
  )
}

registerSegmentInterpolator('hold', holdSegment)
registerSegmentInterpolator('linear', linearSegment)
registerSegmentInterpolator('bezier', bezierSegment)

/**
 * Solve the normalized cubic x(u) = 3(1-u)^2 u x1 + 3(1-u) u^2 x2 + u^3 for
 * x(u) = ratio, u in [0, 1]; returns undefined when no root lies in range.
 * Allocation-free: the candidate-root list is a module-scoped scratch reused
 * by every segment evaluation (the evaluator is synchronous, never re-entrant).
 */
const cubicRootScratch: number[] = []

function cubicRootInUnitInterval(x1: number, x2: number, ratio: number): number | undefined {
  cubicRootScratch.length = 0
  const a = 3 * (x1 - x2) + 1
  const b = 3 * x2 - 6 * x1
  const c = 3 * x1
  const d = -ratio
  if (Math.abs(a) < 1e-12) {
    collectQuadraticRoots(b, c, d)
  } else {
    const p = (3 * a * c - b * b) / (3 * a * a)
    const q = (2 * b * b * b - 9 * a * b * c + 27 * a * a * d) / (27 * a * a * a)
    const discriminant = (q * q) / 4 + (p * p * p) / 27
    if (discriminant >= 0) {
      cubicRootScratch.push(
        Math.cbrt(-q / 2 + Math.sqrt(discriminant)) + Math.cbrt(-q / 2 - Math.sqrt(discriminant)),
      )
      if (discriminant === 0) {
        cubicRootScratch.push(Math.cbrt(q / 2) - b / (3 * a))
      }
    } else {
      const magnitude = 2 * Math.sqrt(-p / 3)
      const angle = Math.acos(-q / (2 * Math.sqrt((-p * p * p) / 27)))
      for (let k = 0; k < 3; k += 1) {
        cubicRootScratch.push(magnitude * Math.cos((angle + 2 * Math.PI * k) / 3) - b / (3 * a))
      }
    }
  }
  let best: number | undefined
  let bestError = Number.POSITIVE_INFINITY
  for (const root of cubicRootScratch) {
    if (root >= -1e-9 && root <= 1 + 1e-9) {
      const clamped = Math.min(Math.max(root, 0), 1)
      const oneMinus = 1 - clamped
      const value =
        3 * oneMinus * oneMinus * clamped * x1 +
        3 * oneMinus * clamped * clamped * x2 +
        clamped * clamped * clamped
      const error = Math.abs(value - ratio)
      if (error < bestError) {
        best = clamped
        bestError = error
      }
    }
  }
  return best
}

function collectQuadraticRoots(b: number, c: number, d: number): void {
  if (Math.abs(b) < 1e-12) {
    return
  }
  const discriminant = c * c - 4 * b * d
  if (discriminant >= 0) {
    const sqrt = Math.sqrt(discriminant)
    cubicRootScratch.push((-c + sqrt) / (2 * b))
    cubicRootScratch.push((-c - sqrt) / (2 * b))
  }
}
