import type { Engine } from '../internal'
import type { Command } from './command'
import type { SymmetryAxis } from '../symmetry'

export interface CopyShapeToMeshParameters {
  readonly sourceNodeId: string
  readonly sourceShapeId: string
  readonly targetNodeId: string
  readonly mirrored?: boolean
  readonly axis?: SymmetryAxis
  readonly name?: string
}

export interface CopyShapeToMeshInverse {
  readonly targetNodeId: string
  readonly shapeId: string
  readonly shape: import('../shape').Shape
}

export class CopyShapeToMeshCommand implements Command<CopyShapeToMeshInverse> {
  readonly type = 'CopyShapeToMesh'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #sourceNodeId: string
  readonly #sourceShapeId: string
  readonly #targetNodeId: string
  readonly #mirrored: boolean
  readonly #axis: SymmetryAxis
  readonly #name: string | undefined

  constructor(input: CopyShapeToMeshParameters) {
    this.#sourceNodeId = input.sourceNodeId
    this.#sourceShapeId = input.sourceShapeId
    this.#targetNodeId = input.targetNodeId
    this.#mirrored = input.mirrored ?? false
    this.#axis = input.axis ?? 'x'
    this.#name = input.name
    this.parameters = {
      sourceNodeId: input.sourceNodeId,
      sourceShapeId: input.sourceShapeId,
      targetNodeId: input.targetNodeId,
      ...(input.mirrored !== undefined ? { mirrored: input.mirrored } : {}),
      ...(input.axis !== undefined ? { axis: input.axis } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
    }
  }

  validate(engine: Engine): void {
    const sourceNode = engine.getNode(this.#sourceNodeId)
    if (!sourceNode.components.mesh) {
      throw new Error(`Source node "${this.#sourceNodeId}" does not have a mesh component`)
    }
    const targetNode = engine.getNode(this.#targetNodeId)
    if (!targetNode.components.mesh) {
      throw new Error(`Target node "${this.#targetNodeId}" does not have a mesh component`)
    }
    const sourceShapes = engine.getShapes(this.#sourceNodeId)
    const sourceShape = sourceShapes.find((s) => s.id === this.#sourceShapeId)
    if (!sourceShape) throw new Error(`Source shape not found: ${this.#sourceShapeId}`)
    if (this.#axis !== 'x' && this.#axis !== 'y') {
      throw new Error(`Axis must be "x" or "y", got "${String(this.#axis)}"`)
    }
    if (this.#name !== undefined && (typeof this.#name !== 'string' || this.#name.trim() === '')) {
      throw new Error('Shape name must be a non-empty string')
    }
    const targetMesh = targetNode.components.mesh.mesh
    if (sourceShape.vertices.length !== targetMesh.vertices.length) {
      throw new Error(
        `Topology mismatch: source shape "${sourceShape.name}" has ${sourceShape.vertices.length} vertices but target mesh has ${targetMesh.vertices.length}. Shapes can only be copied between meshes with the same topology (same vertex count).`,
      )
    }
  }

  execute(engine: Engine): CopyShapeToMeshInverse {
    const shape = engine.copyShapeToNode(
      this.#sourceNodeId,
      this.#sourceShapeId,
      this.#targetNodeId,
      {
        mirrored: this.#mirrored,
        axis: this.#axis,
        ...(this.#name !== undefined ? { name: this.#name } : {}),
      },
    )
    return { targetNodeId: this.#targetNodeId, shapeId: shape.id, shape }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
