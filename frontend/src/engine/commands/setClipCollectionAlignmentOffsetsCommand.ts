import type { ClipCollectionAlignmentOffsets } from '../clipCollection'
import type { Engine } from '../internal'
import type { Command } from './command'

export interface SetClipCollectionAlignmentOffsetsParameters {
  readonly collectionId: string
  readonly alignmentOffsets: ClipCollectionAlignmentOffsets
}

export class SetClipCollectionAlignmentOffsetsCommand implements Command<{
  readonly collectionId: string
  readonly oldOffsets: Record<string, { x: number; y: number }>
}> {
  readonly type = 'SetClipCollectionAlignmentOffsets'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #collectionId: string
  readonly #alignmentOffsets: ClipCollectionAlignmentOffsets

  constructor(input: SetClipCollectionAlignmentOffsetsParameters) {
    if (!input.collectionId.trim()) throw new Error('collectionId must be non-empty')
    this.#collectionId = input.collectionId
    this.#alignmentOffsets = input.alignmentOffsets
    this.parameters = {
      collectionId: input.collectionId,
      alignmentOffsets: structuredClone(input.alignmentOffsets),
    }
  }

  validate(engine: Engine): void {
    engine.getClipCollection(this.#collectionId)
  }

  execute(engine: Engine) {
    const oldOffsets = engine.setClipCollectionAlignmentOffsets(
      this.#collectionId,
      this.#alignmentOffsets,
    )
    return { collectionId: this.#collectionId, oldOffsets }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
