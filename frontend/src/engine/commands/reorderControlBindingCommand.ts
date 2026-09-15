import type { Engine } from '../internal'
import type { Command } from './command'

export interface ReorderControlBindingParameters {
  readonly nodeId: string
  readonly controlKey: string
  readonly semanticName: string
  readonly newIndex: number
}

export interface ReorderControlBindingInverse {
  readonly nodeId: string
  readonly oldControlSet: import('../control').ControlSet | undefined
}

export class ReorderControlBindingCommand implements Command<ReorderControlBindingInverse> {
  readonly type = 'ReorderControlBinding'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #controlKey: string
  readonly #semanticName: string
  readonly #newIndex: number

  constructor(input: ReorderControlBindingParameters) {
    this.#nodeId = input.nodeId
    this.#controlKey = input.controlKey
    this.#semanticName = input.semanticName
    this.#newIndex = input.newIndex
    this.parameters = { ...input }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    const controlSet = node.controlSet
    if (!controlSet) throw new Error(`Node "${this.#nodeId}" has no controlSet`)
    const control = controlSet.controls.find((c) => c.key === this.#controlKey)
    if (!control) throw new Error(`Control "${this.#controlKey}" not found`)
    const keys = Object.keys(control.bindings)
    if (!keys.includes(this.#semanticName))
      throw new Error(`Binding "${this.#semanticName}" not found`)
    if (!Number.isInteger(this.#newIndex) || this.#newIndex < 0 || this.#newIndex >= keys.length) {
      throw new Error(`newIndex ${this.#newIndex} out of range`)
    }
  }

  execute(engine: Engine): ReorderControlBindingInverse {
    const node = engine.getNode(this.#nodeId)
    const oldControlSet = node.controlSet
    if (!oldControlSet) throw new Error('No controlSet')
    const controls = oldControlSet.controls.map((control) => {
      if (control.key !== this.#controlKey) return control
      const entries = Object.entries(control.bindings) as [
        string,
        import('../control').ControlBindingValue,
      ][]
      const fromIdx = entries.findIndex(([k]) => k === this.#semanticName)
      if (fromIdx === -1) return control
      const [moved] = entries.splice(fromIdx, 1)
      entries.splice(this.#newIndex, 0, moved!)
      const nextBindings: Record<string, import('../control').ControlBindingValue> = {}
      for (const [k, v] of entries) nextBindings[k] = v
      return { ...control, bindings: nextBindings }
    })
    const nextSet: import('../control').ControlSet = { ...oldControlSet, controls }
    engine.setControlSet(this.#nodeId, nextSet)
    return { nodeId: this.#nodeId, oldControlSet }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
