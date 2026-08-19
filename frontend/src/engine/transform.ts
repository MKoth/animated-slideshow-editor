export interface Pivot {
  readonly x: number
  readonly y: number
}

export interface Transform {
  readonly x: number
  readonly y: number
  readonly rotation: number
  readonly scaleX: number
  readonly scaleY: number
  readonly localPivot?: Pivot
}

export const IDENTITY_PIVOT: Readonly<Pivot> = { x: 0, y: 0 }

export function identityTransform(): Transform {
  return { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }
}

export function pivotsEqual(a: Pivot, b: Pivot): boolean {
  return a.x === b.x && a.y === b.y
}

export function normalizeRotation(rotation: number): number {
  const TWO_PI = Math.PI * 2
  let value = rotation % TWO_PI
  if (value > Math.PI) {
    value -= TWO_PI
  } else if (value < -Math.PI) {
    value += TWO_PI
  }
  return value
}
