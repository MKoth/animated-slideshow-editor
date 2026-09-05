import type { Engine } from '../internal'
import type { Command } from './command'

export interface RenameShapeParameters {
  readonly nodeId: string
  readonly shapeId: string
  readonly newName: string
}

export interface RenameShapeInverse {
  readonly nodeId: string
  readonly shapeId: string
  readonly oldName: string
}

export class RenameShapeCommand implements Command<RenameShapeInverse> {
  readonly type = 'RenameShape'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #shapeId: string
  readonly #newName: string

  constructor(input: RenameShapeParameters) {
    this.#nodeId = input.nodeId
    this.#shapeId = input.shapeId
    this.#newName = input.newName
    this.parameters = { nodeId: input.nodeId, shapeId: input.shapeId, newName: input.newName }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.mesh)
      throw new Error(`Node "${this.#nodeId}" does not have a mesh component`)
    if (typeof this.#newName !== 'string' || this.#newName.trim() === '')
      throw new Error('Shape name must be a non-empty string')
    const shapes = engine.getShapes(this.#nodeId)
    const target = shapes.find((s) => s.id === this.#shapeId)
    if (!target) throw new Error(`Shape not found: ${this.#shapeId}`)
    if (shapes.some((s) => s.id !== this.#shapeId && s.name === this.#newName.trim())) {
      throw new Error(`A shape with name "${this.#newName.trim()}" already exists on this mesh`)
    }
  }

  execute(engine: Engine): RenameShapeInverse {
    const shapes = engine.getShapes(this.#nodeId)
    const target = shapes.find((s) => s.id === this.#shapeId)
    if (!target) throw new Error(`Shape not found: ${this.#shapeId}`)
    const oldName = target.name
    engine.renameShape(this.#nodeId, this.#shapeId, this.#newName)
    return { nodeId: this.#nodeId, shapeId: this.#shapeId, oldName }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
