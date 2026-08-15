import type { Engine } from '../internal'
import type { Command } from './command'
import { requireMaterialOverrideValue, requireMaterialParameterKey } from '../guards'
import type { MaterialOverrideValue } from '../materialInstance'

export interface OverrideMaterialParameterParameters {
  readonly nodeId: string
  readonly parameter: string
  readonly value: MaterialOverrideValue
}

export interface OverrideMaterialParameterInverse {
  readonly nodeId: string
  readonly parameter: string
  readonly previousValue: MaterialOverrideValue | null
}

export class OverrideMaterialParameterCommand implements Command<OverrideMaterialParameterInverse> {
  readonly type = 'OverrideMaterialParameter'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #parameter: string
  readonly #value: MaterialOverrideValue

  constructor(input: OverrideMaterialParameterParameters) {
    this.#nodeId = input.nodeId
    this.#parameter = input.parameter
    this.#value = input.value
    this.parameters = {
      nodeId: input.nodeId,
      parameter: input.parameter,
      value: this.#value,
    }
  }

  validate(engine: Engine): void {
    requireMaterialParameterKey(this.#parameter, 'Material parameter key')
    requireMaterialOverrideValue(this.#value, `Material parameter "${this.#parameter}" value`)
    engine.getNode(this.#nodeId)
  }

  execute(engine: Engine): OverrideMaterialParameterInverse {
    const node = engine.getNode(this.#nodeId)
    const overrides = node.material.overrides
    const hadPrevious = Object.prototype.hasOwnProperty.call(overrides, this.#parameter)
    engine.overrideMaterialParameter(this.#nodeId, this.#parameter, this.#value)
    return {
      nodeId: this.#nodeId,
      parameter: this.#parameter,
      previousValue: hadPrevious ? overrides[this.#parameter] : null,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
