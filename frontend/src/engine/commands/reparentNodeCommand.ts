import type { Engine } from '../internal'
import type { Transform } from '../transform'
import { relativeTransform, transformsEqual, worldTransformOf } from '../worldTransform'
import type { Command } from './command'
import { wouldFormCycle } from '../sceneNode'

export interface ReparentNodeParameters {
  readonly nodeId: string
  readonly parentId: string
  readonly index?: number
}

export interface ReparentNodeInverse {
  readonly nodeId: string
  readonly oldParentId: string
  readonly oldTransform: Transform
}

export class ReparentNodeCommand implements Command<ReparentNodeInverse> {
  readonly type = 'ReparentNode'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #parentId: string
  readonly #index: number | undefined

  constructor(input: ReparentNodeParameters) {
    this.#nodeId = input.nodeId
    this.#parentId = input.parentId
    this.#index = input.index
    this.parameters = {
      nodeId: input.nodeId,
      parentId: input.parentId,
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

  execute(engine: Engine): ReparentNodeInverse {
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
    const reparentedNode = engine.getNode(this.#nodeId)
    const newParent = reparentedNode.parent
    const isBoneToBone = reparentedNode.components.bone && newParent?.components.bone
    if (isBoneToBone) {
      const parentLength = newParent!.components.bone!.length
      const boneTransform: Transform = {
        x: parentLength,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
      }
      engine.setTransform(this.#nodeId, boneTransform)
    } else if (oldWorld && newParentWorld) {
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
