import type { TableComponent, TableDimension } from './components'

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

  compute(table: TableComponent, availableWidth: number): TableLayout {
    const configKey = JSON.stringify({
      columns: table.columns,
      rows: table.rows,
      gap: table.gap,
      cellPadding: table.cellPadding,
      borderWidth: table.borderWidth,
      availableWidth,
    })

    if (!this._layoutDirty && this.lastConfig === configKey && this.cached !== null) {
      return this.cached
    }

    const layout = computeTableLayout(table, availableWidth)
    this.cached = layout
    this.lastConfig = configKey
    this._layoutDirty = false
    return layout
  }
}

function cellStride(colWidth: number, bw: number, cp: number): number {
  return colWidth + bw * 2 + cp * 2
}

export function computeTableLayout(table: TableComponent, availableWidth: number): TableLayout {
  const { columns, rows, gap, cellPadding, borderWidth } = table
  const bw = borderWidth
  const cp = cellPadding
  const colsCount = columns.length
  const rowsCount = rows.length

  const totalGapsX = Math.max(0, colsCount - 1) * gap
  const totalBorderX = (colsCount + 1) * bw
  const totalPaddingX = colsCount * cp * 2
  const innerWidth = availableWidth - totalGapsX - totalBorderX - totalPaddingX

  const colWidths = resolveDimensions(columns, innerWidth, 0)
  const rowHeights = resolveDimensions(rows, 0, 0)

  const cells = new Map<string, CellRect>()
  const spanCovered = new Set<string>()
  let cursorY = bw

  for (let r = 0; r < rowsCount; r++) {
    let cursorX = bw
    for (let c = 0; c < colsCount; c++) {
      const spanKey = `${r},${c}`

      if (spanCovered.has(spanKey)) {
        cursorX += cellStride(colWidths[c], bw, cp)
        if (c < colsCount - 1) cursorX += gap
        continue
      }

      const span = table.cellSpans[spanKey]
      let spanWidth = 0
      let spanHeight = 0

      const colCount = span ? Math.min(span.colSpan, colsCount - c) : 1
      const rowCount = span ? Math.min(span.rowSpan, rowsCount - r) : 1

      if (colCount > 1 || rowCount > 1) {
        for (let sr = 0; sr < rowCount; sr++) {
          for (let sc = 0; sc < colCount; sc++) {
            if (sr === 0 && sc === 0) continue
            spanCovered.add(`${r + sr},${c + sc}`)
          }
        }
      }

      for (let sc = 0; sc < colCount; sc++) {
        spanWidth += colWidths[c + sc]
      }
      spanWidth += (colCount - 1) * gap
      spanWidth += colCount * (bw * 2 + cp * 2)

      for (let sr = 0; sr < rowCount; sr++) {
        spanHeight += rowHeights[r + sr]
      }
      spanHeight += (rowCount - 1) * gap
      spanHeight += rowCount * (bw * 2 + cp * 2)

      cells.set(spanKey, {
        x: cursorX,
        y: cursorY,
        width: spanWidth,
        height: spanHeight,
      })

      cursorX += cellStride(colWidths[c], bw, cp)
      if (c < colsCount - 1) cursorX += gap
    }
    cursorY += cellStride(rowHeights[r], bw, cp)
    if (r < rowsCount - 1) cursorY += gap
  }

  let totalWidth = bw
  for (let c = 0; c < colsCount; c++) {
    totalWidth += colWidths[c] + bw + cp * 2
    if (c < colsCount - 1) totalWidth += gap
  }
  totalWidth += bw

  let totalHeight = bw
  for (let r = 0; r < rowsCount; r++) {
    totalHeight += rowHeights[r] + bw + cp * 2
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
