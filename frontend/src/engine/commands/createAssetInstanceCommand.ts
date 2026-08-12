import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber, requireNonEmpty } from '../guards'
import { namesInTree, uniqueNodeName } from '../naming'
import { identityTransform } from '../transform'

export interface CreateAssetInstanceParameters {
  readonly sceneId: string
  readonly parentId: string
  readonly definitionId: string
  readonly name: string
  readonly position: { readonly x: number; readonly y: number }
  readonly rotation?: number
  readonly scaleX?: number
  readonly scaleY?: number
}

export interface CreateAssetInstanceInverse {
  readonly nodeId: string
}

export class CreateAssetInstanceCommand implements Command<CreateAssetInstanceInverse> {
  readonly type = 'CreateAssetInstance'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #sceneId: string
  readonly #parentId: string
  readonly #definitionId: string
  readonly #name: string
  readonly #x: number
  readonly #y: number
  readonly #rotation: number | undefined
  readonly #scaleX: number | undefined
  readonly #scaleY: number | undefined

  constructor(input: CreateAssetInstanceParameters) {
    this.#sceneId = input.sceneId
    this.#parentId = input.parentId
    this.#definitionId = input.definitionId
    this.#name = input.name
    this.#x = input.position.x
    this.#y = input.position.y
    this.#rotation = input.rotation
    this.#scaleX = input.scaleX
    this.#scaleY = input.scaleY
    const parameters: Record<string, unknown> = {
      sceneId: input.sceneId,
      parentId: input.parentId,
      definitionId: input.definitionId,
      name: input.name,
      position: { x: input.position.x, y: input.position.y },
    }
    if (input.rotation !== undefined) {
      parameters.rotation = input.rotation
    }
    if (input.scaleX !== undefined) {
      parameters.scaleX = input.scaleX
    }
    if (input.scaleY !== undefined) {
      parameters.scaleY = input.scaleY
    }
    this.parameters = parameters
  }

  validate(engine: Engine): void {
    requireNonEmpty(this.#name, 'Node name')
    requireFiniteNumber(this.#x, 'Position x')
    requireFiniteNumber(this.#y, 'Position y')
    if (this.#rotation !== undefined) {
      requireFiniteNumber(this.#rotation, 'Rotation')
    }
    if (this.#scaleX !== undefined) {
      requireFiniteNumber(this.#scaleX, 'Scale X')
    }
    if (this.#scaleY !== undefined) {
      requireFiniteNumber(this.#scaleY, 'Scale Y')
    }
    engine.getAssetDefinition(this.#definitionId)
    const scene = engine.getScene(this.#sceneId)
    if (!scene.getNode(this.#parentId)) {
      throw new Error(`Parent node not found: ${this.#parentId}`)
    }
  }

  execute(engine: Engine): CreateAssetInstanceInverse {
    const scene = engine.getScene(this.#sceneId)
    const name = uniqueNodeName(namesInTree(scene.root), this.#name)
    const node = engine.createAssetInstance(
      this.#sceneId,
      this.#parentId,
      this.#definitionId,
      name,
      {
        transform: {
          ...identityTransform(),
          x: this.#x,
          y: this.#y,
          rotation: this.#rotation ?? 0,
          scaleX: this.#scaleX ?? 1,
          scaleY: this.#scaleY ?? 1,
        },
      },
    )
    return { nodeId: node.id }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
