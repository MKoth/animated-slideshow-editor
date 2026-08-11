import type { Engine } from '../internal'
import type { Command } from './command'
import type { NodeJSON } from '../json'
import { walkPreOrder } from '../sceneNode'

export interface DeleteNodeParameters {
  readonly nodeId: string
}

export interface DeleteNodeInverse {
  readonly nodeId: string
  readonly parentId: string | null
  readonly nodes: readonly NodeJSON[]
}

export class DeleteNodeCommand implements Command<DeleteNodeInverse> {
  readonly type = 'DeleteNode'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string

  constructor(input: DeleteNodeParameters) {
    this.#nodeId = input.nodeId
    this.parameters = { nodeId: input.nodeId }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (node.components.camera) {
      throw new Error('The camera node cannot be deleted')
    }
    if (node.parent === null) {
      throw new Error('The root node cannot be deleted')
    }
  }

  execute(engine: Engine): DeleteNodeInverse {
    const node = engine.getNode(this.#nodeId)
    const nodes = [...walkPreOrder(node)].map((entry) => entry.toJSON())
    const parentId = node.parent ? node.parent.id : null
    engine.removeNode(this.#nodeId)
    return { nodeId: this.#nodeId, parentId, nodes }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
