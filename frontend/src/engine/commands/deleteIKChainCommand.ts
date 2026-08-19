import type { Engine } from '../internal'
import type { Command } from './command'
import type { IKChainJSON } from '../ikChain'

export interface DeleteIKChainParameters {
  readonly chainId: string
}

export interface DeleteIKChainInverse {
  readonly chain: IKChainJSON
  readonly slideId: string
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
    // Find slide ID that contains this chain (search through slides)
    const slideId = this.#findSlideId(engine, this.#chainId)
    engine.deleteIKChain(this.#chainId)
    return { chain: chainJson, slideId }
  }

  #findSlideId(engine: Engine, chainId: string): string {
    // Since we don't have direct access to IKManager, we can search slides
    // This is a bit inefficient but okay for undo operations
    const project = engine.project
    if (!project) {
      throw new Error('No project loaded')
    }
    for (const slide of project.slides) {
      const chains = engine.getIKChainsForSlide(slide.id)
      if (chains.some((c) => c.id === chainId)) {
        return slide.id
      }
    }
    throw new Error(`Slide not found for chain ${chainId}`)
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
