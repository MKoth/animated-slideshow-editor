import type { Engine } from '../internal'
import type { Command } from './command'
import type { IKChainJSON } from '../ikChain'
import type { NodeJSON } from '../json'

export interface DeleteIKChainParameters {
  readonly chainId: string
}

export interface DeleteIKChainInverse {
  readonly chain: IKChainJSON
  readonly ghostNode: NodeJSON | null
}

export class DeleteIKChainCommand implements Command<DeleteIKChainInverse> {
  readonly type = 'DeleteIKChain'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #chainId: string

  constructor(input: DeleteIKChainParameters) {
    this.#chainId = input.chainId
    this.parameters = { chainId: input.chainId }
  }

  validate(engine: Engine): void {
    engine.getIKChain(this.#chainId)
  }

  execute(engine: Engine): DeleteIKChainInverse {
    const chain = engine.getIKChain(this.#chainId)
    const chainJson = chain.toJSON()
    // Serialize ghost node before chain deletion removes the reference
    let ghostNodeJson: NodeJSON | null = null
    if (chain.ghostNodeId) {
      try {
        ghostNodeJson = engine.getNode(chain.ghostNodeId).toJSON()
      } catch {
        // ghost node may already be gone; treat as null
      }
    }
    engine.deleteIKChain(this.#chainId)
    return { chain: chainJson, ghostNode: ghostNodeJson }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
