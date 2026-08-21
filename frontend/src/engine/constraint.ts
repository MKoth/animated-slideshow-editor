export type ConstraintType = 'rotationLimit' | 'lookAt' | 'distance' | 'parent'

export interface RotationLimitParams {
  readonly minRotation: number
  readonly maxRotation: number
}

export interface LookAtParams {
  readonly targetX: number
  readonly targetY: number
  readonly targetNodeId?: string
}

export interface DistanceParams {
  readonly targetNodeId?: string
  readonly minDistance: number
  readonly maxDistance: number
}

export interface ParentConstraintParams {
  readonly targetNodeId?: string
  readonly positionInfluence: number
  readonly rotationInfluence: number
  readonly scaleInfluence: number
}

export type ConstraintParams =
  RotationLimitParams | LookAtParams | DistanceParams | ParentConstraintParams

export interface Constraint {
  readonly id: string
  readonly type: ConstraintType
  readonly priority: number
  readonly params: ConstraintParams
}
