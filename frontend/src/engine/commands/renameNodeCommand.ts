import type { Engine } from '../internal'
import type { Command } from './command'
import { requireNonEmpty } from '../guards'
import { walkPreOrder } from '../sceneNode'

export interface RenameNodeParameters {
  readonly nodeId: string
  readonly name: string
}

export interface RenameNodeInverse {
  readonly nodeId: string
  readonly oldName: string
}

export class RenameNodeCommand implements Command<RenameNodeInverse> {
  readonly type = 'RenameNode'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #name: string

  constructor(input: RenameNodeParameters) {
    this.#nodeId = input.nodeId
    this.#name = input.name
    this.parameters = { nodeId: input.nodeId, name: input.name }
  }

  validate(engine: Engine): void {
    requireNonEmpty(this.#name, 'Node name')
    const node = engine.getNode(this.#nodeId)
    const trimmed = this.#name.trim()
    if (trimmed !== node.name) {
      const scene = engine.getNodeScene(this.#nodeId)
      for (const other of walkPreOrder(scene.root)) {
        if (other.id !== this.#nodeId && other.name === trimmed) {
          throw new Error(`A node with name "${trimmed}" already exists in this scene`)
        }
      }
    }
  }

  execute(engine: Engine): RenameNodeInverse {
    const { name } = engine.getNode(this.#nodeId)
    engine.renameNode(this.#nodeId, this.#name.trim())
    return { nodeId: this.#nodeId, oldName: name }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
