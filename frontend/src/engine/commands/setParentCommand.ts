import type { Engine } from '../internal'
import type { Transform } from '../transform'
import { relativeTransform, transformsEqual, worldTransformOf } from '../worldTransform'
import type { Command } from './command'
import { wouldFormCycle } from '../sceneNode'

export interface SetParentParameters {
  readonly nodeId: string
  readonly parentId: string
  readonly maintainWorldTransform?: boolean
  readonly index?: number
}

export interface SetParentInverse {
  readonly nodeId: string
  readonly oldParentId: string
  readonly oldTransform: Transform
}

export class SetParentCommand implements Command<SetParentInverse> {
  readonly type = 'SetParent'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #parentId: string
  readonly #maintainWorldTransform: boolean
  readonly #index: number | undefined

  constructor(input: SetParentParameters) {
    this.#nodeId = input.nodeId
    this.#parentId = input.parentId
    this.#maintainWorldTransform = input.maintainWorldTransform ?? true
    this.#index = input.index
    this.parameters = {
      nodeId: input.nodeId,
      parentId: input.parentId,
      maintainWorldTransform: this.#maintainWorldTransform,
      ...(input.index !== undefined && { index: input.index }),
    }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (node.parent === null) {
      throw new Error('The root node cannot be reparented')
    }
    if (node.components.camera) {
      throw new Error('The camera node cannot be reparented')
    }
    const newParent = engine.getNodeScene(this.#nodeId).getNode(this.#parentId)
    if (!newParent) {
      throw new Error(`Parent node not found: ${this.#parentId}`)
    }
    if (this.#index !== undefined) {
      const bound = newParent.children.length + (newParent.children.includes(node) ? -1 : 0)
      if (!Number.isInteger(this.#index) || this.#index < 0 || this.#index > bound) {
        throw new Error(`Reorder index out of bounds: ${this.#index}`)
      }
    }
    if (node === newParent) {
      throw new Error('A node cannot be reparented to itself')
    }
    if (wouldFormCycle(node, newParent)) {
      throw new Error('A node cannot become a descendant of itself')
    }
  }

  execute(engine: Engine): SetParentInverse {
    const node = engine.getNode(this.#nodeId)
    const oldParentId = node.parent ? node.parent.id : this.#parentId
    const oldTransform: Transform = { ...node.transform }
    const oldWorld = worldTransformOf(engine.getNodeScene(this.#nodeId), this.#nodeId)
    const newParentWorld = worldTransformOf(engine.getNodeScene(this.#nodeId), this.#parentId)
    engine.reparentNode(this.#nodeId, this.#parentId)
    if (this.#index !== undefined) {
      const newParent = engine.getNode(this.#parentId)
      const current = newParent.children.indexOf(node)
      if (current !== this.#index) {
        engine.reorderNode(this.#nodeId, this.#index)
      }
    }
    if (this.#maintainWorldTransform && oldWorld && newParentWorld) {
      const adjusted = relativeTransform(oldWorld, newParentWorld)
      const current = engine.getNode(this.#nodeId).transform
      if (adjusted && !transformsEqual(adjusted, current)) {
        engine.setTransform(this.#nodeId, adjusted)
      }
    }
    return { nodeId: this.#nodeId, oldParentId, oldTransform }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
