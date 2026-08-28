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
      rows: rows.map((r) => ({
        borderColor: r.components.tableRow?.borderColor,
        background: r.components.tableRow?.background,
        cells: r.children.map((c) => ({
          colSpan: c.components.tableCell?.colSpan,
          rowSpan: c.components.tableCell?.rowSpan,
          borderColor: c.components.tableCell?.borderColor,
          background: c.components.tableCell?.background,
          padding: c.components.tableCell?.padding,
        })),
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

function cellStride(colWidth: number, bw: number): number {
  return colWidth + bw * 2
}

export function computeTableLayout(
  table: TableComponent,
  rows: readonly SceneNode[],
  availableWidth: number,
): TableLayout {
  const { columns, gap, borderWidth } = table
  const bw = borderWidth
  const colsCount = columns.length
  const rowsCount = rows.length

  const totalGapsX = Math.max(0, colsCount - 1) * gap
  const totalBorderX = (colsCount + 1) * bw
  const innerWidth = availableWidth - totalGapsX - totalBorderX

  const colWidths = resolveDimensions(columns, innerWidth, 0)

  const rowHeights: number[] = []
  for (const row of rows) {
    const rowHeight = resolveRowHeight(row)
    rowHeights.push(rowHeight)
  }

  const spanCovered = new Set<string>()
  const cells = new Map<string, CellRect>()
  let cursorY = bw

  for (let r = 0; r < rowsCount; r++) {
    const rowNode = rows[r]
    let cursorX = bw
    let childIdx = 0

    for (let c = 0; c < colsCount; c++) {
      const spanKey = `${r},${c}`

      if (spanCovered.has(spanKey)) {
        cursorX += cellStride(colWidths[c], bw)
        if (c < colsCount - 1) cursorX += gap
        continue
      }

      const cellNode = rowNode.children[childIdx]
      const cellComp = cellNode?.components.tableCell as TableCellComponent | undefined
      const colSpan = cellComp?.colSpan ?? 1
      const rowSpan = cellComp?.rowSpan ?? 1

      const effectiveColSpan = Math.min(colSpan, colsCount - c)
      const effectiveRowSpan = Math.min(rowSpan, rowsCount - r)

      if (effectiveColSpan > 1 || effectiveRowSpan > 1) {
        for (let sr = 0; sr < effectiveRowSpan; sr++) {
          for (let sc = 0; sc < effectiveColSpan; sc++) {
            if (sr === 0 && sc === 0) continue
            spanCovered.add(`${r + sr},${c + sc}`)
          }
        }
      }

      let spanWidth = 0
      for (let sc = 0; sc < effectiveColSpan; sc++) {
        spanWidth += colWidths[c + sc]
      }
      spanWidth += Math.max(0, effectiveColSpan - 1) * gap
      spanWidth += effectiveColSpan * bw * 2

      let spanHeight = 0
      for (let sr = 0; sr < effectiveRowSpan; sr++) {
        spanHeight += rowHeights[r + sr]
      }
      spanHeight += Math.max(0, effectiveRowSpan - 1) * gap
      spanHeight += effectiveRowSpan * bw * 2

      cells.set(spanKey, {
        x: cursorX,
        y: cursorY,
        width: spanWidth,
        height: spanHeight,
      })

      cursorX += cellStride(colWidths[c], bw)
      if (c < colsCount - 1) cursorX += gap
      childIdx++
    }
    cursorY += cellStride(rowHeights[r], bw)
    if (r < rowsCount - 1) cursorY += gap
  }

  let totalWidth = bw
  for (let c = 0; c < colsCount; c++) {
    totalWidth += colWidths[c] + bw * 2
    if (c < colsCount - 1) totalWidth += gap
  }
  totalWidth += bw

  let totalHeight = bw
  for (let r = 0; r < rowsCount; r++) {
    totalHeight += rowHeights[r] + bw * 2
    if (r < rowsCount - 1) totalHeight += gap
  }
  totalHeight += bw

  return {
    columns: colWidths,
    rows: rowHeights,
    cells,
    totalWidth,
    totalHeight,
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
