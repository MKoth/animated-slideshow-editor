import type { Engine } from '../internal'
import type { Command } from './command'
import { compiledFootprintFromJSON, compiledFootprintToJSON } from '../compiledFootprint'
import type { CompiledFootprintJSON } from '../json'

export interface SetSlideAnimationScriptFootprintParameters {
  readonly slideId: string
  readonly footprint: CompiledFootprintJSON
}

export interface SetSlideAnimationScriptFootprintInverse {
  readonly slideId: string
  /** Null when the run is the slide's first, so undo clears the recorded footprint. */
  readonly previousFootprint: CompiledFootprintJSON | null
}

/**
 * Records what a Run compiled on the slide's Animation Script. Lives inside the
 * run Transaction so one undo reverts the emitted timeline data and the
 * recorded footprint together; the authored source is never touched.
 */
export class SetSlideAnimationScriptFootprintCommand implements Command<SetSlideAnimationScriptFootprintInverse> {
  readonly type = 'SetSlideAnimationScriptFootprint'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #footprint: CompiledFootprintJSON

  constructor(input: SetSlideAnimationScriptFootprintParameters) {
    this.#slideId = input.slideId
    this.#footprint = input.footprint
    this.parameters = { slideId: input.slideId, footprint: input.footprint }
  }

  validate(engine: Engine): void {
    engine.getSlide(this.#slideId)
    compiledFootprintFromJSON(this.#footprint)
  }

  execute(engine: Engine): SetSlideAnimationScriptFootprintInverse {
    const previousFootprint = engine.setSlideAnimationScriptFootprint(
      this.#slideId,
      compiledFootprintFromJSON(this.#footprint),
    )
    return {
      slideId: this.#slideId,
      previousFootprint:
        previousFootprint === null ? null : compiledFootprintToJSON(previousFootprint),
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
