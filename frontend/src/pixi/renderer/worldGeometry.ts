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
