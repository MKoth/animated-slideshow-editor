import type { Engine } from '../internal'
import type { Command } from './command'
import type { ShapeCategory } from '../shapeCategory'

export interface ReorderShapeCategoryParameters {
  readonly nodeId: string
  readonly categoryId: string
  readonly newParentId: string | null
  readonly newIndex: number
}

export interface ReorderShapeCategoryInverse {
  readonly nodeId: string
  readonly categoryId: string
  readonly oldParentId: string | null
  readonly oldIndex: number
  readonly categoriesSnapshot: readonly ShapeCategory[]
}

export class ReorderShapeCategoryCommand implements Command<ReorderShapeCategoryInverse> {
  readonly type = 'ReorderShapeCategory'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #categoryId: string
  readonly #newParentId: string | null
  readonly #newIndex: number

  constructor(input: ReorderShapeCategoryParameters) {
    this.#nodeId = input.nodeId
    this.#categoryId = input.categoryId
    this.#newParentId = input.newParentId
    this.#newIndex = input.newIndex
    this.parameters = {
      nodeId: input.nodeId,
      categoryId: input.categoryId,
      newParentId: input.newParentId,
      newIndex: input.newIndex,
    }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.mesh)
      throw new Error(`Node "${this.#nodeId}" does not have a mesh component`)
    const cats = engine.getShapeCategories(this.#nodeId)
    const target = cats.find((c) => c.id === this.#categoryId)
    if (!target) throw new Error(`Category not found: ${this.#categoryId}`)
    if (this.#newParentId !== null && !cats.some((c) => c.id === this.#newParentId)) {
      throw new Error(`Parent category not found: ${this.#newParentId}`)
    }
    if (
      typeof this.#newIndex !== 'number' ||
      !Number.isInteger(this.#newIndex) ||
      this.#newIndex < 0
    ) {
      throw new Error('newIndex must be a non-negative integer')
    }
  }

  execute(engine: Engine): ReorderShapeCategoryInverse {
    const cats = engine.getShapeCategories(this.#nodeId)
    const old = cats.find((c) => c.id === this.#categoryId)!
    const siblings = cats.filter((c) => c.parentId === old.parentId)
    const oldIndex = siblings.findIndex((c) => c.id === this.#categoryId)
    const snapshot = cats.map((c) => ({ ...c }))
    engine.reorderShapeCategory(this.#nodeId, this.#categoryId, this.#newParentId, this.#newIndex)
    return {
      nodeId: this.#nodeId,
      categoryId: this.#categoryId,
      oldParentId: old.parentId,
      oldIndex,
      categoriesSnapshot: snapshot,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
