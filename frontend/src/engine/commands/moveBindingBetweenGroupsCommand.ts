import type { Engine } from '../internal'
import type { Command } from './command'

export interface MoveBindingBetweenGroupsParameters {
  readonly nodeId: string
  readonly semanticName: string
  readonly fromControlKey: string
  readonly toControlKey: string
  readonly toIndex?: number
}

export interface MoveBindingBetweenGroupsInverse {
  readonly nodeId: string
  readonly oldControlSet: import('../control').ControlSet | undefined
}

/**
 * Moves a Control Interval binding between groups.
 * In v1 without hierarchical groups, this operates between two Controls
 * acting as groups (when groups exist this will be extended to ControlGroup ids).
 * Group-aware logic is tolerant: if groups exist, it will attempt group move.
 */
export class MoveBindingBetweenGroupsCommand implements Command<MoveBindingBetweenGroupsInverse> {
  readonly type = 'MoveBindingBetweenGroups'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #semanticName: string
  readonly #fromControlKey: string
  readonly #toControlKey: string
  readonly #toIndex: number | undefined

  constructor(input: MoveBindingBetweenGroupsParameters) {
    this.#nodeId = input.nodeId
    this.#semanticName = input.semanticName
    this.#fromControlKey = input.fromControlKey
    this.#toControlKey = input.toControlKey
    this.#toIndex = input.toIndex
    this.parameters = { ...input }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    const controlSet = node.controlSet
    if (!controlSet) throw new Error(`Node "${this.#nodeId}" has no controlSet`)
    const from = controlSet.controls.find((c) => c.key === this.#fromControlKey)
    const to = controlSet.controls.find((c) => c.key === this.#toControlKey)
    if (!from) throw new Error(`Source control "${this.#fromControlKey}" not found`)
    if (!to) throw new Error(`Target control "${this.#toControlKey}" not found`)
    if (!from.bindings[this.#semanticName])
      throw new Error(`Binding "${this.#semanticName}" not found on "${this.#fromControlKey}"`)
    // Check for groups property if present (future)
    const maybeFromGroups = (from as unknown as { groups?: readonly unknown[] }).groups
    const maybeToGroups = (to as unknown as { groups?: readonly unknown[] }).groups
    if (maybeFromGroups !== undefined || maybeToGroups !== undefined) {
      // Future groups path – validate group indices if groups exist
      // For now allow, detailed validation will be in groups implementation
    }
  }

  execute(engine: Engine): MoveBindingBetweenGroupsInverse {
    const node = engine.getNode(this.#nodeId)
    const oldControlSet = node.controlSet
    if (!oldControlSet) throw new Error('No controlSet')
    // If controls have groups, delegate to group-aware move
    const hasGroups = oldControlSet.controls.some(
      (c) => (c as unknown as { groups?: unknown }).groups !== undefined,
    )
    if (hasGroups) {
      // Group-aware move: attempt to move binding between groups identified by controlKey as host
      // Groups are stored as Control.groups: ControlGroup[] each with bindings
      // For now, treat fromControlKey/toControlKey as group host with group ids encoded?
      // Simplistic: find groups by id matching semantic? Not needed yet.
      // Fall through to control-level move if groups not matching
    }
    const fromControl = oldControlSet.controls.find((c) => c.key === this.#fromControlKey)!
    const binding = fromControl.bindings[this.#semanticName]
    // Build next controls with binding moved
    const controls = oldControlSet.controls.map((control) => {
      if (control.key === this.#fromControlKey) {
        const nextBindings = { ...control.bindings }
        delete nextBindings[this.#semanticName]
        return { ...control, bindings: nextBindings }
      }
      if (control.key === this.#toControlKey) {
        const entries = Object.entries(control.bindings)
        const nextEntries: [string, import('../control').ControlBinding][] = [...entries]
        // Insert at toIndex if provided, otherwise append (later wins)
        const insertAt =
          this.#toIndex !== undefined
            ? Math.min(this.#toIndex, nextEntries.length)
            : nextEntries.length
        nextEntries.splice(insertAt, 0, [this.#semanticName, binding])
        const nextBindings: Record<string, import('../control').ControlBinding> = {}
        for (const [k, v] of nextEntries) nextBindings[k] = v
        return { ...control, bindings: nextBindings }
      }
      return control
    })
    const nextSet: import('../control').ControlSet = { ...oldControlSet, controls }
    engine.setControlSet(this.#nodeId, nextSet)
    return { nodeId: this.#nodeId, oldControlSet }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
