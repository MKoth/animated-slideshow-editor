import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'

export interface SetTextFontSizeParameters {
  readonly nodeId: string
  readonly fontSize: number
}

export interface SetTextFontSizeInverse {
  readonly nodeId: string
  readonly oldFontSize: number
}

export class SetTextFontSizeCommand implements Command<SetTextFontSizeInverse> {
  readonly type = 'SetTextFontSize'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #fontSize: number

  constructor(input: SetTextFontSizeParameters) {
    this.#nodeId = input.nodeId
    this.#fontSize = input.fontSize
    this.parameters = { nodeId: input.nodeId, fontSize: input.fontSize }
  }

  validate(engine: Engine): void {
    requireFiniteNumber(this.#fontSize, 'Font size', (v) => v > 0, 'positive number')
    const node = engine.getNode(this.#nodeId)
    if (!node.components.text) {
      throw new Error(`Node "${this.#nodeId}" does not have a text component`)
    }
  }

  execute(engine: Engine): SetTextFontSizeInverse {
    const node = engine.getNode(this.#nodeId)
    const oldText = node.components.text!
    const newText = { ...oldText, fontSize: this.#fontSize }
    engine.setTextComponent(this.#nodeId, newText)
    return { nodeId: this.#nodeId, oldFontSize: oldText.fontSize }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
