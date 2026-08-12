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

  constructor(input: CreateAssetInstanceParameters) {
    this.#sceneId = input.sceneId
    this.#parentId = input.parentId
    this.#definitionId = input.definitionId
    this.#name = input.name
    this.#x = input.position.x
    this.#y = input.position.y
    this.parameters = {
      sceneId: input.sceneId,
      parentId: input.parentId,
      definitionId: input.definitionId,
      name: input.name,
      position: { x: input.position.x, y: input.position.y },
    }
  }

  validate(engine: Engine): void {
    requireNonEmpty(this.#name, 'Node name')
    requireFiniteNumber(this.#x, 'Position x')
    requireFiniteNumber(this.#y, 'Position y')
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
        transform: { ...identityTransform(), x: this.#x, y: this.#y },
      },
    )
    return { nodeId: node.id }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
