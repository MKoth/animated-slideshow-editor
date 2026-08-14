import type { Engine } from '../internal'
import type { Command } from './command'
import { copyComponents, type NodeComponents } from '../components'
import type { Transform } from '../transform'
import { requireOpacity } from '../guards'

export interface CreateNodeParameters {
  readonly sceneId: string
  readonly parentId: string
  readonly name: string
  readonly id?: string
  readonly transform?: Transform
  readonly visible?: boolean
  readonly opacity?: number
  readonly components?: NodeComponents
}

export interface CreateNodeInverse {
  readonly nodeId: string
}

export class CreateNodeCommand implements Command<CreateNodeInverse> {
  readonly type = 'CreateNode'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #sceneId: string
  readonly #parentId: string
  readonly #name: string
  readonly #id: string | undefined
  readonly #transform: Transform | undefined
  readonly #visible: boolean | undefined
  readonly #opacity: number | undefined
  readonly #components: NodeComponents | undefined

  constructor(input: CreateNodeParameters) {
    this.#sceneId = input.sceneId
    this.#parentId = input.parentId
    this.#name = input.name
    this.#id = input.id
    this.#transform = input.transform ? { ...input.transform } : undefined
    this.#visible = input.visible
    this.#opacity = input.opacity
    this.#components = input.components ? copyComponents(input.components) : undefined
    this.parameters = {
      sceneId: input.sceneId,
      parentId: input.parentId,
      name: input.name,
      ...(input.id !== undefined && { id: input.id }),
      ...(this.#transform !== undefined && { transform: this.#transform }),
      ...(this.#visible !== undefined && { visible: this.#visible }),
      ...(this.#opacity !== undefined && { opacity: this.#opacity }),
      ...(this.#components !== undefined && { components: this.#components }),
    }
  }

  validate(engine: Engine): void {
    if (this.#name.trim() === '') {
      throw new Error('Node name must not be empty')
    }
    if (this.#opacity !== undefined) {
      requireOpacity(this.#opacity, 'Opacity')
    }
    if (this.#id !== undefined && nodeExists(engine, this.#id)) {
      throw new Error(`A node with id "${this.#id}" already exists`)
    }
    const scene = engine.getScene(this.#sceneId)
    if (!scene.getNode(this.#parentId)) {
      throw new Error(`Parent node not found: ${this.#parentId}`)
    }
    if (this.#components?.camera && scene.camera) {
      throw new Error('This scene already has a camera node')
    }
  }

  execute(engine: Engine): CreateNodeInverse {
    const node = engine.createNode(this.#sceneId, this.#parentId, this.#name, {
      ...(this.#id !== undefined && { id: this.#id }),
      ...(this.#transform !== undefined && { transform: this.#transform }),
      ...(this.#visible !== undefined && { visible: this.#visible }),
      ...(this.#opacity !== undefined && { opacity: this.#opacity }),
      ...(this.#components !== undefined && { components: this.#components }),
    })
    return { nodeId: node.id }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}

function nodeExists(engine: Engine, nodeId: string): boolean {
  try {
    engine.getNode(nodeId)
    return true
  } catch {
    return false
  }
}
