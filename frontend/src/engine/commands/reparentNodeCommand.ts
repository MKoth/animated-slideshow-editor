import type { Engine } from '../internal'
import type { Command } from './command'
import { wouldFormCycle } from '../sceneNode'

export interface ReparentNodeParameters {
  readonly nodeId: string
  readonly parentId: string
}

export interface ReparentNodeInverse {
  readonly nodeId: string
  readonly oldParentId: string
}

export class ReparentNodeCommand implements Command<ReparentNodeInverse> {
  readonly type = 'ReparentNode'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #parentId: string

  constructor(input: ReparentNodeParameters) {
    this.#nodeId = input.nodeId
    this.#parentId = input.parentId
    this.parameters = { nodeId: input.nodeId, parentId: input.parentId }
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
    engine.reparentNode(this.#nodeId, this.#parentId)
    return { nodeId: this.#nodeId, oldParentId }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
