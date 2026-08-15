import type { Engine } from '../internal'
import type { Command } from './command'
import { requireMaterialParameterKey } from '../guards'
import { requireMaterialOverridePresent } from '../materialInstance'
import type { MaterialOverrideValue } from '../materialInstance'

export interface ClearMaterialOverrideParameters {
  readonly nodeId: string
  readonly parameter: string
}

export interface ClearMaterialOverrideInverse {
  readonly nodeId: string
  readonly parameter: string
  readonly removedValue: MaterialOverrideValue
}

export class ClearMaterialOverrideCommand implements Command<ClearMaterialOverrideInverse> {
  readonly type = 'ClearMaterialOverride'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #parameter: string

  constructor(input: ClearMaterialOverrideParameters) {
    this.#nodeId = input.nodeId
    this.#parameter = input.parameter
    this.parameters = { nodeId: input.nodeId, parameter: input.parameter }
  }

  validate(engine: Engine): void {
    requireMaterialParameterKey(this.#parameter, 'Material parameter key')
    const node = engine.getNode(this.#nodeId)
    requireMaterialOverridePresent(node.material, this.#parameter, this.#nodeId)
  }

  execute(engine: Engine): ClearMaterialOverrideInverse {
    const node = engine.getNode(this.#nodeId)
    const removedValue = node.material.overrides[this.#parameter]
    engine.clearMaterialOverride(this.#nodeId, this.#parameter)
    return {
      nodeId: this.#nodeId,
      parameter: this.#parameter,
      removedValue,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
