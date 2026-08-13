export interface WorldSize {
  readonly width: number
  readonly height: number
}

export interface WorldTransform {
  readonly x: number
  readonly y: number
  readonly rotation: number
  readonly scaleX: number
  readonly scaleY: number
}

export interface WorldRect {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

export interface WorldPoint {
  readonly x: number
  readonly y: number
}

export interface ViewportTransform {
  x: number
  y: number
  scaleX: number
  scaleY: number
}

export function rectOf(a: WorldPoint, b: WorldPoint): WorldRect {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  }
}

export function rectIntersects(a: WorldRect, b: WorldRect): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
}

export function expandRect(rect: WorldRect, margin: number): WorldRect {
  return {
    minX: rect.minX - margin,
    minY: rect.minY - margin,
    maxX: rect.maxX + margin,
    maxY: rect.maxY + margin,
  }
}

export function mergeRect(a: WorldRect, b: WorldRect): WorldRect {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}
