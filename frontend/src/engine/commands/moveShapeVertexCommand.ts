import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'

export interface MoveShapeVertexParameters {
  readonly nodeId: string
  readonly shapeId: string
  readonly vertexIndex: number
  readonly x: number
  readonly y: number
}

export interface MoveShapeVertexInverse {
  readonly nodeId: string
  readonly shapeId: string
  readonly vertexIndex: number
  readonly oldX: number
  readonly oldY: number
}

export class MoveShapeVertexCommand implements Command<MoveShapeVertexInverse> {
  readonly type = 'MoveShapeVertex'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #shapeId: string
  readonly #vertexIndex: number
  readonly #x: number
  readonly #y: number

  constructor(input: MoveShapeVertexParameters) {
    this.#nodeId = input.nodeId
    this.#shapeId = input.shapeId
    this.#vertexIndex = input.vertexIndex
    this.#x = input.x
    this.#y = input.y
    this.parameters = {
      nodeId: input.nodeId,
      shapeId: input.shapeId,
      vertexIndex: input.vertexIndex,
      x: input.x,
      y: input.y,
    }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.mesh) {
      throw new Error(`Node "${this.#nodeId}" does not have a mesh component`)
    }
    const shapes = engine.getShapes(this.#nodeId)
    const shape = shapes.find((s) => s.id === this.#shapeId)
    if (!shape) {
      throw new Error(`Shape "${this.#shapeId}" not found on node "${this.#nodeId}"`)
    }
    if (this.#vertexIndex < 0 || this.#vertexIndex >= shape.vertices.length) {
      throw new Error(`Vertex index ${this.#vertexIndex} is out of bounds`)
    }
    requireFiniteNumber(this.#x, 'X')
    requireFiniteNumber(this.#y, 'Y')
  }

  execute(engine: Engine): MoveShapeVertexInverse {
    const shapes = engine.getShapes(this.#nodeId)
    const shape = shapes.find((s) => s.id === this.#shapeId)
    if (!shape) throw new Error(`Shape "${this.#shapeId}" not found`)
    const oldVertex = shape.vertices[this.#vertexIndex]
    if (!oldVertex) throw new Error(`Vertex index ${this.#vertexIndex} out of bounds`)
    engine.setShapeVertex(this.#nodeId, this.#shapeId, this.#vertexIndex, this.#x, this.#y)
    return {
      nodeId: this.#nodeId,
      shapeId: this.#shapeId,
      vertexIndex: this.#vertexIndex,
      oldX: oldVertex.x,
      oldY: oldVertex.y,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
