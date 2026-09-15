import type { Engine } from '../internal'
import type { Command } from './command'
import { CONTROL_INTERVAL_MIN_SPAN, mergeGroupBindings, validateControlBinding } from '../control'
import type { ControlBinding, ControlBindingValue } from '../control'

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
      const updated = updateFlatBinding(
        control.bindings,
        this.#semanticName,
        this.#start,
        this.#end,
      )
      if (control.groups.length <= 1) return { ...control, bindings: updated }
      // Multi-timeline: groups are the source of truth (flat edits are discarded
      // by normalization), so mirror the interval change into every timeline
      // containing the semantic and recompute the merged view.
      const nextGroups = control.groups.map((g) => {
        const raw = (g.bindings as Record<string, ControlBindingValue | undefined>)[
          this.#semanticName
        ]
        if (raw === undefined) return g
        return {
          ...g,
          bindings: {
            ...g.bindings,
            [this.#semanticName]: updateOneBinding(raw, this.#start, this.#end),
          },
        }
      })
      return { ...control, groups: nextGroups, bindings: mergeGroupBindings(nextGroups) }
    })
    const nextSet: import('../control').ControlSet = { ...oldControlSet, controls }
    engine.setControlSet(this.#nodeId, nextSet)
    return { nodeId: this.#nodeId, oldControlSet }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}

function updateOneBinding(
  raw: ControlBindingValue,
  start: number,
  end: number,
): ControlBindingValue {
  if (Array.isArray(raw)) {
    const arr = raw as ControlBinding[]
    if (arr.length === 0) return raw
    const last = arr[arr.length - 1]!
    const clipId = typeof last === 'string' ? last : last.clipId
    const newArr = [...arr.slice(0, -1), { clipId, start, end }]
    return (newArr.length === 1 ? newArr[0]! : newArr) as ControlBindingValue
  }
  const existing = raw as ControlBinding
  const clipId = typeof existing === 'string' ? existing : existing.clipId
  return { clipId, start, end }
}

function updateFlatBinding(
  bindings: Readonly<Record<string, ControlBindingValue>>,
  semanticName: string,
  start: number,
  end: number,
): Record<string, ControlBindingValue> {
  const raw = (bindings as Record<string, ControlBindingValue>)[semanticName]
  if (raw === undefined) return { ...bindings }
  return { ...bindings, [semanticName]: updateOneBinding(raw, start, end) }
}
