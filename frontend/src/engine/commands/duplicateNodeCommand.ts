import type { Engine } from '../internal'
import type { Command } from './command'

export const DUPLICATE_OFFSET = { x: 20, y: 20 } as const

export interface DuplicateNodeParameters {
  readonly nodeId: string
}

export interface DuplicateNodeInverse {
  readonly nodeId: string
}

export class DuplicateNodeCommand implements Command<DuplicateNodeInverse> {
  readonly type = 'DuplicateNode'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string

  constructor(input: DuplicateNodeParameters) {
    this.#nodeId = input.nodeId
    this.parameters = { nodeId: input.nodeId }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.parent) {
      throw new Error('The scene root cannot be duplicated')
    }
    if (node.components.camera) {
      throw new Error('The camera node cannot be duplicated')
    }
  }

  execute(engine: Engine): DuplicateNodeInverse {
    const node = engine.getNode(this.#nodeId)
    if (!node.parent) {
      throw new Error('The scene root cannot be duplicated')
    }
    if (node.components.camera) {
      throw new Error('The camera node cannot be duplicated')
    }
    const result = engine.duplicateNodeSubtree(this.#nodeId)
    return { nodeId: result.rootNewId }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
