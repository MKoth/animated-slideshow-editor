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

export const PIVOT_MIN = -0.5
export const PIVOT_MAX = 0.5

export function identityTransform(): Transform {
  return { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }
}

export function pivotsEqual(a: Pivot, b: Pivot): boolean {
  return a.x === b.x && a.y === b.y
}

export function isIdentityPivot(pivot: Pivot | undefined): boolean {
  if (!pivot) return true
  return pivot.x === IDENTITY_PIVOT.x && pivot.y === IDENTITY_PIVOT.y
}

export function validatePivot(pivot: Pivot, what = 'Pivot'): void {
  if (typeof pivot.x !== 'number' || !Number.isFinite(pivot.x)) {
    throw new Error(`${what} x must be a finite number`)
  }
  if (typeof pivot.y !== 'number' || !Number.isFinite(pivot.y)) {
    throw new Error(`${what} y must be a finite number`)
  }
  if (pivot.x < PIVOT_MIN - 1e-9 || pivot.x > PIVOT_MAX + 1e-9) {
    throw new Error(`${what} x must be between ${PIVOT_MIN} and ${PIVOT_MAX}`)
  }
  if (pivot.y < PIVOT_MIN - 1e-9 || pivot.y > PIVOT_MAX + 1e-9) {
    throw new Error(`${what} y must be between ${PIVOT_MIN} and ${PIVOT_MAX}`)
  }
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
