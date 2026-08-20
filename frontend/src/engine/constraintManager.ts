import type { EventBus } from './events'
import type { SceneNode } from './sceneNode'
import type { Constraint, ConstraintType, ConstraintParams } from './constraint'
import type { ConstraintJSON, ConstraintParamsJSON, ConstraintManagerJSON } from './json'
import { newId } from './ids'

export class ConstraintManager {
  readonly #bus: EventBus
  readonly #nodeLookup: (nodeId: string) => SceneNode
  readonly #constraints = new Map<string, Constraint>()
  readonly #nodeConstraints = new Map<string, string[]>()

  constructor(bus: EventBus, nodeLookup: (nodeId: string) => SceneNode) {
    this.#bus = bus
    this.#nodeLookup = nodeLookup
  }

  addConstraint(
    nodeId: string,
    type: ConstraintType,
    priority: number,
    params: ConstraintParams,
  ): Constraint {
    const node = this.#nodeLookup(nodeId)
    if (
      (type === 'rotationLimit' || type === 'positionLimit' || type === 'lookAt') &&
      !node.components.bone
    ) {
      throw new Error(`Constraint type "${type}" requires a bone node`)
    }
    if (type === 'distance' || type === 'parent') {
      const p = params as { targetNodeId?: string }
      if (!p.targetNodeId) {
        throw new Error(`Constraint type "${type}" requires a targetNodeId`)
      }
    }
    const id = newId('constraint')
    const constraint: Constraint = { id, type, priority, params: { ...params } }
    this.#constraints.set(id, constraint)
    const list = this.#nodeConstraints.get(nodeId)
    if (list) {
      list.push(id)
    } else {
      this.#nodeConstraints.set(nodeId, [id])
    }
    this.#bus.emit({ type: 'ConstraintAdded', nodeId, constraintId: id, constraintType: type })
    return constraint
  }

  removeConstraint(nodeId: string, constraintId: string): Constraint {
    const constraint = this.#constraints.get(constraintId)
    if (!constraint) {
      throw new Error(`Constraint not found: ${constraintId}`)
    }
    this.#constraints.delete(constraintId)
    const list = this.#nodeConstraints.get(nodeId)
    if (list) {
      const idx = list.indexOf(constraintId)
      if (idx !== -1) {
        list.splice(idx, 1)
        if (list.length === 0) {
          this.#nodeConstraints.delete(nodeId)
        }
      }
    }
    this.#bus.emit({
      type: 'ConstraintRemoved',
      nodeId,
      constraintId,
      constraintType: constraint.type,
    })
    return constraint
  }

  setConstraintParams(nodeId: string, constraintId: string, params: ConstraintParams): void {
    const constraint = this.#constraints.get(constraintId)
    if (!constraint) {
      throw new Error(`Constraint not found: ${constraintId}`)
    }
    ;(constraint as { params: ConstraintParams }).params = { ...params }
    this.#bus.emit({
      type: 'ConstraintChanged',
      nodeId,
      constraintId,
      constraintType: constraint.type,
    })
  }

  getConstraint(constraintId: string): Constraint {
    const constraint = this.#constraints.get(constraintId)
    if (!constraint) {
      throw new Error(`Constraint not found: ${constraintId}`)
    }
    return constraint
  }

  getConstraintsForNode(nodeId: string): readonly Constraint[] {
    const ids = this.#nodeConstraints.get(nodeId)
    if (!ids) {
      return []
    }
    return ids.map((id) => this.#constraints.get(id)!).sort((a, b) => a.priority - b.priority)
  }

  removeConstraintsForNode(nodeId: string): Constraint[] {
    const ids = this.#nodeConstraints.get(nodeId)
    if (!ids) {
      return []
    }
    const removed: Constraint[] = []
    for (const id of [...ids]) {
      const constraint = this.#constraints.get(id)
      if (constraint) {
        this.#constraints.delete(id)
        removed.push(constraint)
        this.#bus.emit({
          type: 'ConstraintRemoved',
          nodeId,
          constraintId: id,
          constraintType: constraint.type,
        })
      }
    }
    this.#nodeConstraints.delete(nodeId)
    return removed
  }

  toJSON(): ConstraintManagerJSON {
    const nodeConstraints: Record<string, ConstraintJSON[]> = {}
    for (const [nodeId, ids] of this.#nodeConstraints) {
      nodeConstraints[nodeId] = ids.map((id) => {
        const c = this.#constraints.get(id)!
        return {
          id: c.id,
          type: c.type,
          priority: c.priority,
          params: paramsToJSON(c.type, c.params),
        }
      })
    }
    return { nodeConstraints }
  }

  restoreFromJSON(json: {
    readonly nodeConstraints: Record<string, readonly ConstraintJSON[]>
  }): void {
    this.clear()
    for (const [nodeId, constraints] of Object.entries(json.nodeConstraints)) {
      const ids: string[] = []
      for (const c of constraints) {
        const constraint: Constraint = {
          id: c.id,
          type: c.type as ConstraintType,
          priority: c.priority,
          params: paramsFromJSON(c.type as ConstraintType, c.params),
        }
        this.#constraints.set(constraint.id, constraint)
        ids.push(constraint.id)
      }
      this.#nodeConstraints.set(nodeId, ids)
    }
  }

  clear(): void {
    this.#constraints.clear()
    this.#nodeConstraints.clear()
  }
}

function paramsToJSON(type: ConstraintType, params: ConstraintParams): ConstraintParamsJSON {
  switch (type) {
    case 'rotationLimit': {
      const p = params as import('./constraint').RotationLimitParams
      return { minRotation: p.minRotation, maxRotation: p.maxRotation }
    }
    case 'positionLimit': {
      const p = params as import('./constraint').PositionLimitParams
      return { minX: p.minX, maxX: p.maxX, minY: p.minY, maxY: p.maxY }
    }
    case 'lookAt': {
      const p = params as import('./constraint').LookAtParams
      return { targetX: p.targetX, targetY: p.targetY, targetNodeId: p.targetNodeId }
    }
    case 'distance': {
      const p = params as import('./constraint').DistanceParams
      return {
        targetNodeId: p.targetNodeId,
        minDistance: p.minDistance,
        maxDistance: p.maxDistance,
      }
    }
    case 'parent': {
      const p = params as import('./constraint').ParentConstraintParams
      return {
        targetNodeId: p.targetNodeId,
        positionInfluence: p.positionInfluence,
        rotationInfluence: p.rotationInfluence,
        scaleInfluence: p.scaleInfluence,
      }
    }
  }
}

function paramsFromJSON(type: ConstraintType, json: ConstraintParamsJSON): ConstraintParams {
  switch (type) {
    case 'rotationLimit':
      return { minRotation: json.minRotation!, maxRotation: json.maxRotation! }
    case 'positionLimit':
      return {
        minX: json.minX!,
        maxX: json.maxX!,
        minY: json.minY!,
        maxY: json.maxY!,
      }
    case 'lookAt':
      return {
        targetX: json.targetX!,
        targetY: json.targetY!,
        targetNodeId: json.targetNodeId,
      }
    case 'distance':
      return {
        targetNodeId: json.targetNodeId!,
        minDistance: json.minDistance!,
        maxDistance: json.maxDistance!,
      }
    case 'parent':
      return {
        targetNodeId: json.targetNodeId!,
        positionInfluence: json.positionInfluence!,
        rotationInfluence: json.rotationInfluence!,
        scaleInfluence: json.scaleInfluence!,
      }
  }
}
