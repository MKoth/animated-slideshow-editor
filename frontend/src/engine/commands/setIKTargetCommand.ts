import type { Engine } from '../internal'
import type { Command } from './command'
import type { BoneIKTarget } from '../ikChain'

export interface SetIKTargetParameters {
  readonly chainId: string
  readonly target: BoneIKTarget
}

export interface SetIKTargetInverse {
  readonly chainId: string
  readonly oldTarget: BoneIKTarget
}

export class SetIKTargetCommand implements Command<SetIKTargetInverse> {
  readonly type = 'SetIKTarget'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #chainId: string
  readonly #target: BoneIKTarget

  constructor(input: SetIKTargetParameters) {
    this.#chainId = input.chainId
    this.#target = { ...input.target }
    this.parameters = {
      chainId: input.chainId,
      target: this.#target,
    }
  }

  validate(engine: Engine): void {
    engine.getIKChain(this.#chainId)
  }

  execute(engine: Engine): SetIKTargetInverse {
    const chain = engine.getIKChain(this.#chainId)
    const oldTarget = { ...chain.target }
    engine.setIKTarget(this.#chainId, this.#target)
    return { chainId: this.#chainId, oldTarget }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
