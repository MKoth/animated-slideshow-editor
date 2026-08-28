import type { Engine } from '../internal'
import type { Command } from './command'
import type { TableRowComponent, TableCellComponent } from '../components'
import { defaultTableComponent, defaultTableRowComponent, defaultTableCellComponent } from '../defaultTable'
import { walkPreOrder } from '../sceneNode'

// ── CreateTableCommand ──────────────────────────────────────────────

export interface CreateTableParameters {
  readonly sceneId: string
  readonly parentId: string
}

export interface CreateTableInverse {
  readonly tableNodeId: string
}

export class CreateTableCommand implements Command<CreateTableInverse> {
  readonly type = 'CreateTable'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #sceneId: string
  readonly #parentId: string

  constructor(input: CreateTableParameters) {
    this.#sceneId = input.sceneId
    this.#parentId = input.parentId
    this.parameters = { sceneId: input.sceneId, parentId: input.parentId }
  }

  validate(engine: Engine): void {
    const scene = engine.getScene(this.#sceneId)
    if (!scene.getNode(this.#parentId)) {
      throw new Error(`Parent node not found: ${this.#parentId}`)
    }
  }

  execute(engine: Engine): CreateTableInverse {
    const table = defaultTableComponent()
    const tableNode = engine.createNode(this.#sceneId, this.#parentId, 'Table', {
      components: { table },
    })

    for (let r = 0; r < 2; r++) {
      const rowNode = engine.createNode(this.#sceneId, tableNode.id, `Row ${r + 1}`, {
        components: { tableRow: defaultTableRowComponent() },
      })
      for (let c = 0; c < 2; c++) {
        engine.createNode(this.#sceneId, rowNode.id, `Cell ${r + 1},${c + 1}`, {
          components: { tableCell: defaultTableCellComponent() },
        })
      }
    }

    return { tableNodeId: tableNode.id }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}

// ── AddTableRowCommand ──────────────────────────────────────────────

export interface AddTableRowParameters {
  readonly tableNodeId: string
  readonly index: number
}

export interface AddTableRowInverse {
  readonly rowNodeId: string
}

export class AddTableRowCommand implements Command<AddTableRowInverse> {
  readonly type = 'AddTableRow'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #tableNodeId: string
  readonly #index: number

  constructor(input: AddTableRowParameters) {
    this.#tableNodeId = input.tableNodeId
    this.#index = input.index
    this.parameters = { tableNodeId: input.tableNodeId, index: input.index }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#tableNodeId)
    if (!node.components.table) {
      throw new Error(`Node "${this.#tableNodeId}" does not have a table component`)
    }
  }

  execute(engine: Engine): AddTableRowInverse {
    const tableNode = engine.getNode(this.#tableNodeId)
    const sceneId = engine.getNodeScene(this.#tableNodeId).id
    const colCount = tableNode.components.table!.columns.length
    const rowIndex = this.#index < 0 ? tableNode.children.length : this.#index

    const rowNode = engine.createNode(sceneId, this.#tableNodeId, `Row ${rowIndex + 1}`, {
      components: { tableRow: defaultTableRowComponent() },
    })

    for (let c = 0; c < colCount; c++) {
      engine.createNode(sceneId, rowNode.id, `Cell ${rowIndex + 1},${c + 1}`, {
        components: { tableCell: defaultTableCellComponent() },
      })
    }

    if (rowIndex < tableNode.children.length - 1) {
      const movedRow = tableNode.children[tableNode.children.length - 1]
      tableNode.children.splice(tableNode.children.length - 1, 1)
      tableNode.children.splice(rowIndex, 0, movedRow)
    }

    return { rowNodeId: rowNode.id }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}

// ── RemoveTableRowCommand ───────────────────────────────────────────

export interface RemoveTableRowParameters {
  readonly rowNodeId: string
}

export interface RemoveTableRowInverse {
  readonly rowNodeId: string
  readonly tableNodeId: string
  readonly rowIndex: number
  readonly nodes: readonly unknown[]
}

export class RemoveTableRowCommand implements Command<RemoveTableRowInverse> {
  readonly type = 'RemoveTableRow'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #rowNodeId: string

  constructor(input: RemoveTableRowParameters) {
    this.#rowNodeId = input.rowNodeId
    this.parameters = { rowNodeId: input.rowNodeId }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#rowNodeId)
    if (!node.components.tableRow) {
      throw new Error(`Node "${this.#rowNodeId}" does not have a tableRow component`)
    }
    if (!node.parent || !node.parent.components.table) {
      throw new Error(`Node "${this.#rowNodeId}" is not a child of a table node`)
    }
  }

  execute(engine: Engine): RemoveTableRowInverse {
    const rowNode = engine.getNode(this.#rowNodeId)
    const tableNode = rowNode.parent!
    const rowIndex = tableNode.children.indexOf(rowNode)
    const tableNodeId = tableNode.id

    const nodes = [...walkPreOrder(rowNode)].map((entry) => entry.toJSON())

    engine.removeNode(this.#rowNodeId)

    return { rowNodeId: this.#rowNodeId, tableNodeId, rowIndex, nodes }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}

// ── AddTableColumnCommand ───────────────────────────────────────────

export interface AddTableColumnParameters {
  readonly tableNodeId: string
  readonly index: number
}

export interface AddTableColumnInverse {
  readonly tableNodeId: string
}

export class AddTableColumnCommand implements Command<AddTableColumnInverse> {
  readonly type = 'AddTableColumn'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #tableNodeId: string
  readonly #index: number

  constructor(input: AddTableColumnParameters) {
    this.#tableNodeId = input.tableNodeId
    this.#index = input.index
    this.parameters = { tableNodeId: input.tableNodeId, index: input.index }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#tableNodeId)
    if (!node.components.table) {
      throw new Error(`Node "${this.#tableNodeId}" does not have a table component`)
    }
  }

  execute(engine: Engine): AddTableColumnInverse {
    const tableNode = engine.getNode(this.#tableNodeId)
    const table = tableNode.components.table!
    const sceneId = engine.getNodeScene(this.#tableNodeId).id
    const colIndex = this.#index < 0 ? table.columns.length : this.#index

    const newCol = { width: 100 as number | 'auto' }
    const newColumns = [...table.columns]
    newColumns.splice(colIndex, 0, newCol)
    engine.setTableComponent(this.#tableNodeId, { ...table, columns: newColumns })

    for (const row of tableNode.children) {
      const cellNode = engine.createNode(sceneId, row.id, `Cell ${row.children.length + 1}`, {
        components: { tableCell: defaultTableCellComponent() },
      })
      if (colIndex < row.children.length) {
        row.children.splice(row.children.length - 1, 1)
        row.children.splice(colIndex, 0, cellNode)
      }
    }

    return { tableNodeId: this.#tableNodeId }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}

// ── RemoveTableColumnCommand ────────────────────────────────────────

export interface RemoveTableColumnParameters {
  readonly tableNodeId: string
  readonly columnIndex: number
}

export interface RemoveTableColumnInverse {
  readonly tableNodeId: string
}

export class RemoveTableColumnCommand implements Command<RemoveTableColumnInverse> {
  readonly type = 'RemoveTableColumn'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #tableNodeId: string
  readonly #columnIndex: number

  constructor(input: RemoveTableColumnParameters) {
    this.#tableNodeId = input.tableNodeId
    this.#columnIndex = input.columnIndex
    this.parameters = { tableNodeId: input.tableNodeId, columnIndex: input.columnIndex }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#tableNodeId)
    if (!node.components.table) {
      throw new Error(`Node "${this.#tableNodeId}" does not have a table component`)
    }
    const table = node.components.table!
    if (this.#columnIndex < 0 || this.#columnIndex >= table.columns.length) {
      throw new Error(
        `Column index ${this.#columnIndex} is out of range (0-${table.columns.length - 1})`,
      )
    }
    if (table.columns.length <= 1) {
      throw new Error('Cannot remove the last column')
    }
  }

  execute(engine: Engine): RemoveTableColumnInverse {
    const tableNode = engine.getNode(this.#tableNodeId)
    const table = tableNode.components.table!

    const newColumns = [...table.columns]
    newColumns.splice(this.#columnIndex, 1)
    engine.setTableComponent(this.#tableNodeId, { ...table, columns: newColumns })

    for (const row of tableNode.children) {
      if (this.#columnIndex < row.children.length) {
        engine.removeNode(row.children[this.#columnIndex].id)
      }
    }

    return { tableNodeId: this.#tableNodeId }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}

// ── SetTableRowComponentCommand ─────────────────────────────────────

export interface SetTableRowComponentParameters {
  readonly nodeId: string
  readonly tableRow: TableRowComponent
}

export interface SetTableRowComponentInverse {
  readonly nodeId: string
  readonly oldTableRow: TableRowComponent
}

export class SetTableRowComponentCommand implements Command<SetTableRowComponentInverse> {
  readonly type = 'SetTableRowComponent'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #tableRow: TableRowComponent

  constructor(input: SetTableRowComponentParameters) {
    this.#nodeId = input.nodeId
    this.#tableRow = input.tableRow
    this.parameters = { nodeId: input.nodeId, tableRow: input.tableRow }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.tableRow) {
      throw new Error(`Node "${this.#nodeId}" does not have a tableRow component`)
    }
  }

  execute(engine: Engine): SetTableRowComponentInverse {
    const node = engine.getNode(this.#nodeId)
    const oldTableRow = node.components.tableRow!
    engine.setTableRowComponent(this.#nodeId, this.#tableRow)
    return { nodeId: this.#nodeId, oldTableRow }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}

// ── SetTableCellComponentCommand ────────────────────────────────────

export interface SetTableCellComponentParameters {
  readonly nodeId: string
  readonly tableCell: TableCellComponent
}

export interface SetTableCellComponentInverse {
  readonly nodeId: string
  readonly oldTableCell: TableCellComponent
}

export class SetTableCellComponentCommand implements Command<SetTableCellComponentInverse> {
  readonly type = 'SetTableCellComponent'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #tableCell: TableCellComponent

  constructor(input: SetTableCellComponentParameters) {
    this.#nodeId = input.nodeId
    this.#tableCell = input.tableCell
    this.parameters = { nodeId: input.nodeId, tableCell: input.tableCell }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.tableCell) {
      throw new Error(`Node "${this.#nodeId}" does not have a tableCell component`)
    }
  }

  execute(engine: Engine): SetTableCellComponentInverse {
    const node = engine.getNode(this.#nodeId)
    const oldTableCell = node.components.tableCell!
    engine.setTableCellComponent(this.#nodeId, this.#tableCell)
    return { nodeId: this.#nodeId, oldTableCell }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
