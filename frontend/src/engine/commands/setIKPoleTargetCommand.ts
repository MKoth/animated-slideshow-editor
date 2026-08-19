import type { Engine } from '../internal'
import type { Command } from './command'
import type { PoleTarget } from '../ikChain'

export interface SetIKPoleTargetParameters {
  readonly chainId: string
  readonly poleTarget: PoleTarget | null
}

export interface SetIKPoleTargetInverse {
  readonly chainId: string
  readonly oldPoleTarget: PoleTarget | null
}

export class SetIKPoleTargetCommand implements Command<SetIKPoleTargetInverse> {
  readonly type = 'SetIKPoleTarget'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #chainId: string
  readonly #poleTarget: PoleTarget | null

  constructor(input: SetIKPoleTargetParameters) {
    this.#chainId = input.chainId
    this.#poleTarget = input.poleTarget ? { ...input.poleTarget } : null
    this.parameters = {
      chainId: input.chainId,
      ...(this.#poleTarget !== null && { poleTarget: this.#poleTarget }),
    }
  }

  validate(engine: Engine): void {
    engine.getIKChain(this.#chainId)
  }

  execute(engine: Engine): SetIKPoleTargetInverse {
    const chain = engine.getIKChain(this.#chainId)
    const oldPoleTarget = chain.poleTarget ? { ...chain.poleTarget } : null
    engine.setIKPoleTarget(this.#chainId, this.#poleTarget)
    return { chainId: this.#chainId, oldPoleTarget }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}