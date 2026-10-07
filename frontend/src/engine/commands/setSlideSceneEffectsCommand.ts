import type { Engine } from '../internal'
import type { SceneEffect } from '../sceneEffect'
import { sceneEffectFromJSON, sceneEffectToJSON } from '../sceneEffect'
import type { Command } from './command'

export interface SetSlideSceneEffectsParameters {
  readonly slideId: string
  readonly effects: readonly unknown[]
}

export interface SetSlideSceneEffectsInverse {
  readonly slideId: string
  readonly effects: readonly unknown[]
}

export class SetSlideSceneEffectsCommand implements Command<SetSlideSceneEffectsInverse> {
  readonly type = 'SetSlideSceneEffects'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #effects: readonly SceneEffect[]

  constructor(input: SetSlideSceneEffectsParameters) {
    this.#slideId = input.slideId
    this.#effects = input.effects.map(sceneEffectFromJSON)
    this.parameters = { slideId: input.slideId, effects: this.#effects.map(sceneEffectToJSON) }
  }

  validate(engine: Engine): void {
    engine.getSlide(this.#slideId)
  }

  execute(engine: Engine): SetSlideSceneEffectsInverse {
    const previous = engine.setSlideSceneEffects(this.#slideId, this.#effects)
    return { slideId: this.#slideId, effects: previous.map(sceneEffectToJSON) }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
