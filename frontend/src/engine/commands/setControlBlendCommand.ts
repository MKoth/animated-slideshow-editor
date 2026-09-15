import type { Engine } from '../internal'
import type { Command } from './command'

export interface SetControlBlendParameters {
  readonly hostNodeId: string
  readonly controlKey: string
  readonly keyframeId: string
  readonly blendIndex: number
  readonly value: number
}

export interface SetControlBlendInverse {
  readonly hostNodeId: string
  readonly controlKey: string
  readonly keyframeId: string
  readonly blendIndex: number
  readonly oldValue: number
}

export class SetControlBlendCommand implements Command<SetControlBlendInverse> {
  readonly type = 'SetControlBlend'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #hostNodeId: string
  readonly #controlKey: string
  readonly #keyframeId: string
  readonly #blendIndex: number
  readonly #value: number

  constructor(input: SetControlBlendParameters) {
    this.#hostNodeId = input.hostNodeId
    this.#controlKey = input.controlKey
    this.#keyframeId = input.keyframeId
    this.#blendIndex = input.blendIndex
    this.#value = input.value
    this.parameters = { ...input }
  }

  validate(engine: Engine): void {
    const host = engine.getNode(this.#hostNodeId)
    const control = host.controlSet?.controls.find((c) => c.key === this.#controlKey)
    if (!control) throw new Error(`Control "${this.#controlKey}" not found`)
    const expected = Math.max(0, control.groups.length - 1)
    if (this.#blendIndex < 0 || this.#blendIndex >= expected) {
      throw new Error(`Blend index ${this.#blendIndex} out of range (expected 0..${expected - 1})`)
    }
    if (!Number.isFinite(this.#value) || this.#value < 0 || this.#value > 1) {
      throw new Error('Blend value must be within [0, 1]')
    }
    const slide = engine.getActiveSlide()
    if (!slide) throw new Error('No active slide')
    const anim = slide.animation.node(this.#hostNodeId)
    const kf = anim?.controlKeyframes(this.#controlKey).find((k) => k.id === this.#keyframeId)
    if (!kf) throw new Error(`Control keyframe "${this.#keyframeId}" not found`)
  }

  execute(engine: Engine): SetControlBlendInverse {
    const oldValue = engine.setControlBlend(
      this.#hostNodeId,
      this.#controlKey,
      this.#keyframeId,
      this.#blendIndex,
      this.#value,
    )
    return {
      hostNodeId: this.#hostNodeId,
      controlKey: this.#controlKey,
      keyframeId: this.#keyframeId,
      blendIndex: this.#blendIndex,
      oldValue,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
