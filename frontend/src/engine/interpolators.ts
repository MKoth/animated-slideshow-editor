import type { Keyframe } from './keyframe'
import { normalizeAngleDelta } from './transform'

/**
 * The interpolation rule for the values between two keyframes of a track.
 * Holds for the segment from `from` to `to` at absolute track `time`
 * (Spec 07 R12). Read-only, deterministic, and allocation-free.
 */
export type SegmentInterpolator = (from: Keyframe, to: Keyframe, time: number) => number

/** Full turn assumed by angle interpolation when the caller passes none. */
export const ANGLE_TURN_RADIANS = Math.PI * 2

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
  if (from.wrap === true) {
    const wrapped = wrappedLinearValue(from.value, to.value, ratio)
    if (wrapped !== undefined) return wrapped
  }
  return (from.value as number) + ((to.value as number) - (from.value as number)) * ratio
}

/**
 * Wrap-around linear interpolation for [0,1]-normalized values.
 * Forces the path through the 0/1 boundary (e.g. 0.2 → 0 → 1 → 0.75).
 * Returns undefined when the segment is not wrappable (non-numeric or
 * out-of-range values) so the caller falls back to direct interpolation.
 */
function wrappedLinearValue(
  fromValue: unknown,
  toValue: unknown,
  ratio: number,
): number | undefined {
  if (typeof fromValue !== 'number' || typeof toValue !== 'number') return undefined
  if (!Number.isFinite(fromValue) || !Number.isFinite(toValue)) return undefined
  if (fromValue < 0 || fromValue > 1 || toValue < 0 || toValue > 1) return undefined
  const delta = toValue - fromValue
  if (delta === 0) return fromValue
  const wrappedDelta = delta - Math.sign(delta)
  const raw = fromValue + wrappedDelta * ratio
  return ((raw % 1) + 1) % 1
}

/**
 * Cubic bezier through the segment's keyframe tangents: control points are
 * `from + tangentOut` and `to + tangentIn` in (time, value) offsets. The
 * curve time is solved analytically (Cardano) — no sampling, deterministic.
 */
function bezierSegment(from: Keyframe, to: Keyframe, time: number): number {
  const u = curveTimeForSegment(from, to, time)
  const v0 = from.value as number
  const v1 = v0 + from.tangentOut.value
  const v2 = (to.value as number) + to.tangentIn.value
  const v3 = to.value as number
  return bezierValueAt(u, v0, v1, v2, v3)
}

function curveTimeForSegment(from: Keyframe, to: Keyframe, time: number): number {
  const segmentTime = to.time - from.time
  const ratio = (time - from.time) / segmentTime
  const x1 = from.tangentOut.time / segmentTime
  const x2 = 1 + to.tangentIn.time / segmentTime
  return cubicRootInUnitInterval(x1, x2, ratio) ?? ratio
}

function bezierValueAt(u: number, v0: number, v1: number, v2: number, v3: number): number {
  const oneMinus = 1 - u
  return (
    oneMinus * oneMinus * oneMinus * v0 +
    3 * oneMinus * oneMinus * u * v1 +
    3 * oneMinus * u * u * v2 +
    u * u * u * v3
  )
}

/**
 * Angle-aware segment evaluation: like {@link evaluateSegment} but the
 * segment travels the shortest arc between the endpoint angles. `turn` is
 * the full turn of the value domain (2π for radian rotation, 360 for
 * degree domains such as shadow rotation). `hold` is unchanged; `linear`,
 * `bezier`, and the parametric easing types interpolate along the shortest
 * delta; unknown interpolation names fall back to plain evaluation.
 * Read-only, deterministic, and allocation-free.
 */
export function evaluateAngleSegment(
  from: Keyframe,
  to: Keyframe,
  time: number,
  turn: number = ANGLE_TURN_RADIANS,
): number {
  const v0 = from.value as number
  const v3raw = to.value as number
  if (from.interpolation === 'hold') {
    return v0
  }
  const delta = normalizeAngleDelta(v3raw - v0, turn)
  if (from.interpolation === 'linear') {
    const ratio = (time - from.time) / (to.time - from.time)
    return v0 + delta * ratio
  }
  if (from.interpolation === 'bezier') {
    // Translate the tail of the curve by whole turns so it ends on the
    // shortest-arc equivalent of `to`; tangents keep their slope shape.
    const shift = delta - (v3raw - v0)
    const u = curveTimeForSegment(from, to, time)
    const v1 = v0 + from.tangentOut.value
    const v2 = v3raw + to.tangentIn.value + shift
    const v3 = v3raw + shift
    return bezierValueAt(u, v0, v1, v2, v3)
  }
  const easing = easingFor(from.interpolation)
  if (easing !== undefined) {
    const ratio = (time - from.time) / (to.time - from.time)
    return v0 + delta * easing(ratio)
  }
  return evaluateSegment(from, to, time)
}

registerSegmentInterpolator('hold', holdSegment)
registerSegmentInterpolator('linear', linearSegment)
registerSegmentInterpolator('bezier', bezierSegment)

type EasingFn = (t: number) => number

function easingFor(interpolation: string): EasingFn | undefined {
  switch (interpolation) {
    case 'bounce':
      return bounceEaseOut
    case 'elastic':
      return elasticEaseOut
    case 'spring':
      return springEase
    default:
      return undefined
  }
}

function parametricSegment(easing: EasingFn): SegmentInterpolator {
  return (from: Keyframe, to: Keyframe, time: number): number => {
    const ratio = (time - from.time) / (to.time - from.time)
    const eased = easing(ratio)
    return (from.value as number) + ((to.value as number) - (from.value as number)) * eased
  }
}

/**
 * Bounce easing: simulates a bouncing object that decays on each impact.
 * Deterministic and allocation-free — pure arithmetic on the ratio.
 */
function bounceEaseOut(t: number): number {
  const n1 = 7.5625
  const d1 = 2.75
  if (t < 1 / d1) {
    return n1 * t * t
  }
  if (t < 2 / d1) {
    const t2 = t - 1.5 / d1
    return n1 * t2 * t2 + 0.75
  }
  if (t < 2.5 / d1) {
    const t2 = t - 2.25 / d1
    return n1 * t2 * t2 + 0.9375
  }
  const t2 = t - 2.625 / d1
  return n1 * t2 * t2 + 0.984375
}

/**
 * Elastic easing: oscillates around the target with exponential decay.
 * Deterministic and allocation-free — pure arithmetic on the ratio.
 */
function elasticEaseOut(t: number): number {
  if (t === 0 || t === 1) {
    return t
  }
  return Math.pow(2, -10 * t) * Math.sin(((t * 10 - 0.75) * Math.PI) / 1.5) + 1
}

/**
 * Spring easing: damped oscillation that settles smoothly to the target.
 * Deterministic and allocation-free — pure arithmetic on the ratio.
 */
function springEase(t: number): number {
  if (t === 0 || t === 1) {
    return t
  }
  return 1 - Math.cos(t * 4.5 * Math.PI) * Math.exp(-t * 6)
}

registerSegmentInterpolator('bounce', parametricSegment(bounceEaseOut))
registerSegmentInterpolator('elastic', parametricSegment(elasticEaseOut))
registerSegmentInterpolator('spring', parametricSegment(springEase))

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
