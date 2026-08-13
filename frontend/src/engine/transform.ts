export interface Transform {
  readonly x: number
  readonly y: number
  readonly rotation: number
  readonly scaleX: number
  readonly scaleY: number
}

export function identityTransform(): Transform {
  return { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }
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
