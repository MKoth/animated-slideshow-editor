import type { Engine } from '../internal'
import type { Command } from './command'
import type { ClipJSON } from '../json'

export interface DeleteClipParameters {
  readonly clipId: string
}

export interface DeleteClipInverse {
  readonly clipId: string
  readonly clipData: ClipJSON
}

export class DeleteClipCommand implements Command<DeleteClipInverse> {
  readonly type = 'DeleteClip'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #clipId: string

  constructor(input: DeleteClipParameters) {
    this.#clipId = input.clipId
    this.parameters = { clipId: input.clipId }
  }

  validate(engine: Engine): void {
    engine.getClip(this.#clipId)
    if (engine.isClipReferenced(this.#clipId)) {
      const names = engine.getClipBlockingNodeNames(this.#clipId)
      throw new Error(`Cannot delete clip: it is referenced by nodes: ${names.join(', ')}`)
    }
  }

  execute(engine: Engine): DeleteClipInverse {
    const clip = engine.getClip(this.#clipId)
    const clipData = clip.toJSON()
    engine.deleteClip(this.#clipId)
    return { clipId: this.#clipId, clipData }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
