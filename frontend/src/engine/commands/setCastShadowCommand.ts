import type { Engine } from '../internal'
import type { Command } from './command'

export interface SetCastShadowParameters {
  readonly nodeId: string
  readonly castShadow: boolean
}

export interface SetCastShadowInverse {
  readonly nodeId: string
  readonly oldCastShadow?: boolean
  readonly hadCastShadow: boolean
}

export class SetCastShadowCommand implements Command<SetCastShadowInverse> {
  readonly type = 'SetCastShadow'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #castShadow: boolean

  constructor(input: SetCastShadowParameters) {
    if (typeof input.nodeId !== 'string' || input.nodeId === '') {
      throw new Error('SetCastShadow: nodeId must be a non-empty string')
    }
    if (typeof input.castShadow !== 'boolean') {
      throw new Error('SetCastShadow: castShadow must be a boolean')
    }
    this.#nodeId = input.nodeId
    this.#castShadow = input.castShadow
    this.parameters = {
      nodeId: input.nodeId,
      castShadow: input.castShadow,
    }
  }

  validate(engine: Engine): void {
    // Ensure node exists; allow any node type (Bone/Ghost will be ignored via getCastShadow but still storable)
    engine.getNode(this.#nodeId)
  }

  execute(engine: Engine): SetCastShadowInverse {
    const node = engine.getNode(this.#nodeId)
    const hadCastShadow = node.castShadow !== undefined
    const oldCastShadow = node.castShadow
    engine.setCastShadow(this.#nodeId, this.#castShadow)
    return { nodeId: this.#nodeId, oldCastShadow, hadCastShadow }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
