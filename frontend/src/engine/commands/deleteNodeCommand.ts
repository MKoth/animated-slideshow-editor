import type { Engine } from '../internal'
import type { Command } from './command'
import type { NodeJSON } from '../json'
import type { NodeAnimation } from '../nodeAnimation'
import { walkPreOrder } from '../sceneNode'

export interface DeleteNodeParameters {
  readonly nodeId: string
}

export interface DeleteNodeInverse {
  readonly nodeId: string
  readonly parentId: string | null
  readonly nodes: readonly NodeJSON[]
  /**
   * Deep copies of the deleted subtree's animation, one per node that held
   * tracks. Deleting a node drops its keyframes from the slide animation
   * store, so undo reinstalls these copies after recreating the nodes.
   */
  readonly animations: readonly { readonly nodeId: string; readonly animation: NodeAnimation }[]
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
    const slide = engine.getSlideOfNode(this.#nodeId)
    const animations: { nodeId: string; animation: NodeAnimation }[] = []
    for (const entry of walkPreOrder(node)) {
      const animation = slide.animation.node(entry.id)?.copy()
      if (animation !== undefined) {
        animations.push({ nodeId: entry.id, animation })
      }
    }
    engine.removeNode(this.#nodeId)
    return { nodeId: this.#nodeId, parentId, nodes, animations }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
