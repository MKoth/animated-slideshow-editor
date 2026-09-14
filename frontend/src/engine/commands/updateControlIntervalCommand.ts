import type { Engine } from '../internal'
import type { Command } from './command'
import { CONTROL_INTERVAL_MIN_SPAN, validateControlBinding } from '../control'

export interface UpdateControlIntervalParameters {
  readonly nodeId: string
  readonly controlKey: string
  readonly semanticName: string
  readonly start: number
  readonly end: number
}

export interface UpdateControlIntervalInverse {
  readonly nodeId: string
  readonly oldControlSet: import('../control').ControlSet | undefined
}

export class UpdateControlIntervalCommand implements Command<UpdateControlIntervalInverse> {
  readonly type = 'UpdateControlInterval'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #controlKey: string
  readonly #semanticName: string
  readonly #start: number
  readonly #end: number

  constructor(input: UpdateControlIntervalParameters) {
    this.#nodeId = input.nodeId
    this.#controlKey = input.controlKey
    this.#semanticName = input.semanticName
    this.#start = input.start
    this.#end = input.end
    this.parameters = { ...input }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    const controlSet = node.controlSet
    if (!controlSet) throw new Error(`Node "${this.#nodeId}" has no controlSet`)
    const control = controlSet.controls.find((c) => c.key === this.#controlKey)
    if (!control)
      throw new Error(`Control "${this.#controlKey}" not found on node "${this.#nodeId}"`)
    const binding = control.bindings[this.#semanticName]
    if (!binding)
      throw new Error(`Binding "${this.#semanticName}" not found on control "${this.#controlKey}"`)
    // Validate interval semantics
    if (!Number.isFinite(this.#start) || !Number.isFinite(this.#end)) {
      throw new Error('Control Interval start/end must be finite numbers')
    }
    if (this.#start < 0 || this.#end > 1 || this.#start >= this.#end) {
      throw new Error(`Control Interval [${this.#start},${this.#end}] must satisfy 0≤start<end≤1`)
    }
    if (this.#end - this.#start < CONTROL_INTERVAL_MIN_SPAN) {
      throw new Error(`Control Interval span must be >= ${CONTROL_INTERVAL_MIN_SPAN}`)
    }
    // Use existing validator for clipId
    const existingClipId = typeof binding === 'string' ? binding : binding.clipId
    validateControlBinding(
      { clipId: existingClipId, start: this.#start, end: this.#end },
      this.#semanticName,
      this.#controlKey,
    )
  }

  execute(engine: Engine): UpdateControlIntervalInverse {
    const node = engine.getNode(this.#nodeId)
    const oldControlSet = node.controlSet
    if (!oldControlSet) throw new Error('No controlSet')
    const controls = oldControlSet.controls.map((control) => {
      if (control.key !== this.#controlKey) return control
      const existing = control.bindings[this.#semanticName]
      if (!existing) return control
      const clipId = typeof existing === 'string' ? existing : existing.clipId
      const nextBindings: Record<string, import('../control').ControlBinding> = {
        ...control.bindings,
      }
      nextBindings[this.#semanticName] = { clipId, start: this.#start, end: this.#end }
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
