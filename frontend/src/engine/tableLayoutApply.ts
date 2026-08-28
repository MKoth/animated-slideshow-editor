import type { Engine } from './internal'
import type { TableCellComponent } from './components'
import { computeTableLayout } from './tableGridLayout'

const DEFAULT_TABLE_WIDTH = 400

export function applyTableLayout(engine: Engine, tableNodeId: string): void {
  const tableNode = engine.getNode(tableNodeId)
  const table = tableNode.components.table
  if (!table) return
  const layout = computeTableLayout(table, tableNode.children, DEFAULT_TABLE_WIDTH)

  let cursorY = table.borderWidth
  for (let r = 0; r < tableNode.children.length; r++) {
    const rowNode = tableNode.children[r]
    const rowHeight = layout.rows[r] ?? 0

    engine.setTransform(rowNode.id, {
      ...rowNode.transform,
      x: table.borderWidth,
      y: cursorY,
    })

    let cursorX = 0
    let childIdx = 0
    for (let c = 0; c < table.columns.length; c++) {
      const cellNode = rowNode.children[childIdx]
      if (!cellNode) break

      const cellComp = cellNode.components.tableCell as TableCellComponent | undefined
      const colSpan = cellComp?.colSpan ?? 1
      const effectiveColSpan = Math.min(colSpan, table.columns.length - c)

      const cellWidth = layout.cells.get(`${r},${c}`)?.width ?? 0

      engine.setTransform(cellNode.id, {
        ...cellNode.transform,
        x: cursorX,
        y: 0,
      })

      cursorX += cellWidth
      childIdx++

      c += effectiveColSpan - 1
    }

    cursorY += rowHeight + table.borderWidth * 2
    if (r < tableNode.children.length - 1) {
      cursorY += table.gap
    }
  }
}
