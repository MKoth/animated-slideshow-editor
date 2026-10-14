import type { Engine } from '../internal'
import type { Command } from './command'
import type { KeyframeTarget } from '../keyframeTarget'
import type { FreezeLink } from '../keyframe'
import { freezeLinkFromJSON } from '../keyframe'

export interface SetKeyframeFreezeLinkParameters {
  readonly target: KeyframeTarget
  readonly keyframeId: string
  /** Undefined/null clears the link (orphans the keyframe). */
  readonly freezeLink?: FreezeLink | null
}

export interface SetKeyframeFreezeLinkInverse {
  readonly target: KeyframeTarget
  readonly keyframeId: string
  readonly oldFreezeLink: FreezeLink | undefined
}

export class SetKeyframeFreezeLinkCommand implements Command<SetKeyframeFreezeLinkInverse> {
  readonly type = 'SetKeyframeFreezeLink'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #target: KeyframeTarget
  readonly #keyframeId: string
  readonly #freezeLink: FreezeLink | undefined

  constructor(input: SetKeyframeFreezeLinkParameters) {
    this.#target = input.target
    this.#keyframeId = input.keyframeId
    const parsed =
      input.freezeLink === undefined || input.freezeLink === null
        ? undefined
        : freezeLinkFromJSON(input.freezeLink)
    if (input.freezeLink !== undefined && input.freezeLink !== null && !parsed) {
      throw new Error('Invalid freeze link: expected { placementId, role first|last|prefix }')
    }
    this.#freezeLink = parsed
    this.parameters = {
      target: input.target,
      keyframeId: this.#keyframeId,
      ...(parsed ? { freezeLink: { ...parsed } } : {}),
    }
  }

  validate(engine: Engine): void {
    this.#requireKeyframe(engine)
  }

  execute(engine: Engine): SetKeyframeFreezeLinkInverse {
    this.#requireKeyframe(engine)
    const oldFreezeLink = engine.setKeyframeFreezeLink(
      this.#target,
      this.#keyframeId,
      this.#freezeLink,
    )
    return { target: this.#target, keyframeId: this.#keyframeId, oldFreezeLink }
  }

  #requireKeyframe(engine: Engine): void {
    const exists = engine
      .getKeyframesOf(this.#target)
      .some((keyframe) => keyframe.id === this.#keyframeId)
    if (!exists) {
      throw new Error(`Keyframe not found: ${this.#keyframeId}`)
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
