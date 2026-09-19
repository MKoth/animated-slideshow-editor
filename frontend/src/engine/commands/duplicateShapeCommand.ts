import type { Engine } from '../internal'
import type { Command } from './command'
import type { SymmetryAxis } from '../symmetry'

export interface DuplicateShapeParameters {
  readonly nodeId: string
  readonly shapeId: string
  readonly mirrored?: boolean
  readonly axis?: SymmetryAxis
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
  readonly #mirrored: boolean
  readonly #axis: SymmetryAxis

  constructor(input: DuplicateShapeParameters) {
    this.#nodeId = input.nodeId
    this.#shapeId = input.shapeId
    this.#mirrored = input.mirrored ?? false
    this.#axis = input.axis ?? 'x'
    this.parameters = {
      nodeId: input.nodeId,
      shapeId: input.shapeId,
      ...(input.mirrored !== undefined ? { mirrored: input.mirrored } : {}),
      ...(input.axis !== undefined ? { axis: input.axis } : {}),
    }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.mesh)
      throw new Error(`Node "${this.#nodeId}" does not have a mesh component`)
    const shapes = engine.getShapes(this.#nodeId)
    if (!shapes.some((s) => s.id === this.#shapeId))
      throw new Error(`Shape not found: ${this.#shapeId}`)
    if (this.#axis !== 'x' && this.#axis !== 'y') {
      throw new Error(`Axis must be "x" or "y", got "${String(this.#axis)}"`)
    }
  }

  execute(engine: Engine): DuplicateShapeInverse {
    const duplicated = engine.duplicateShape(this.#nodeId, this.#shapeId, {
      mirrored: this.#mirrored,
      axis: this.#axis,
    })
    return { nodeId: this.#nodeId, shapeId: duplicated.id, shape: duplicated }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
