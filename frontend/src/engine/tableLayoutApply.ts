import type { Engine } from './internal'
import { computeTableLayout } from './tableGridLayout'

const DEFAULT_TABLE_WIDTH = 400

export function applyTableLayout(engine: Engine, tableNodeId: string): void {
  const tableNode = engine.getNode(tableNodeId)
  const table = tableNode.components.table
  if (!table) return
  const layout = computeTableLayout(table, tableNode.children, DEFAULT_TABLE_WIDTH)

  for (const rowNode of tableNode.children) {
    for (const cellNode of rowNode.children) {
      const rect = layout.cellRects.get(cellNode.id)
      if (!rect) continue
      engine.setTransform(cellNode.id, {
        ...cellNode.transform,
        x: rect.x,
        y: rect.y,
      })
    }
  }
}
