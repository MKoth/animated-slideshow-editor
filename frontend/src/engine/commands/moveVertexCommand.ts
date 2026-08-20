import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'

export interface MoveVertexParameters {
  readonly nodeId: string
  readonly vertexIndex: number
  readonly x: number
  readonly y: number
}

export interface MoveVertexInverse {
  readonly nodeId: string
  readonly vertexIndex: number
  readonly oldX: number
  readonly oldY: number
}

export class MoveVertexCommand implements Command<MoveVertexInverse> {
  readonly type = 'MoveVertex'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #vertexIndex: number
  readonly #x: number
  readonly #y: number

  constructor(input: MoveVertexParameters) {
    this.#nodeId = input.nodeId
    this.#vertexIndex = input.vertexIndex
    this.#x = input.x
    this.#y = input.y
    this.parameters = {
      nodeId: input.nodeId,
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
    const mesh = node.components.mesh.mesh
    if (this.#vertexIndex < 0 || this.#vertexIndex >= mesh.vertices.length) {
      throw new Error(`Vertex index ${this.#vertexIndex} is out of bounds`)
    }
    requireFiniteNumber(this.#x, 'X')
    requireFiniteNumber(this.#y, 'Y')
  }

  execute(engine: Engine): MoveVertexInverse {
    const node = engine.getNode(this.#nodeId)
    const mesh = node.components.mesh!.mesh
    const oldVertex = mesh.vertices[this.#vertexIndex]
    const newVertices = mesh.vertices.map((v, i) =>
      i === this.#vertexIndex ? { x: this.#x, y: this.#y } : { x: v.x, y: v.y },
    )
    const newMesh = { ...mesh, vertices: newVertices }
    engine.setMeshData(this.#nodeId, newMesh)
    return {
      nodeId: this.#nodeId,
      vertexIndex: this.#vertexIndex,
      oldX: oldVertex.x,
      oldY: oldVertex.y,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
