import type { Engine } from '../internal'
import type { Command } from './command'

export interface CreateShapeCategoryParameters {
  readonly nodeId: string
  readonly name: string
  readonly parentId: string | null
}

export interface CreateShapeCategoryInverse {
  readonly nodeId: string
  readonly categoryId: string
}

export class CreateShapeCategoryCommand implements Command<CreateShapeCategoryInverse> {
  readonly type = 'CreateShapeCategory'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #name: string
  readonly #parentId: string | null

  constructor(input: CreateShapeCategoryParameters) {
    this.#nodeId = input.nodeId
    this.#name = input.name
    this.#parentId = input.parentId
    this.parameters = { nodeId: input.nodeId, name: input.name, parentId: input.parentId }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.mesh)
      throw new Error(`Node "${this.#nodeId}" does not have a mesh component`)
    if (typeof this.#name !== 'string' || this.#name.trim() === '')
      throw new Error('Category name must be a non-empty string')
    const cats = engine.getShapeCategories(this.#nodeId)
    if (this.#parentId !== null && !cats.some((c) => c.id === this.#parentId)) {
      throw new Error(`Parent category not found: ${this.#parentId}`)
    }
    if (cats.some((c) => c.parentId === this.#parentId && c.name === this.#name.trim())) {
      throw new Error(`A category with name "${this.#name.trim()}" already exists in this folder`)
    }
  }

  execute(engine: Engine): CreateShapeCategoryInverse {
    const cat = engine.createShapeCategory(this.#nodeId, this.#name, this.#parentId)
    return { nodeId: this.#nodeId, categoryId: cat.id }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
