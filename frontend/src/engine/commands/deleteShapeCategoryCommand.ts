import type { Engine } from '../internal'
import type { Command } from './command'
import type { ShapeCategory } from '../shapeCategory'

export interface DeleteShapeCategoryParameters {
  readonly nodeId: string
  readonly categoryId: string
}

export interface DeleteShapeCategoryInverse {
  readonly nodeId: string
  readonly category: ShapeCategory
  readonly index: number
}

export class DeleteShapeCategoryCommand implements Command<DeleteShapeCategoryInverse> {
  readonly type = 'DeleteShapeCategory'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #categoryId: string

  constructor(input: DeleteShapeCategoryParameters) {
    this.#nodeId = input.nodeId
    this.#categoryId = input.categoryId
    this.parameters = { nodeId: input.nodeId, categoryId: input.categoryId }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.mesh)
      throw new Error(`Node "${this.#nodeId}" does not have a mesh component`)
    const cats = engine.getShapeCategories(this.#nodeId)
    const target = cats.find((c) => c.id === this.#categoryId)
    if (!target) throw new Error(`Category not found: ${this.#categoryId}`)
    if (cats.some((c) => c.parentId === this.#categoryId)) {
      throw new Error(`Cannot delete category "${target.name}" — it contains subcategories`)
    }
    const shapes = engine.getShapes(this.#nodeId)
    if (shapes.some((s) => s.categoryId === this.#categoryId)) {
      throw new Error(`Cannot delete category "${target.name}" — it contains shapes`)
    }
  }

  execute(engine: Engine): DeleteShapeCategoryInverse {
    const cats = engine.getShapeCategories(this.#nodeId)
    const idx = cats.findIndex((c) => c.id === this.#categoryId)
    const cat = cats[idx]!
    engine.deleteShapeCategory(this.#nodeId, this.#categoryId)
    return { nodeId: this.#nodeId, category: cat, index: idx }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
