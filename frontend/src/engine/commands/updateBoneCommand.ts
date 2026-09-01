import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'

export interface UpdateBoneParameters {
  readonly nodeId: string
  readonly length?: number
  readonly x?: number
  readonly y?: number
  readonly rotation?: number
}

export interface UpdateBoneInverse {
  readonly nodeId: string
  readonly oldLength: number
  readonly oldX: number
  readonly oldY: number
  readonly oldRotation: number
}

export class UpdateBoneCommand implements Command<UpdateBoneInverse> {
  readonly type = 'UpdateBone'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #length: number | undefined
  readonly #x: number | undefined
  readonly #y: number | undefined
  readonly #rotation: number | undefined

  constructor(input: UpdateBoneParameters) {
    this.#nodeId = input.nodeId
    this.#length = input.length
    this.#x = input.x
    this.#y = input.y
    this.#rotation = input.rotation
    this.parameters = {
      nodeId: input.nodeId,
      ...(input.length !== undefined ? { length: input.length } : {}),
      ...(input.x !== undefined ? { x: input.x } : {}),
      ...(input.y !== undefined ? { y: input.y } : {}),
      ...(input.rotation !== undefined ? { rotation: input.rotation } : {}),
    }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.bone) {
      throw new Error(`Node "${this.#nodeId}" does not have a bone component`)
    }
    if (this.#length !== undefined) {
      requireFiniteNumber(this.#length, 'Bone length')
      if (this.#length <= 0) throw new Error('Bone length must be positive')
    }
    if (this.#x !== undefined) requireFiniteNumber(this.#x, 'X')
    if (this.#y !== undefined) requireFiniteNumber(this.#y, 'Y')
    if (this.#rotation !== undefined) requireFiniteNumber(this.#rotation, 'Rotation')
  }

  execute(engine: Engine): UpdateBoneInverse {
    const node = engine.getNode(this.#nodeId)
    const oldLength = node.components.bone!.length
    const oldX = node.transform.x
    const oldY = node.transform.y
    const oldRotation = node.transform.rotation

    // Apply bone length if provided
    if (this.#length !== undefined) {
      engine.setBoneLength(this.#nodeId, this.#length)
    }
    // Apply transform changes if any
    const needsTransform =
      this.#x !== undefined || this.#y !== undefined || this.#rotation !== undefined
    if (needsTransform) {
      const newTransform = {
        ...node.transform,
        x: this.#x !== undefined ? this.#x : node.transform.x,
        y: this.#y !== undefined ? this.#y : node.transform.y,
        rotation: this.#rotation !== undefined ? this.#rotation : node.transform.rotation,
      }
      engine.setTransform(this.#nodeId, newTransform)
      // Note: setBoneLength already emitted events, setTransform will emit again
      // To avoid double refresh, still okay
    }
    return { nodeId: this.#nodeId, oldLength, oldX, oldY, oldRotation }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
