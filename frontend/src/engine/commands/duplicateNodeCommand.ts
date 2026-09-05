import type { Engine } from '../internal'
import type { Command } from './command'
import { namesInTree, uniqueNodeName } from '../naming'
import { copyMaterialInstance } from '../materialInstance'

export const DUPLICATE_OFFSET = { x: 20, y: 20 } as const

export interface DuplicateNodeParameters {
  readonly nodeId: string
}

export interface DuplicateNodeInverse {
  readonly nodeId: string
}

export class DuplicateNodeCommand implements Command<DuplicateNodeInverse> {
  readonly type = 'DuplicateNode'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string

  constructor(input: DuplicateNodeParameters) {
    this.#nodeId = input.nodeId
    this.parameters = { nodeId: input.nodeId }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.assetInstance) {
      throw new Error('Only asset instances can be duplicated')
    }
  }

  execute(engine: Engine): DuplicateNodeInverse {
    const node = engine.getNode(this.#nodeId)
    const scene = engine.getNodeScene(this.#nodeId)
    if (!node.components.assetInstance || !node.parent) {
      throw new Error('Only asset instances can be duplicated')
    }
    const name = uniqueNodeName(namesInTree(scene.root), node.name)
    const copy = engine.createAssetInstance(
      scene.id,
      node.parent.id,
      node.components.assetInstance.assetDefinitionId,
      name,
      {
        transform: {
          ...node.transform,
          x: node.transform.x + DUPLICATE_OFFSET.x,
          y: node.transform.y + DUPLICATE_OFFSET.y,
        },
        ...(node.semanticName !== undefined ? { semanticName: node.semanticName } : {}),
      },
    )
    copy.material = copyMaterialInstance(node.material)
    if (node.castShadow !== undefined) {
      ;(copy as unknown as { castShadow?: boolean }).castShadow = node.castShadow
    }
    // clipInstances are not copied here (asset instance only); if node had semanticName it's already handled
    if (node.semanticName !== undefined) {
      copy.semanticName = node.semanticName
    }
    return { nodeId: copy.id }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
