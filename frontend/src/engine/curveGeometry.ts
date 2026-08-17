import type { Keyframe } from './keyframe'
import { evaluateSegment } from './interpolators'

export const CURVE_HIT_RADIUS = 8
export const TANGENT_HANDLE_SIZE = 6
export const CURVE_LINE_WIDTH = 2
export const CURVE_SAMPLE_STEP_PX = 2

export interface CurveViewport {
  readonly scrollX: number
  readonly scrollY: number
  readonly zoomX: number
  readonly zoomY: number
  readonly canvasWidth: number
  readonly canvasHeight: number
}

export interface ScreenPoint {
  readonly x: number
  readonly y: number
}

export interface WorldPoint {
  readonly time: number
  readonly value: number
}

export interface CurveData {
  readonly nodeId: string
  readonly property: string
  readonly label: string
  readonly keyframes: readonly Keyframe[]
  readonly color: string
}

export interface CurveBounds {
  readonly minTime: number
  readonly maxTime: number
  readonly minValue: number
  readonly maxValue: number
}

export interface TangentHandles {
  readonly in: ScreenPoint | null
  readonly out: ScreenPoint | null
}

export function worldToScreen(time: number, value: number, viewport: CurveViewport): ScreenPoint {
  return {
    x: (time - viewport.scrollX) * viewport.zoomX,
    y: viewport.canvasHeight / 2 - (value - viewport.scrollY) * viewport.zoomY,
  }
}

export function screenToWorld(x: number, y: number, viewport: CurveViewport): WorldPoint {
  return {
    time: viewport.scrollX + x / viewport.zoomX,
    value: viewport.scrollY + (viewport.canvasHeight / 2 - y) / viewport.zoomY,
  }
}

function interpolateValue(from: Keyframe, to: Keyframe, time: number): number {
  if (from.interpolation === 'hold') {
    return from.value as number
  }
  return evaluateSegment(from, to, time)
}

function keyframeToScreen(kf: Keyframe, viewport: CurveViewport): ScreenPoint {
  return worldToScreen(kf.time, kf.value as number, viewport)
}

export function computeCurvePoints(
  curve: CurveData,
  viewport: CurveViewport,
): (ScreenPoint & { readonly value: number })[] {
  const { keyframes } = curve
  if (keyframes.length === 0) {
    return []
  }

  const points: (ScreenPoint & { readonly value: number })[] = []

  if (keyframes.length === 1) {
    const kf = keyframes[0]
    const screen = keyframeToScreen(kf, viewport)
    points.push({ ...screen, value: kf.value as number })
    return points
  }

  let prevVisible = false

  for (let i = 1; i < keyframes.length; i++) {
    const prev = keyframes[i - 1]
    const kf = keyframes[i]
    const segStart = prev.time
    const segEnd = kf.time
    const visible = isSegmentVisible(segStart, segEnd, viewport)

    if (!visible) {
      prevVisible = false
      continue
    }

    if (segEnd - segStart < 1e-9) {
      const screen = keyframeToScreen(kf, viewport)
      points.push({ ...screen, value: kf.value as number })
      prevVisible = true
      continue
    }

    const segStartScreen = worldToScreen(segStart, prev.value as number, viewport)
    const segEndScreen = worldToScreen(segEnd, kf.value as number, viewport)

    const sampleCount = Math.max(
      2,
      Math.ceil(Math.abs(segEndScreen.x - segStartScreen.x) / CURVE_SAMPLE_STEP_PX),
    )

    const startIdx = prevVisible ? 1 : 0

    for (let s = startIdx; s <= sampleCount; s++) {
      const t = segStart + (segEnd - segStart) * (s / sampleCount)
      const val = interpolateValue(prev, kf, t)
      const pt = worldToScreen(t, val, viewport)
      points.push({ ...pt, value: val })
    }

    prevVisible = true
  }

  return points
}

export function computeTangentHandlePositions(
  keyframe: Keyframe,
  viewport: CurveViewport,
): TangentHandles | null {
  if (keyframe.interpolation !== 'bezier') {
    return null
  }

  const hasIn =
    Math.abs(keyframe.tangentIn.time) > 1e-9 || Math.abs(keyframe.tangentIn.value) > 1e-9
  const hasOut =
    Math.abs(keyframe.tangentOut.time) > 1e-9 || Math.abs(keyframe.tangentOut.value) > 1e-9

  return {
    in: hasIn
      ? worldToScreen(
          keyframe.time + keyframe.tangentIn.time,
          (keyframe.value as number) + keyframe.tangentIn.value,
          viewport,
        )
      : null,
    out: hasOut
      ? worldToScreen(
          keyframe.time + keyframe.tangentOut.time,
          (keyframe.value as number) + keyframe.tangentOut.value,
          viewport,
        )
      : null,
  }
}

export function hitTestKeyframe(
  screenX: number,
  screenY: number,
  keyframes: readonly Keyframe[],
  viewport: CurveViewport,
): string | null {
  let closest: string | null = null
  let closestDist = CURVE_HIT_RADIUS

  for (const kf of keyframes) {
    const screen = keyframeToScreen(kf, viewport)
    const dx = screenX - screen.x
    const dy = screenY - screen.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < closestDist) {
      closestDist = dist
      closest = kf.id
    }
  }

  return closest
}

export function hitTestTangentHandle(
  screenX: number,
  screenY: number,
  keyframe: Keyframe,
  viewport: CurveViewport,
): 'in' | 'out' | null {
  const handles = computeTangentHandlePositions(keyframe, viewport)
  if (!handles) {
    return null
  }

  let hitSide: 'in' | 'out' | null = null
  let hitDist = TANGENT_HANDLE_SIZE

  if (handles.in) {
    const dx = screenX - handles.in.x
    const dy = screenY - handles.in.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < hitDist) {
      hitDist = dist
      hitSide = 'in'
    }
  }

  if (handles.out) {
    const dx = screenX - handles.out.x
    const dy = screenY - handles.out.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < hitDist) {
      hitSide = 'out'
    }
  }

  return hitSide
}

export function isSegmentVisible(
  timeStart: number,
  timeEnd: number,
  viewport: CurveViewport,
): boolean {
  const segStartScreen = (timeStart - viewport.scrollX) * viewport.zoomX
  const segEndScreen = (timeEnd - viewport.scrollX) * viewport.zoomX
  return segEndScreen >= 0 && segStartScreen <= viewport.canvasWidth
}

export function computeCurveBounds(curves: readonly CurveData[]): CurveBounds | null {
  let minTime = Number.POSITIVE_INFINITY
  let maxTime = Number.NEGATIVE_INFINITY
  let minValue = Number.POSITIVE_INFINITY
  let maxValue = Number.NEGATIVE_INFINITY

  for (const curve of curves) {
    for (const kf of curve.keyframes) {
      const val = kf.value as number
      if (kf.time < minTime) minTime = kf.time
      if (kf.time > maxTime) maxTime = kf.time
      if (val < minValue) minValue = val
      if (val > maxValue) maxValue = val
    }
  }

  if (!Number.isFinite(minTime)) {
    return null
  }

  return { minTime, maxTime, minValue, maxValue }
}
