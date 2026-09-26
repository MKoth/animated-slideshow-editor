import { nextFreePosition } from './tableGridLayout'

/**
 * The node fields a table grid needs. Structurally satisfied by the compiler's
 * `AnimationScriptNodeInfo`, so this module stays independent of the compiler.
 */
export interface ScriptTableNodeInfo {
  readonly id: string
  readonly name: string
  readonly parentId?: string
  readonly isTableCell?: boolean
  /** The owning table's declared column count; only meaningful when a table. */
  readonly tableColumnCount?: number
  /** Cell span; only meaningful when `isTableCell`. */
  readonly colSpan?: number
  readonly rowSpan?: number
}

/**
 * The compiler-side view of a table's logical grid: every Table Cell node
 * placed at the origin Grid Slot the engine's layout resolves it to (the same
 * first-free placement `tableGridLayout` uses), grouped in engine layout order.
 *
 * Cells are listed in placement order — rows walked in child order, each row's
 * cells in child order, each cell at the first free slot — so row/col
 * broadcasts are deterministic. A spanned cell is recorded once, at its origin
 * slot, and every slot it covers maps back to it: row/col groups therefore
 * contain a spanned cell only in the single row and column of its top-left
 * corner, and `cell(r, c)` resolves any covered slot to that one cell.
 */
export interface ScriptTableGridCell {
  readonly nodeId: string
  readonly nodeName: string
  /** Origin Grid Slot row (0-based). */
  readonly row: number
  /** Origin Grid Slot column (0-based). */
  readonly column: number
  readonly rowSpan: number
  readonly colSpan: number
}

export interface ScriptTableGrid {
  readonly tableName: string
  /** Cells in engine layout (placement) order. */
  readonly cells: readonly ScriptTableGridCell[]
  /** Every covered Grid Slot, keyed `"row,column"`, to the cell that owns it. */
  readonly slots: ReadonlyMap<string, ScriptTableGridCell>
  /** Bounding row count: the last row any cell reaches, plus one. */
  readonly rowCount: number
  /** The table's declared column count. */
  readonly columnCount: number
}

export function buildScriptTableGrid(
  table: ScriptTableNodeInfo,
  nodes: readonly ScriptTableNodeInfo[],
): ScriptTableGrid {
  const columnCount = Math.max(1, table.tableColumnCount ?? 0)
  const flatCells = nodes
    .filter((node) => node.parentId === table.id)
    .flatMap((row) => nodes.filter((node) => node.parentId === row.id && node.isTableCell === true))

  const occupied = new Set<string>()
  const cells: ScriptTableGridCell[] = []
  const slots = new Map<string, ScriptTableGridCell>()
  for (const cell of flatCells) {
    const start = nextFreePosition(occupied, columnCount)
    const colSpan = Math.min(Math.max(1, cell.colSpan ?? 1), columnCount - start.column)
    const rowSpan = Math.max(1, cell.rowSpan ?? 1)
    const placed: ScriptTableGridCell = {
      nodeId: cell.id,
      nodeName: cell.name,
      row: start.row,
      column: start.column,
      rowSpan,
      colSpan,
    }
    cells.push(placed)
    for (let row = start.row; row < start.row + rowSpan; row += 1) {
      for (let column = start.column; column < start.column + colSpan; column += 1) {
        occupied.add(slotKey(row, column))
        slots.set(slotKey(row, column), placed)
      }
    }
  }

  const rowCount = cells.reduce((count, cell) => Math.max(count, cell.row + cell.rowSpan), 0)
  return {
    tableName: table.name,
    cells,
    slots,
    rowCount,
    columnCount,
  }
}

/** The cell covering a Grid Slot, origin or spanned; undefined for empty slots. */
export function scriptTableCellAt(
  grid: ScriptTableGrid,
  row: number,
  column: number,
): ScriptTableGridCell | undefined {
  return grid.slots.get(slotKey(row, column))
}

/** The cells whose origin slot sits in row `index`, in engine layout order. */
export function scriptTableRowCells(
  grid: ScriptTableGrid,
  index: number,
): readonly ScriptTableGridCell[] {
  return grid.cells.filter((cell) => cell.row === index)
}

/** The cells whose origin slot sits in column `index`, in engine layout order. */
export function scriptTableColumnCells(
  grid: ScriptTableGrid,
  index: number,
): readonly ScriptTableGridCell[] {
  return grid.cells.filter((cell) => cell.column === index)
}

function slotKey(row: number, column: number): string {
  return `${row},${column}`
}
