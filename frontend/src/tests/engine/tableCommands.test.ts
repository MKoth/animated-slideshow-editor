import { describe, expect, it } from 'vitest'
import type { CommandResult } from '../../engine/commands'
import {
  CreateProjectCommand,
  CreateSlideCommand,
  CreateNodeCommand,
  createCommandSystem,
} from '../../engine/commands'
import {
  CreateTableCommand,
  AddTableRowCommand,
  RemoveTableRowCommand,
  AddTableColumnCommand,
  RemoveTableColumnCommand,
  SetTableRowComponentCommand,
  SetTableCellComponentCommand,
} from '../../engine/commands/tableCommands'
import type { TableRowComponent, TableCellComponent } from '../../engine/components'

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function setupWithSlide() {
  const system = createCommandSystem()
  expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const slide = system.engine.project!.slides[0]
  return { system, slide }
}

function setupWithTable() {
  const { system, slide } = setupWithSlide()
  const { tableNodeId } = expectOk(
    system.dispatcher.dispatch(
      new CreateTableCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
      }),
    ),
  )
  return { system, slide, tableNodeId }
}

describe('CreateTableCommand', () => {
  it('creates a table node with default 2x2 grid of row and cell children', () => {
    const { system, tableNodeId } = setupWithTable()
    const tableNode = system.engine.getNode(tableNodeId)

    expect(tableNode.components.table).toBeDefined()
    expect(tableNode.components.table!.columns).toHaveLength(2)
    expect(tableNode.children).toHaveLength(2)

    for (const row of tableNode.children) {
      expect(row.components.tableRow).toBeDefined()
      expect(row.children).toHaveLength(2)
      for (const cell of row.children) {
        expect(cell.components.tableCell).toBeDefined()
      }
    }
  })

  it('validates parent exists', () => {
    const system = createCommandSystem()
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const slide = system.engine.project!.slides[0]
    const result = system.dispatcher.dispatch(
      new CreateTableCommand({
        sceneId: slide.scene.id,
        parentId: 'nonexistent',
      }),
    )
    expect(result.ok).toBe(false)
  })
})

describe('AddTableRowCommand', () => {
  it('adds a new row to the table', () => {
    const { system, tableNodeId } = setupWithTable()
    const tableNode = system.engine.getNode(tableNodeId)

    expect(tableNode.children).toHaveLength(2)

    expectOk(
      system.dispatcher.dispatch(
        new AddTableRowCommand({ tableNodeId, index: -1 }),
      ),
    )

    const updatedTable = system.engine.getNode(tableNodeId)
    expect(updatedTable.children).toHaveLength(3)
    const newRow = updatedTable.children[2]
    expect(newRow.components.tableRow).toBeDefined()
    expect(newRow.children).toHaveLength(2)
  })

  it('adds a row at a specific index', () => {
    const { system, tableNodeId } = setupWithTable()
    expectOk(
      system.dispatcher.dispatch(
        new AddTableRowCommand({ tableNodeId, index: 0 }),
      ),
    )
    const updatedTable = system.engine.getNode(tableNodeId)
    expect(updatedTable.children).toHaveLength(3)
    expect(updatedTable.children[0].components.tableRow).toBeDefined()
  })

  it('validates table node has table component', () => {
    const { system, slide } = setupWithSlide()
    const { nodeId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'NotATable',
        }),
      ),
    )
    const result = system.dispatcher.dispatch(
      new AddTableRowCommand({ tableNodeId: nodeId, index: -1 }),
    )
    expect(result.ok).toBe(false)
  })
})

describe('RemoveTableRowCommand', () => {
  it('removes a row from the table', () => {
    const { system, tableNodeId } = setupWithTable()
    const tableNode = system.engine.getNode(tableNodeId)
    const rowId = tableNode.children[0].id

    expectOk(
      system.dispatcher.dispatch(
        new RemoveTableRowCommand({ rowNodeId: rowId }),
      ),
    )

    const updatedTable = system.engine.getNode(tableNodeId)
    expect(updatedTable.children).toHaveLength(1)
  })

  it('validates row has tableRow component', () => {
    const { system, slide } = setupWithSlide()
    const { nodeId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'NotARow',
        }),
      ),
    )
    const result = system.dispatcher.dispatch(
      new RemoveTableRowCommand({ rowNodeId: nodeId }),
    )
    expect(result.ok).toBe(false)
  })
})

describe('AddTableColumnCommand', () => {
  it('adds a column to every row and updates table columns', () => {
    const { system, tableNodeId } = setupWithTable()

    expectOk(
      system.dispatcher.dispatch(
        new AddTableColumnCommand({ tableNodeId, index: -1 }),
      ),
    )

    const updatedTable = system.engine.getNode(tableNodeId)
    expect(updatedTable.components.table!.columns).toHaveLength(3)
    for (const row of updatedTable.children) {
      expect(row.children).toHaveLength(3)
    }
  })
})

describe('RemoveTableColumnCommand', () => {
  it('removes a column from every row and updates table columns', () => {
    const { system, tableNodeId } = setupWithTable()

    expectOk(
      system.dispatcher.dispatch(
        new RemoveTableColumnCommand({ tableNodeId, columnIndex: 0 }),
      ),
    )

    const updatedTable = system.engine.getNode(tableNodeId)
    expect(updatedTable.components.table!.columns).toHaveLength(1)
    for (const row of updatedTable.children) {
      expect(row.children).toHaveLength(1)
    }
  })

  it('validates column index is in range', () => {
    const { system, tableNodeId } = setupWithTable()
    const result = system.dispatcher.dispatch(
      new RemoveTableColumnCommand({ tableNodeId, columnIndex: 5 }),
    )
    expect(result.ok).toBe(false)
  })
})

describe('SetTableRowComponentCommand', () => {
  it('replaces the tableRow component on a row node', () => {
    const { system, tableNodeId } = setupWithTable()
    const tableNode = system.engine.getNode(tableNodeId)
    const rowId = tableNode.children[0].id

    const newRow: TableRowComponent = {
      kind: 'tableRow',
      borderColor: '#ff0000',
      background: '#eeeeee',
    }

    expectOk(
      system.dispatcher.dispatch(
        new SetTableRowComponentCommand({ nodeId: rowId, tableRow: newRow }),
      ),
    )

    const updatedRow = system.engine.getNode(rowId)
    expect(updatedRow.components.tableRow).toEqual(newRow)
  })
})

describe('SetTableCellComponentCommand', () => {
  it('replaces the tableCell component on a cell node', () => {
    const { system, tableNodeId } = setupWithTable()
    const tableNode = system.engine.getNode(tableNodeId)
    const cellId = tableNode.children[0].children[0].id

    const newCell: TableCellComponent = {
      kind: 'tableCell',
      colSpan: 2,
      rowSpan: 1,
      borderColor: '#00ff00',
      background: '#ffffff',
      padding: 16,
    }

    expectOk(
      system.dispatcher.dispatch(
        new SetTableCellComponentCommand({ nodeId: cellId, tableCell: newCell }),
      ),
    )

    const updatedCell = system.engine.getNode(cellId)
    expect(updatedCell.components.tableCell).toEqual(newCell)
  })
})
