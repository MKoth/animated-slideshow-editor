import type { WorldPoint, WorldRect } from './worldGeometry'

export interface AlignmentResult {
  readonly verticalLines: readonly number[]
  readonly horizontalLines: readonly number[]
}

const SNAP_EPSILON = 1e-6

export const EMPTY_ALIGNMENT: AlignmentResult = {
  verticalLines: [],
  horizontalLines: [],
}

function edgesOf(rect: WorldRect): { left: number; mid: number; right: number } {
  return {
    left: rect.minX,
    mid: (rect.minX + rect.maxX) / 2,
    right: rect.maxX,
  }
}

function topOf(rect: WorldRect): { top: number; mid: number; bottom: number } {
  return {
    top: rect.minY,
    mid: (rect.minY + rect.maxY) / 2,
    bottom: rect.maxY,
  }
}

export function findAlignment(
  moving: WorldRect,
  others: readonly WorldRect[],
  center: WorldPoint,
  threshold: number,
): AlignmentResult {
  if (threshold < 0) {
    return EMPTY_ALIGNMENT
  }

  const verticalX: number[] = []
  const horizontalY: number[] = []

  const movingX = edgesOf(moving)
  const movingY = topOf(moving)
  const otherXs = [center.x]
  const otherYs = [center.y]
  for (const other of others) {
    const ex = edgesOf(other)
    otherXs.push(ex.left, ex.mid, ex.right)
    const ey = topOf(other)
    otherYs.push(ey.top, ey.mid, ey.bottom)
  }

  for (const movingEdge of [movingX.left, movingX.mid, movingX.right]) {
    for (const otherEdge of otherXs) {
      const dx = otherEdge - movingEdge
      if (Math.abs(dx) <= threshold) {
        const lineX = round(movingEdge + dx)
        if (!verticalX.includes(lineX)) {
          verticalX.push(lineX)
        }
      }
    }
  }

  for (const movingEdge of [movingY.top, movingY.mid, movingY.bottom]) {
    for (const otherEdge of otherYs) {
      const dy = otherEdge - movingEdge
      if (Math.abs(dy) <= threshold) {
        const lineY = round(movingEdge + dy)
        if (!horizontalY.includes(lineY)) {
          horizontalY.push(lineY)
        }
      }
    }
  }

  return {
    verticalLines: verticalX.sort((a, b) => a - b),
    horizontalLines: horizontalY.sort((a, b) => a - b),
  }
}

function round(value: number): number {
  return Math.round(value / SNAP_EPSILON) * SNAP_EPSILON
}
