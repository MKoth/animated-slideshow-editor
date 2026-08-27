import type { Engine } from '../internal'
import type { Command } from './command'
import type { TextAlignment } from '../components'

export interface SetTextAlignmentParameters {
  readonly nodeId: string
  readonly alignment: TextAlignment
}

export interface SetTextAlignmentInverse {
  readonly nodeId: string
  readonly oldAlignment: TextAlignment
}

const VALID_ALIGNMENTS: readonly TextAlignment[] = ['left', 'center', 'right']

export class SetTextAlignmentCommand implements Command<SetTextAlignmentInverse> {
  readonly type = 'SetTextAlignment'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #alignment: TextAlignment

  constructor(input: SetTextAlignmentParameters) {
    this.#nodeId = input.nodeId
    this.#alignment = input.alignment
    this.parameters = { nodeId: input.nodeId, alignment: input.alignment }
  }

  validate(engine: Engine): void {
    if (!VALID_ALIGNMENTS.includes(this.#alignment)) {
      throw new Error(`Alignment must be one of: left, center, right`)
    }
    const node = engine.getNode(this.#nodeId)
    if (!node.components.text) {
      throw new Error(`Node "${this.#nodeId}" does not have a text component`)
    }
  }

  execute(engine: Engine): SetTextAlignmentInverse {
    const node = engine.getNode(this.#nodeId)
    const oldText = node.components.text!
    const newText = { ...oldText, alignment: this.#alignment }
    engine.setTextComponent(this.#nodeId, newText)
    return { nodeId: this.#nodeId, oldAlignment: oldText.alignment }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
