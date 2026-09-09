import type { Engine } from '../internal'
import type { Command } from './command'

export interface CreateBakedShapeParameters {
  readonly nodeId: string
  readonly name: string
  readonly categoryId?: string | null
  /** Playhead time to evaluate morph/symmetry/bones. Defaults to 0 if omitted. */
  readonly time?: number
}

export interface CreateBakedShapeInverse {
  readonly nodeId: string
  readonly shapeId: string
  readonly shape: import('../shape').Shape
}

export class CreateBakedShapeCommand implements Command<CreateBakedShapeInverse> {
  readonly type = 'CreateBakedShape'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #name: string
  readonly #categoryId: string | null
  readonly #time: number

  constructor(input: CreateBakedShapeParameters) {
    this.#nodeId = input.nodeId
    this.#name = input.name
    this.#categoryId = input.categoryId ?? null
    this.#time = input.time ?? 0
    this.parameters = {
      nodeId: input.nodeId,
      name: input.name,
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.time !== undefined ? { time: input.time } : {}),
    }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.mesh)
      throw new Error(`Node "${this.#nodeId}" does not have a mesh component`)
    if (typeof this.#name !== 'string' || this.#name.trim() === '')
      throw new Error('Shape name must be a non-empty string')
    const existing = engine.getShapes(this.#nodeId)
    const catId = this.#categoryId ?? null
    if (catId !== null) {
      const cats = engine.getShapeCategories(this.#nodeId)
      if (!cats.some((c) => c.id === catId)) throw new Error(`Shape category not found: ${catId}`)
    }
    if (existing.some((s) => (s.categoryId ?? null) === catId && s.name === this.#name.trim())) {
      throw new Error(`A shape with name "${this.#name.trim()}" already exists in this category`)
    }
    if (typeof this.#time !== 'number' || !Number.isFinite(this.#time)) {
      throw new Error('Time must be a finite number')
    }
  }

  execute(engine: Engine): CreateBakedShapeInverse {
    const shape = engine.createBakedShape(this.#nodeId, this.#name, this.#categoryId, this.#time)
    return { nodeId: this.#nodeId, shapeId: shape.id, shape }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
