import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber, requireString } from '../guards'

export interface OverrideClipParamParameters {
  readonly nodeId: string
  readonly instanceId: string
  readonly paramKey: string
  readonly value: number
}

export interface OverrideClipParamInverse {
  readonly nodeId: string
  readonly instanceId: string
  readonly paramKey: string
  readonly oldValue: number | undefined
  readonly hadOldValue: boolean
}

export class OverrideClipParamCommand implements Command<OverrideClipParamInverse> {
  readonly type = 'OverrideClipParam'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #instanceId: string
  readonly #paramKey: string
  readonly #value: number

  constructor(input: OverrideClipParamParameters) {
    this.#nodeId = input.nodeId
    this.#instanceId = input.instanceId
    this.#paramKey = input.paramKey
    this.#value = input.value
    this.parameters = {
      nodeId: input.nodeId,
      instanceId: input.instanceId,
      paramKey: input.paramKey,
      value: input.value,
    }
  }

  validate(engine: Engine): void {
    engine.getNode(this.#nodeId)
    const instance = engine.getClipInstance(this.#nodeId, this.#instanceId)
    const clip = engine.getClip(instance.clipId)
    requireString(this.#paramKey, 'Param key')
    requireFiniteNumber(this.#value, 'Param value')
    if (!clip.getParam(this.#paramKey)) {
      throw new Error(`Clip param not found: ${this.#paramKey}`)
    }
  }

  execute(engine: Engine): OverrideClipParamInverse {
    const instance = engine.getClipInstance(this.#nodeId, this.#instanceId)
    const oldValue = instance.paramOverrides[this.#paramKey]
    const hadOldValue = this.#paramKey in instance.paramOverrides
    engine.setClipInstanceParamOverride(this.#nodeId, this.#instanceId, this.#paramKey, this.#value)
    return {
      nodeId: this.#nodeId,
      instanceId: this.#instanceId,
      paramKey: this.#paramKey,
      oldValue,
      hadOldValue,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
