import type { Engine } from '../internal'
import type { Command } from './command'
import type { TableComponent } from '../components'

export interface SetTableComponentParameters {
  readonly nodeId: string
  readonly table: TableComponent
}

export interface SetTableComponentInverse {
  readonly nodeId: string
  readonly oldTable: TableComponent
}

export class SetTableComponentCommand implements Command<SetTableComponentInverse> {
  readonly type = 'SetTableComponent'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #table: TableComponent

  constructor(input: SetTableComponentParameters) {
    this.#nodeId = input.nodeId
    this.#table = input.table
    this.parameters = { nodeId: input.nodeId, table: input.table }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.table) {
      throw new Error(`Node "${this.#nodeId}" does not have a table component`)
    }
  }

  execute(engine: Engine): SetTableComponentInverse {
    const node = engine.getNode(this.#nodeId)
    const oldTable = node.components.table!
    engine.setTableComponent(this.#nodeId, this.#table)
    return { nodeId: this.#nodeId, oldTable }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
