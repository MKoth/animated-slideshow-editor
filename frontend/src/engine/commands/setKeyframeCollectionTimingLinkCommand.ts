import type { Engine } from '../internal'
import type { Command } from './command'
import type { KeyframeTarget } from '../keyframeTarget'
import type { CollectionTimingLink } from '../keyframe'
import { collectionTimingLinkFromJSON } from '../keyframe'

export class SetKeyframeCollectionTimingLinkCommand implements Command<{
  target: KeyframeTarget
  keyframeId: string
  oldLink?: CollectionTimingLink
}> {
  readonly type = 'SetKeyframeCollectionTimingLink'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #target: KeyframeTarget
  readonly #keyframeId: string
  readonly #link: CollectionTimingLink | undefined

  constructor(input: {
    target: KeyframeTarget
    keyframeId: string
    link?: CollectionTimingLink | null
  }) {
    this.#target = input.target
    this.#keyframeId = input.keyframeId
    this.#link = input.link == null ? undefined : collectionTimingLinkFromJSON(input.link)
    if (input.link != null && !this.#link) throw new Error('Invalid collection timing link')
    this.parameters = {
      target: input.target,
      keyframeId: input.keyframeId,
      ...(this.#link ? { link: this.#link } : {}),
    }
  }

  validate(engine: Engine): void {
    if (!engine.getKeyframesOf(this.#target).some((keyframe) => keyframe.id === this.#keyframeId)) {
      throw new Error(`Keyframe not found: ${this.#keyframeId}`)
    }
    if (this.#link) engine.getCollectionPlacement(this.#link.placementId)
  }

  execute(engine: Engine) {
    const oldLink = engine.setKeyframeCollectionTimingLink(
      this.#target,
      this.#keyframeId,
      this.#link,
    )
    return { target: this.#target, keyframeId: this.#keyframeId, oldLink }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
