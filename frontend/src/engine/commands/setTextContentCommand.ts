import type { Engine } from '../internal'
import type { Command } from './command'
import { requireStringAllowEmpty } from '../guards'

export interface SetTextContentParameters {
  readonly nodeId: string
  readonly content: string
}

export interface SetTextContentInverse {
  readonly nodeId: string
  readonly oldContent: string
}

export class SetTextContentCommand implements Command<SetTextContentInverse> {
  readonly type = 'SetTextContent'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #content: string

  constructor(input: SetTextContentParameters) {
    this.#nodeId = input.nodeId
    this.#content = input.content
    this.parameters = { nodeId: input.nodeId, content: input.content }
  }

  validate(engine: Engine): void {
    requireStringAllowEmpty(this.#content, 'Text content')
    const node = engine.getNode(this.#nodeId)
    if (!node.components.text) {
      throw new Error(`Node "${this.#nodeId}" does not have a text component`)
    }
  }

  execute(engine: Engine): SetTextContentInverse {
    const node = engine.getNode(this.#nodeId)
    const oldText = node.components.text!
    const newText = { ...oldText, content: this.#content }
    engine.setTextComponent(this.#nodeId, newText)
    return { nodeId: this.#nodeId, oldContent: oldText.content }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
