import type { TableComponent, TableDimension, TableCellComponent } from './components'
import type { SceneNode } from './sceneNode'

export interface CellRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface TableLayout {
  readonly columns: readonly number[]
  readonly rows: readonly number[]
  readonly cells: ReadonlyMap<string, CellRect>
  readonly cellRects: ReadonlyMap<string, CellRect>
  readonly totalWidth: number
  readonly totalHeight: number
}

export class TableLayoutCache {
  private cached: TableLayout | null = null
  private lastConfig: string | null = null
  private _layoutDirty = true

  get layoutDirty(): boolean {
    return this._layoutDirty
  }

  markDirty(): void {
    this._layoutDirty = true
  }

  compute(table: TableComponent, rows: readonly SceneNode[], availableWidth: number): TableLayout {
    const configKey = JSON.stringify({
      columns: table.columns,
      gap: table.gap,
      borderWidth: table.borderWidth,
      borderRadius: table.borderRadius,
      padding: table.padding,
      borderColor: table.borderColor,
      background: table.background,
      cells: rows
        .flatMap((r) => r.children)
        .map((c) => ({
          id: c.id,
          colSpan: c.components.tableCell?.colSpan,
          rowSpan: c.components.tableCell?.rowSpan,
          borderColor: c.components.tableCell?.borderColor,
          background: c.components.tableCell?.background,
          padding: c.components.tableCell?.padding,
          borderRadius: c.components.tableCell?.borderRadius,
        })),
      availableWidth,
    })

    if (!this._layoutDirty && this.lastConfig === configKey && this.cached !== null) {
      return this.cached
    }

    const layout = computeTableLayout(table, rows, availableWidth)
    this.cached = layout
    this.lastConfig = configKey
    this._layoutDirty = false
    return layout
  }
}

export function computeTableLayout(
  table: TableComponent,
  rows: readonly SceneNode[],
  availableWidth: number,
): TableLayout {
  const { columns, gap, padding } = table
  const colsCount = columns.length
  const flatCells = rows.flatMap((row) => row.children).filter((node) => node.components.tableCell)
  const rowsCount = Math.max(1, Math.ceil(flatCells.length / Math.max(1, colsCount)))

  const pad = Math.max(0, padding ?? 0)
  const totalGapsX = Math.max(0, colsCount - 1) * gap
  const innerWidth = Math.max(0, availableWidth - totalGapsX - 2 * pad)

  const colWidths = resolveDimensions(columns, innerWidth, 0)

  const rowHeights = Array.from({ length: rowsCount }, () => 30)

  const spanCovered = new Set<string>()
  const cellRects = new Map<string, CellRect>()
  for (const cellNode of flatCells) {
    const cellComp = cellNode.components.tableCell as TableCellComponent
    const start = nextFreePosition(spanCovered, colsCount)
    const row = start.row
    const column = start.column
    const effectiveColSpan = Math.min(Math.max(1, cellComp.colSpan), colsCount - column)
    const effectiveRowSpan = Math.max(1, cellComp.rowSpan)

    while (row + effectiveRowSpan > rowHeights.length) rowHeights.push(30)
    for (let sr = 0; sr < effectiveRowSpan; sr++) {
      for (let sc = 0; sc < effectiveColSpan; sc++) {
        spanCovered.add(`${row + sr},${column + sc}`)
      }
    }

    let x = pad
    for (let c = 0; c < column; c++) x += colWidths[c] + gap
    let y = pad
    for (let r = 0; r < row; r++) y += rowHeights[r] + gap
    let width = 0
    for (let c = 0; c < effectiveColSpan; c++) width += colWidths[column + c]
    width += Math.max(0, effectiveColSpan - 1) * gap
    let height = 0
    for (let r = 0; r < effectiveRowSpan; r++) height += rowHeights[row + r]
    height += Math.max(0, effectiveRowSpan - 1) * gap

    const rect = { x, y, width, height }
    cellRects.set(cellNode.id, rect)
  }

  let totalWidth = 2 * pad
  for (let c = 0; c < colsCount; c++) {
    totalWidth += colWidths[c]
    if (c < colsCount - 1) totalWidth += gap
  }

  let totalHeight = 2 * pad
  for (let r = 0; r < rowHeights.length; r++) {
    totalHeight += rowHeights[r]
    if (r < rowHeights.length - 1) totalHeight += gap
  }

  return {
    columns: colWidths,
    rows: rowHeights,
    cells: computeLegacyCellRects(table, rows, colWidths, gap),
    cellRects,
    totalWidth,
    totalHeight,
  }
}

function computeLegacyCellRects(
  table: TableComponent,
  rows: readonly SceneNode[],
  colWidths: readonly number[],
  gap: number,
): ReadonlyMap<string, CellRect> {
  const pad = Math.max(0, table.padding ?? 0)
  const result = new Map<string, CellRect>()
  const rowHeights = rows.map(resolveRowHeight)
  const covered = new Set<string>()
  let y = pad
  for (let r = 0; r < rows.length; r++) {
    let x = pad
    let childIndex = 0
    for (let c = 0; c < table.columns.length; c++) {
      if (covered.has(`${r},${c}`)) {
        x += colWidths[c] + (c < table.columns.length - 1 ? gap : 0)
        continue
      }
      const cell = rows[r].children[childIndex]
      if (!cell) break
      const component = cell.components.tableCell
      const colSpan = Math.min(component?.colSpan ?? 1, table.columns.length - c)
      const rowSpan = Math.min(component?.rowSpan ?? 1, rows.length - r)
      for (let sr = 0; sr < rowSpan; sr++) {
        for (let sc = 0; sc < colSpan; sc++) {
          if (sr || sc) covered.add(`${r + sr},${c + sc}`)
        }
      }
      const width =
        colWidths.slice(c, c + colSpan).reduce((sum, value) => sum + value, 0) + (colSpan - 1) * gap
      const height =
        rowHeights.slice(r, r + rowSpan).reduce((sum, value) => sum + value, 0) +
        (rowSpan - 1) * gap
      result.set(`${r},${c}`, { x, y, width, height })
      x += colWidths[c] + (c < table.columns.length - 1 ? gap : 0)
      childIndex++
      c += colSpan - 1
    }
    y += rowHeights[r] + (r < rows.length - 1 ? gap : 0)
  }
  return result
}

function nextFreePosition(
  occupied: ReadonlySet<string>,
  columnCount: number,
): { row: number; column: number } {
  for (let row = 0; ; row++) {
    for (let column = 0; column < columnCount; column++) {
      if (!occupied.has(`${row},${column}`)) return { row, column }
    }
  }
}

function resolveRowHeight(rowNode: SceneNode): number {
  const rowComp = rowNode.components.tableRow
  if (!rowComp) return 0

  let maxHeight = 30
  for (const cell of rowNode.children) {
    const cellComp = cell.components.tableCell
    if (cellComp) {
      const rowSpan = cellComp.rowSpan ?? 1
      if (rowSpan === 1) {
        maxHeight = Math.max(maxHeight, 30)
      }
    }
  }
  return maxHeight
}

function resolveDimensions(
  dims: readonly TableDimension[],
  availableSpace: number,
  paddingTotal: number,
): number[] {
  let fixedTotal = 0
  let autoCount = 0
  const minimums: number[] = []

  for (const dim of dims) {
    const minW = dim.minWidth ?? 0
    minimums.push(minW)
    if (dim.width === 'auto') {
      autoCount++
    } else {
      fixedTotal += dim.width
    }
  }

  const remainingForAuto = Math.max(0, availableSpace - fixedTotal - autoCount * paddingTotal)
  const widths: number[] = []

  for (let i = 0; i < dims.length; i++) {
    const dim = dims[i]
    let w: number
    if (dim.width === 'auto') {
      w = autoCount > 0 ? remainingForAuto / autoCount : 0
    } else {
      w = dim.width
    }
    w = Math.max(w, minimums[i])
    widths.push(w)
  }

  return widths
}
