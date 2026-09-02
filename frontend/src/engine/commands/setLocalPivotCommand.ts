import type { Engine } from '../internal'
import type { Command } from './command'
import { validatePivot, type Pivot, isIdentityPivot } from '../transform'
import { worldTransformOf, relativeTransform } from '../worldTransform'

export interface SetLocalPivotParameters {
  readonly nodeId: string
  readonly pivot: Pivot
  /** Keep world bounds stable by recomputing position (default true) */
  readonly keepWorldBounds?: boolean
}

export interface SetLocalPivotInverse {
  readonly nodeId: string
  readonly oldPivot: Pivot | undefined
  readonly oldTransform: { x: number; y: number }
}

export class SetLocalPivotCommand implements Command<SetLocalPivotInverse> {
  readonly type = 'SetLocalPivot'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #pivot: Pivot
  readonly #keepWorldBounds: boolean

  constructor(input: SetLocalPivotParameters) {
    this.#nodeId = input.nodeId
    this.#pivot = { x: input.pivot.x, y: input.pivot.y }
    this.#keepWorldBounds = input.keepWorldBounds ?? true
    this.parameters = {
      nodeId: input.nodeId,
      pivot: { ...this.#pivot },
      keepWorldBounds: this.#keepWorldBounds,
    }
  }

  validate(engine: Engine): void {
    engine.getNode(this.#nodeId)
    validatePivot(this.#pivot, 'Pivot')
  }

  execute(engine: Engine): SetLocalPivotInverse {
    const node = engine.getNode(this.#nodeId)
    const oldPivot = node.transform.localPivot ? { ...node.transform.localPivot } : undefined
    const oldTransform = { x: node.transform.x, y: node.transform.y }
    const oldWorld = worldTransformOf(engine.getNodeScene(this.#nodeId), this.#nodeId)

    // Apply new pivot
    const sanitized = isIdentityPivot(this.#pivot) ? undefined : { ...this.#pivot }
    const current = node.transform
    const nextTransform = sanitized
      ? { ...current, localPivot: sanitized }
      : { x: current.x, y: current.y, rotation: current.rotation, scaleX: current.scaleX, scaleY: current.scaleY }
    engine.setTransform(this.#nodeId, nextTransform)

    if (this.#keepWorldBounds && oldWorld) {
      // Keep world bounds (visual center) stable.
      // For pivot point model, pivotWorld is at transform position.
      // Bounds center = pivotWorld - pivotOffset*scale rotated.
      // To keep bounds center stable when pivot changes, pivotWorld must move by deltaPivot*scale rotated.
      // Instead of analytic, we keep oldWorld pivot point stable (Keep World Transform) as simpler:
      // oldWorld is pivot point world; new pivot point world should stay same, so local position stays same?
      // Actually for pivot point model, pivotWorld is exactly worldTransform position, which is at local.x,y composed.
      // Changing pivot does not change pivotWorld if local.x,y unchanged, so no recompute needed for pivotWorld stable.
      // For bounds center stable, we need to move pivotWorld by deltaPivot*scale.
      // We'll implement bounds-center stable: newLocal = oldLocal + (oldPivot - newPivot)*size? But we don't have size here.
      // For engine-level without size, we keep pivotWorld stable (no move). The UI layer (pivotInteraction) will handle size-dependent bounds stability via Transaction with MoveNode.
      // So engine command keeps pivotWorld stable by not moving (already).
      // If we wanted bounds stable without size, we'd need size, so we defer to UI.
      // For now, keep simple: do not move for engine-level; UI will add Move if needed.
      // However, if the node's parent has scale/rotation, the local position that keeps world pivot stable is via relativeTransform.
      const parent = node.parent
      if (parent) {
        const parentWorld = worldTransformOf(engine.getNodeScene(this.#nodeId), parent.id)
        if (parentWorld) {
          const desiredWorld = oldWorld
          const relative = relativeTransform(desiredWorld, parentWorld)
          if (relative) {
            // Preserve rotation/scale, only adjust x,y to keep world pivot stable
            const adjusted = engine.getNode(this.#nodeId).transform
            // Only adjust position, keep pivot, rotation, scale as set
            const withPosition = { ...adjusted, x: relative.x, y: relative.y }
            // Only apply if different
            if (withPosition.x !== adjusted.x || withPosition.y !== adjusted.y) {
              engine.setTransform(this.#nodeId, withPosition)
            }
          }
        }
      }
    }

    return { nodeId: this.#nodeId, oldPivot, oldTransform }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
