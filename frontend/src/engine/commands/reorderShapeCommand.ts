import type { Engine } from '../internal'
import type { Command } from './command'
import type { Shape } from '../shape'

export interface ReorderShapeParameters {
  readonly nodeId: string
  readonly shapeId: string
  readonly targetCategoryId: string | null
  readonly newIndex: number
}

export interface ReorderShapeInverse {
  readonly nodeId: string
  readonly shapesSnapshot: readonly Shape[]
}

export class ReorderShapeCommand implements Command<ReorderShapeInverse> {
  readonly type = 'ReorderShape'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #shapeId: string
  readonly #targetCategoryId: string | null
  readonly #newIndex: number

  constructor(input: ReorderShapeParameters) {
    this.#nodeId = input.nodeId
    this.#shapeId = input.shapeId
    this.#targetCategoryId = input.targetCategoryId
    this.#newIndex = input.newIndex
    this.parameters = {
      nodeId: input.nodeId,
      shapeId: input.shapeId,
      targetCategoryId: input.targetCategoryId,
      newIndex: input.newIndex,
    }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.mesh)
      throw new Error(`Node "${this.#nodeId}" does not have a mesh component`)
    const shapes = engine.getShapes(this.#nodeId)
    if (!shapes.some((s) => s.id === this.#shapeId))
      throw new Error(`Shape not found: ${this.#shapeId}`)
    if (this.#targetCategoryId !== null) {
      const cats = engine.getShapeCategories(this.#nodeId)
      if (!cats.some((c) => c.id === this.#targetCategoryId)) {
        throw new Error(`Target category not found: ${this.#targetCategoryId}`)
      }
    }
    if (
      typeof this.#newIndex !== 'number' ||
      !Number.isInteger(this.#newIndex) ||
      this.#newIndex < 0
    ) {
      throw new Error('newIndex must be a non-negative integer')
    }
  }

  execute(engine: Engine): ReorderShapeInverse {
    const snapshot = engine
      .getShapes(this.#nodeId)
      .map((s) => ({ ...s, vertices: s.vertices.map((v) => ({ ...v })) }))
    engine.reorderShape(this.#nodeId, this.#shapeId, this.#targetCategoryId, this.#newIndex)
    return { nodeId: this.#nodeId, shapesSnapshot: snapshot }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
