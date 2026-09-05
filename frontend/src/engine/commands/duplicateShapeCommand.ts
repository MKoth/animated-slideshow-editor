import type { Engine } from '../internal'
import type { Command } from './command'

export interface DuplicateShapeParameters {
  readonly nodeId: string
  readonly shapeId: string
}

export interface DuplicateShapeInverse {
  readonly nodeId: string
  readonly shapeId: string
  readonly shape: import('../shape').Shape
}

export class DuplicateShapeCommand implements Command<DuplicateShapeInverse> {
  readonly type = 'DuplicateShape'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #shapeId: string

  constructor(input: DuplicateShapeParameters) {
    this.#nodeId = input.nodeId
    this.#shapeId = input.shapeId
    this.parameters = { nodeId: input.nodeId, shapeId: input.shapeId }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.mesh)
      throw new Error(`Node "${this.#nodeId}" does not have a mesh component`)
    const shapes = engine.getShapes(this.#nodeId)
    if (!shapes.some((s) => s.id === this.#shapeId))
      throw new Error(`Shape not found: ${this.#shapeId}`)
  }

  execute(engine: Engine): DuplicateShapeInverse {
    const duplicated = engine.duplicateShape(this.#nodeId, this.#shapeId)
    return { nodeId: this.#nodeId, shapeId: duplicated.id, shape: duplicated }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
