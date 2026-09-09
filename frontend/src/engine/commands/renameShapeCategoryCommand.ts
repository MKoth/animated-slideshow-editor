import type { Engine } from '../internal'
import type { Command } from './command'

export interface RenameShapeCategoryParameters {
  readonly nodeId: string
  readonly categoryId: string
  readonly newName: string
}

export interface RenameShapeCategoryInverse {
  readonly nodeId: string
  readonly categoryId: string
  readonly oldName: string
}

export class RenameShapeCategoryCommand implements Command<RenameShapeCategoryInverse> {
  readonly type = 'RenameShapeCategory'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #categoryId: string
  readonly #newName: string

  constructor(input: RenameShapeCategoryParameters) {
    this.#nodeId = input.nodeId
    this.#categoryId = input.categoryId
    this.#newName = input.newName
    this.parameters = { nodeId: input.nodeId, categoryId: input.categoryId, newName: input.newName }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.mesh)
      throw new Error(`Node "${this.#nodeId}" does not have a mesh component`)
    if (typeof this.#newName !== 'string' || this.#newName.trim() === '')
      throw new Error('Category name must be a non-empty string')
    const cats = engine.getShapeCategories(this.#nodeId)
    const target = cats.find((c) => c.id === this.#categoryId)
    if (!target) throw new Error(`Category not found: ${this.#categoryId}`)
    if (
      cats.some(
        (c) =>
          c.id !== this.#categoryId &&
          c.parentId === target.parentId &&
          c.name === this.#newName.trim(),
      )
    ) {
      throw new Error(
        `A category with name "${this.#newName.trim()}" already exists in this folder`,
      )
    }
  }

  execute(engine: Engine): RenameShapeCategoryInverse {
    const cats = engine.getShapeCategories(this.#nodeId)
    const oldName = cats.find((c) => c.id === this.#categoryId)!.name
    engine.renameShapeCategory(this.#nodeId, this.#categoryId, this.#newName)
    return { nodeId: this.#nodeId, categoryId: this.#categoryId, oldName }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
