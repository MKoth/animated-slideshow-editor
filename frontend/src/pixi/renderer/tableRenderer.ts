import type { SceneNode } from '../../engine'
import type { TableComponent } from '../../engine/components'
import { computeTableLayout, type TableLayout } from '../../engine/tableGridLayout'
import type { PixiContainer, PixiGraphics, RendererPixi } from './pixi'
import type { WorldSize } from './worldGeometry'

export const DEFAULT_TABLE_WIDTH = 400

const tableLayoutByContainer = new WeakMap<PixiContainer, TableLayout>()
const tableSizeByContainer = new WeakMap<PixiContainer, WorldSize>()
const tableChildSizeByContainer = new WeakMap<PixiContainer, WorldSize>()

export function tableLayoutOf(container: PixiContainer): TableLayout | undefined {
  return tableLayoutByContainer.get(container)
}

export function tableSizeOf(container: PixiContainer): WorldSize | undefined {
  return tableSizeByContainer.get(container)
}

export function tableChildSizeOf(container: PixiContainer): WorldSize | undefined {
  return tableChildSizeByContainer.get(container)
}

export function rebuildTableChild(
  pixi: RendererPixi,
  container: PixiContainer,
  node: SceneNode,
): WorldSize | undefined {
  const child = node.components.tableRow
    ? createTableRowContainer(pixi, node)
    : node.components.tableCell
      ? createTableCellContainer(pixi, node)
      : undefined
  if (!child) return undefined
  for (const visual of [...container.children]) {
    if (visual.label.startsWith('table-row:') || visual.label.startsWith('table-cell:')) {
      visual.destroy()
    }
  }
  container.addChildAt(child.container, 0)
  tableChildSizeByContainer.set(container, child.size)
  return child.size
}

export function createTableRowContainer(
  pixi: RendererPixi,
  node: SceneNode,
): { container: PixiContainer; size: WorldSize } | undefined {
  const tableNode = node.parent
  const table = tableNode?.components.table
  if (!tableNode || !table) return undefined

  const layout = computeTableLayout(table, tableNode.children, DEFAULT_TABLE_WIDTH)
  const rowIndex = tableNode.children.indexOf(node)
  const height = layout.rows[rowIndex] ?? 0
  const width = layout.totalWidth
  const container = new pixi.Container()
  container.label = `table-row:${node.name}`
  const background = node.components.tableRow?.background ?? '#ffffff'
  const graphics = new pixi.Graphics()
  const radius = clampRadius(
    node.components.tableRow?.borderRadius ?? table.borderRadius,
    width,
    height,
  )
  if (radius > 0) {
    graphics.roundRect(0, 0, width, height, radius)
  } else {
    graphics.rect(0, 0, width, height)
  }
  graphics.fill({ color: hexColorToNumber(background), alpha: 1 }).stroke({
    width: table.borderWidth,
    color: hexColorToNumber(node.components.tableRow?.borderColor ?? table.borderColor),
  })
  container.addChild(graphics)
  tableChildSizeByContainer.set(container, { width, height })
  return { container, size: { width, height } }
}

export function createTableCellContainer(
  pixi: RendererPixi,
  node: SceneNode,
): { container: PixiContainer; size: WorldSize } | undefined {
  const rowNode = node.parent
  const tableNode = rowNode?.parent
  const table = tableNode?.components.table
  if (!rowNode || !tableNode || !table) return undefined

  const layout = computeTableLayout(table, tableNode.children, DEFAULT_TABLE_WIDTH)
  const rect = layout.cellRects.get(node.id)
  if (!rect) return undefined

  const container = new pixi.Container()
  container.label = `table-cell:${node.name}`
  const cell = node.components.tableCell
  const borderColor = cell?.borderColor ?? table.borderColor
  const background = cell?.background ?? '#ffffff'
  const graphics = new pixi.Graphics()
  const effectiveRadius = cell?.borderRadius ?? table.borderRadius ?? 0
  const radius = clampRadius(effectiveRadius, rect.width, rect.height)
  if (radius > 0) {
    graphics.roundRect(0, 0, rect.width, rect.height, radius)
  } else {
    graphics.rect(0, 0, rect.width, rect.height)
  }
  graphics.fill({ color: hexColorToNumber(background), alpha: 1 })
  graphics.stroke({ width: table.borderWidth, color: hexColorToNumber(borderColor) })
  container.addChild(graphics)
  const size = { width: rect.width, height: rect.height }
  tableChildSizeByContainer.set(container, size)
  return { container, size }
}

export function createTableContainer(
  pixi: RendererPixi,
  node: SceneNode,
  availableWidth: number,
): PixiContainer {
  const table = node.components.table
  if (!table) {
    throw new Error(`Node "${node.name}" does not have a table component`)
  }

  const group = new pixi.Container()
  group.label = `table:${node.name}`
  group.sortableChildren = true
  populateTable(pixi, group, node, table, availableWidth)
  return group
}

export function rebuildTable(
  pixi: RendererPixi,
  group: PixiContainer,
  node: SceneNode,
  availableWidth: number,
): void {
  const table = node.components.table
  if (!table) {
    return
  }

  for (const child of [...group.children]) {
    child.destroy()
  }

  populateTable(pixi, group, node, table, availableWidth)
}

export function rebuildTableWithEvaluated(
  pixi: RendererPixi,
  group: PixiContainer,
  node: SceneNode,
  availableWidth: number,
  evaluated: { borderRadius: number; padding: number },
): void {
  const table = node.components.table
  if (!table) {
    return
  }
  const overridden: TableComponent = {
    ...table,
    borderRadius: evaluated.borderRadius,
    padding: evaluated.padding,
  }
  for (const child of [...group.children]) {
    child.destroy()
  }
  populateTable(pixi, group, node, overridden, availableWidth)
}

export function rebuildTableChildWithEvaluated(
  pixi: RendererPixi,
  container: PixiContainer,
  node: SceneNode,
  evaluated: { borderRadius: number; padding: number },
): void {
  const child = node.components.tableRow
    ? createTableRowContainerWithEvaluated(pixi, node, evaluated)
    : node.components.tableCell
      ? createTableCellContainerWithEvaluated(pixi, node, evaluated)
      : undefined
  if (!child) return
  for (const visual of [...container.children]) {
    if (visual.label.startsWith('table-row:') || visual.label.startsWith('table-cell:')) {
      visual.destroy()
    }
  }
  container.addChildAt(child.container, 0)
  tableChildSizeByContainer.set(container, child.size)
}

function createTableRowContainerWithEvaluated(
  pixi: RendererPixi,
  node: SceneNode,
  evaluated: { borderRadius: number; padding: number },
): { container: PixiContainer; size: WorldSize } | undefined {
  const tableNode = node.parent
  const table = tableNode?.components.table
  if (!tableNode || !table) return undefined
  const layout = computeTableLayout(table, tableNode.children, DEFAULT_TABLE_WIDTH)
  const rowIndex = tableNode.children.indexOf(node)
  const height = layout.rows[rowIndex] ?? 0
  const width = layout.totalWidth
  const container = new pixi.Container()
  container.label = `table-row:${node.name}`
  const background = node.components.tableRow?.background ?? '#ffffff'
  const graphics = new pixi.Graphics()
  const radius = clampRadius(evaluated.borderRadius, width, height)
  if (radius > 0) {
    graphics.roundRect(0, 0, width, height, radius)
  } else {
    graphics.rect(0, 0, width, height)
  }
  graphics.fill({ color: hexColorToNumber(background), alpha: 1 }).stroke({
    width: table.borderWidth,
    color: hexColorToNumber(node.components.tableRow?.borderColor ?? table.borderColor),
  })
  container.addChild(graphics)
  tableChildSizeByContainer.set(container, { width, height })
  return { container, size: { width, height } }
}

function createTableCellContainerWithEvaluated(
  pixi: RendererPixi,
  node: SceneNode,
  evaluated: { borderRadius: number; padding: number },
): { container: PixiContainer; size: WorldSize } | undefined {
  const rowNode = node.parent
  const tableNode = rowNode?.parent
  const table = tableNode?.components.table
  if (!rowNode || !tableNode || !table) return undefined
  const layout = computeTableLayout(table, tableNode.children, DEFAULT_TABLE_WIDTH)
  const rect = layout.cellRects.get(node.id)
  if (!rect) return undefined
  const container = new pixi.Container()
  container.label = `table-cell:${node.name}`
  const cell = node.components.tableCell
  const borderColor = cell?.borderColor ?? table.borderColor
  const background = cell?.background ?? '#ffffff'
  const graphics = new pixi.Graphics()
  const radius = clampRadius(evaluated.borderRadius, rect.width, rect.height)
  if (radius > 0) {
    graphics.roundRect(0, 0, rect.width, rect.height, radius)
  } else {
    graphics.rect(0, 0, rect.width, rect.height)
  }
  graphics.fill({ color: hexColorToNumber(background), alpha: 1 })
  graphics.stroke({ width: table.borderWidth, color: hexColorToNumber(borderColor) })
  container.addChild(graphics)
  const size = { width: rect.width, height: rect.height }
  tableChildSizeByContainer.set(container, size)
  return { container, size }
}

function populateTable(
  pixi: RendererPixi,
  group: PixiContainer,
  node: SceneNode,
  table: TableComponent,
  availableWidth: number,
): void {
  const layout = computeTableLayout(table, node.children, availableWidth)
  tableLayoutByContainer.set(group, layout)
  tableSizeByContainer.set(group, {
    width: layout.totalWidth,
    height: layout.totalHeight,
  })

  const border = createBorder(pixi, table, layout)
  group.addChild(border)
}

function createBorder(
  pixi: RendererPixi,
  table: TableComponent,
  layout: TableLayout,
): PixiGraphics {
  const graphics = new pixi.Graphics()
  const color = hexColorToNumber(table.borderColor)
  const radius = clampRadius(table.borderRadius ?? 0, layout.totalWidth, layout.totalHeight)
  if (radius > 0) {
    graphics.roundRect(0, 0, layout.totalWidth, layout.totalHeight, radius)
  } else {
    graphics.rect(0, 0, layout.totalWidth, layout.totalHeight)
  }
  graphics.stroke({ width: table.borderWidth, color })
  return graphics
}

function clampRadius(radius: number, width: number, height: number): number {
  if (!Number.isFinite(radius) || radius <= 0) return 0
  const max = Math.min(width, height) / 2
  return Math.max(0, Math.min(radius, max))
}

function hexColorToNumber(color: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(color)
  return match ? parseInt(match[1], 16) : 0x000000
}
