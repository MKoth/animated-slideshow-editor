import type { Engine } from '../internal'
import type { Command } from './command'

export interface CreateShapeParameters {
  readonly nodeId: string
  readonly name: string
}

export interface CreateShapeInverse {
  readonly nodeId: string
  readonly shapeId: string
  readonly shape: import('../shape').Shape
}

export class CreateShapeCommand implements Command<CreateShapeInverse> {
  readonly type = 'CreateShape'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #name: string

  constructor(input: CreateShapeParameters) {
    this.#nodeId = input.nodeId
    this.#name = input.name
    this.parameters = { nodeId: input.nodeId, name: input.name }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.mesh)
      throw new Error(`Node "${this.#nodeId}" does not have a mesh component`)
    if (typeof this.#name !== 'string' || this.#name.trim() === '')
      throw new Error('Shape name must be a non-empty string')
    const existing = engine.getShapes(this.#nodeId)
    if (existing.some((s) => s.name === this.#name.trim())) {
      throw new Error(`A shape with name "${this.#name.trim()}" already exists on this mesh`)
    }
  }

  execute(engine: Engine): CreateShapeInverse {
    const shape = engine.createShape(this.#nodeId, this.#name)
    return { nodeId: this.#nodeId, shapeId: shape.id, shape }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
