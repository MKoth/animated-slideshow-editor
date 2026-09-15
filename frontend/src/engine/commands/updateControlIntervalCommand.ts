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
    const raw = (control.bindings as Record<string, unknown>)[this.#semanticName]
    if (!raw)
      throw new Error(`Binding "${this.#semanticName}" not found on control "${this.#controlKey}"`)
    const binding = Array.isArray(raw) ? (raw as unknown[])[(raw as unknown[]).length - 1] : raw
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
    const existingClipId =
      typeof binding === 'string' ? (binding as string) : (binding as { clipId: string }).clipId
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
      const raw = (control.bindings as Record<string, unknown>)[this.#semanticName]
      if (!raw) return control
      if (Array.isArray(raw)) {
        const arr = raw as (string | { clipId: string; start: number; end: number })[]
        if (arr.length === 0) return control
        const last = arr[arr.length - 1]!
        const clipId = typeof last === 'string' ? last : last.clipId
        const newLast = { clipId, start: this.#start, end: this.#end }
        const newArr = [...arr.slice(0, -1), newLast]
        const nextBindings: Record<string, import('../control').ControlBindingValue> = {
          ...control.bindings,
        }
        nextBindings[this.#semanticName] =
          newArr.length === 1
            ? newArr[0]!
            : (newArr as unknown as import('../control').ControlBinding[])
        return { ...control, bindings: nextBindings }
      }
      const existing = raw as string | { clipId: string; start: number; end: number }
      const clipId = typeof existing === 'string' ? existing : existing.clipId
      const nextBindings: Record<string, import('../control').ControlBindingValue> = {
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
