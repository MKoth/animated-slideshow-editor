import type { Engine } from '../internal'
import type { Command } from './command'
import type { BoneIKTarget, PoleTarget } from '../ikChain'

export interface CreateIKChainParameters {
  readonly slideId: string
  readonly boneIds: readonly string[]
  readonly target: BoneIKTarget
  readonly poleTarget?: PoleTarget | null
}

export interface CreateIKChainInverse {
  readonly chainId: string
}

export class CreateIKChainCommand implements Command<CreateIKChainInverse> {
  readonly type = 'CreateIKChain'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #boneIds: readonly string[]
  readonly #target: BoneIKTarget
  readonly #poleTarget: PoleTarget | null

  constructor(input: CreateIKChainParameters) {
    this.#slideId = input.slideId
    this.#boneIds = input.boneIds
    this.#target = { ...input.target }
    this.#poleTarget = input.poleTarget ? { ...input.poleTarget } : null
    this.parameters = {
      slideId: input.slideId,
      boneIds: input.boneIds,
      target: this.#target,
      ...(this.#poleTarget !== null && { poleTarget: this.#poleTarget }),
    }
  }

  validate(engine: Engine): void {
    // Slide must exist
    engine.getSlide(this.#slideId)
    // boneIds must have at least 2
    if (this.#boneIds.length < 2) {
      throw new Error('IK chain must have at least 2 bones')
    }
    // All bone nodes must exist and be bones (validation inside IKChain.validate)
    // Additional check: ensure no duplicate bone IDs
    const unique = new Set(this.#boneIds)
    if (unique.size !== this.#boneIds.length) {
      throw new Error('IK chain contains duplicate bone IDs')
    }
  }

  execute(engine: Engine): CreateIKChainInverse {
    const chain = engine.createIKChain(
      this.#slideId,
      this.#boneIds,
      this.#target,
      this.#poleTarget,
    )
    return { chainId: chain.id }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}