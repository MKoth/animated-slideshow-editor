import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'

export interface UpdatePrompterPartWithShiftParameters {
  readonly slideId: string
  readonly partId: string
  readonly duration: number
  readonly shiftDownstream: boolean
}

export interface UpdatePrompterPartWithShiftInverse {
  readonly slideId: string
  readonly partId: string
  readonly oldDuration: number
  readonly oldStartTime: number
  readonly oldEndTime: number
  readonly shiftedParts: readonly { id: string; oldStartTime: number; oldEndTime: number }[]
  readonly shiftedClips: readonly { id: string; oldTimelineStart: number }[]
}

export class UpdatePrompterPartWithShiftCommand implements Command<UpdatePrompterPartWithShiftInverse> {
  readonly type = 'UpdatePrompterPartWithShift'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #slideId: string
  readonly #partId: string
  readonly #duration: number
  readonly #shiftDownstream: boolean

  constructor(input: UpdatePrompterPartWithShiftParameters) {
    this.#slideId = input.slideId
    this.#partId = input.partId
    this.#duration = input.duration
    this.#shiftDownstream = input.shiftDownstream
    this.parameters = {
      slideId: input.slideId,
      partId: input.partId,
      duration: input.duration,
      shiftDownstream: input.shiftDownstream,
    }
  }

  validate(engine: Engine): void {
    const slide = engine.getSlide(this.#slideId)
    const part = slide.prompter?.parts.find((p) => p.id === this.#partId)
    if (!part) throw new Error(`PrompterPart not found: ${this.#partId}`)
    requireFiniteNumber(this.#duration, 'PrompterPart duration', (v) => v >= 0)
  }

  execute(engine: Engine): UpdatePrompterPartWithShiftInverse {
    const result = engine.updatePrompterPart(this.#slideId, this.#partId, {
      duration: this.#duration,
      shiftDownstream: this.#shiftDownstream,
    })
    return {
      slideId: result.slideId,
      partId: result.partId,
      oldDuration: result.oldDuration,
      oldStartTime: result.oldStartTime,
      oldEndTime: result.oldEndTime,
      shiftedParts: result.shiftedParts,
      shiftedClips: result.shiftedClips,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
