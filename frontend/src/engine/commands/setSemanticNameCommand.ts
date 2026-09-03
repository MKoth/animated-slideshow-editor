import type { Engine } from '../internal'
import type { Command } from './command'

export interface SetSemanticNameParameters {
  readonly nodeId: string
  readonly semanticName?: string
}

export interface SetSemanticNameInverse {
  readonly nodeId: string
  readonly oldSemanticName?: string
}

export class SetSemanticNameCommand implements Command<SetSemanticNameInverse> {
  readonly type = 'SetSemanticName'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #semanticName: string | undefined

  constructor(input: SetSemanticNameParameters) {
    this.#nodeId = input.nodeId
    this.#semanticName =
      input.semanticName !== undefined && input.semanticName.trim() !== ''
        ? input.semanticName.trim()
        : undefined
    this.parameters = {
      nodeId: input.nodeId,
      ...(this.#semanticName !== undefined ? { semanticName: this.#semanticName } : {}),
    }
  }

  validate(engine: Engine): void {
    engine.getNode(this.#nodeId)
    if (this.#semanticName !== undefined && this.#semanticName.trim() === '') {
      throw new Error('Semantic name must not be empty')
    }
  }

  execute(engine: Engine): SetSemanticNameInverse {
    const node = engine.getNode(this.#nodeId)
    const oldSemanticName = node.semanticName
    engine.setSemanticName(this.#nodeId, this.#semanticName)
    return { nodeId: this.#nodeId, oldSemanticName }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
