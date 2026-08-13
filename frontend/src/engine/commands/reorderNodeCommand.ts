import type { Engine } from '../internal'
import type { Command } from './command'

export interface ReorderNodeParameters {
  readonly nodeId: string
  readonly index: number
}

export interface ReorderNodeInverse {
  readonly nodeId: string
  readonly parentId: string
  readonly oldIndex: number
}

export class ReorderNodeCommand implements Command<ReorderNodeInverse> {
  readonly type = 'ReorderNode'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #index: number

  constructor(input: ReorderNodeParameters) {
    this.#nodeId = input.nodeId
    this.#index = input.index
    this.parameters = { nodeId: input.nodeId, index: input.index }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    const parent = node.parent
    if (!parent) {
      throw new Error('The root node cannot be reordered')
    }
    if (node.components.camera) {
      throw new Error('The camera node cannot be reordered')
    }
    if (
      !Number.isInteger(this.#index) ||
      this.#index < 0 ||
      this.#index >= parent.children.length
    ) {
      throw new Error(`Reorder index out of bounds: ${this.#index}`)
    }
    if (parent.children.indexOf(node) === this.#index) {
      throw new Error(`Node "${node.name}" is already at index ${this.#index}`)
    }
  }

  execute(engine: Engine): ReorderNodeInverse {
    const node = engine.getNode(this.#nodeId)
    const parent = node.parent
    if (!parent) {
      throw new Error('The root node cannot be reordered')
    }
    if (node.components.camera) {
      throw new Error('The camera node cannot be reordered')
    }
    const oldIndex = parent.children.indexOf(node)
    engine.reorderNode(this.#nodeId, this.#index)
    return { nodeId: this.#nodeId, parentId: parent.id, oldIndex }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
