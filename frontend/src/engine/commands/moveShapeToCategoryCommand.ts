import type { Engine } from '../internal'
import type { Command } from './command'

export interface MoveShapeToCategoryParameters {
  readonly nodeId: string
  readonly shapeId: string
  readonly targetCategoryId: string | null
}

export interface MoveShapeToCategoryInverse {
  readonly nodeId: string
  readonly shapeId: string
  readonly oldCategoryId: string | null
}

export class MoveShapeToCategoryCommand implements Command<MoveShapeToCategoryInverse> {
  readonly type = 'MoveShapeToCategory'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #shapeId: string
  readonly #targetCategoryId: string | null

  constructor(input: MoveShapeToCategoryParameters) {
    this.#nodeId = input.nodeId
    this.#shapeId = input.shapeId
    this.#targetCategoryId = input.targetCategoryId
    this.parameters = {
      nodeId: input.nodeId,
      shapeId: input.shapeId,
      targetCategoryId: input.targetCategoryId,
    }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.mesh)
      throw new Error(`Node "${this.#nodeId}" does not have a mesh component`)
    const shapes = engine.getShapes(this.#nodeId)
    const target = shapes.find((s) => s.id === this.#shapeId)
    if (!target) throw new Error(`Shape not found: ${this.#shapeId}`)
    if (this.#targetCategoryId !== null) {
      const cats = engine.getShapeCategories(this.#nodeId)
      if (!cats.some((c) => c.id === this.#targetCategoryId)) {
        throw new Error(`Target category not found: ${this.#targetCategoryId}`)
      }
    }
    if (target.categoryId !== this.#targetCategoryId) {
      if (
        shapes.some(
          (s) =>
            s.id !== this.#shapeId &&
            s.categoryId === this.#targetCategoryId &&
            s.name === target.name,
        )
      ) {
        throw new Error(`A shape with name "${target.name}" already exists in the target category`)
      }
    }
  }

  execute(engine: Engine): MoveShapeToCategoryInverse {
    const shapes = engine.getShapes(this.#nodeId)
    const old = shapes.find((s) => s.id === this.#shapeId)!.categoryId ?? null
    engine.moveShapeToCategory(this.#nodeId, this.#shapeId, this.#targetCategoryId)
    return { nodeId: this.#nodeId, shapeId: this.#shapeId, oldCategoryId: old }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
