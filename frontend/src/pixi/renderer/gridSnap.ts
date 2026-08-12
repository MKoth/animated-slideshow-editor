import type { WorldPoint } from './worldGeometry'

export const DEFAULT_GRID_STEP = 25

export function snapToGrid(value: number, step: number = DEFAULT_GRID_STEP): number {
  if (!isFinite(value) || !isFinite(step) || step <= 0) {
    return value
  }
  return Math.round(value / step) * step
}

export function snapPoint(point: WorldPoint, step: number = DEFAULT_GRID_STEP): WorldPoint {
  return { x: snapToGrid(point.x, step), y: snapToGrid(point.y, step) }
}

export function snapDelta(
  deltaX: number,
  deltaY: number,
  originX: number,
  originY: number,
  step: number = DEFAULT_GRID_STEP,
): { x: number; y: number } {
  return {
    x: snapToGrid(originX + deltaX, step) - originX,
    y: snapToGrid(originY + deltaY, step) - originY,
  }
}
