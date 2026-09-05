import type { Engine } from '../internal'
import type { Command } from './command'
import type { Shape } from '../shape'

export interface DeleteShapeParameters {
  readonly nodeId: string
  readonly shapeId: string
}

export interface DeleteShapeInverse {
  readonly nodeId: string
  readonly shape: Shape
  readonly index: number
}

export class DeleteShapeCommand implements Command<DeleteShapeInverse> {
  readonly type = 'DeleteShape'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #shapeId: string

  constructor(input: DeleteShapeParameters) {
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

  execute(engine: Engine): DeleteShapeInverse {
    const shapes = engine.getShapes(this.#nodeId)
    const idx = shapes.findIndex((s) => s.id === this.#shapeId)
    if (idx === -1) throw new Error(`Shape not found: ${this.#shapeId}`)
    const shape = shapes[idx] as Shape
    engine.deleteShape(this.#nodeId, this.#shapeId)
    return { nodeId: this.#nodeId, shape, index: idx }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
