import type { SceneNode } from '../../engine'
import type { TableComponent } from '../../engine/components'
import { computeTableLayout, type TableLayout, type CellRect } from '../../engine/tableGridLayout'
import type { PixiContainer, PixiGraphics, RendererPixi } from './pixi'
import type { WorldSize } from './worldGeometry'

export const DEFAULT_TABLE_WIDTH = 400

const tableLayoutByContainer = new WeakMap<PixiContainer, TableLayout>()
const tableSizeByContainer = new WeakMap<PixiContainer, WorldSize>()

export function tableLayoutOf(container: PixiContainer): TableLayout | undefined {
  return tableLayoutByContainer.get(container)
}

export function tableSizeOf(container: PixiContainer): WorldSize | undefined {
  return tableSizeByContainer.get(container)
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
  populateTable(pixi, group, table, availableWidth)
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

  populateTable(pixi, group, table, availableWidth)
}

function populateTable(
  pixi: RendererPixi,
  group: PixiContainer,
  table: TableComponent,
  availableWidth: number,
): void {
  const layout = computeTableLayout(table, availableWidth)
  tableLayoutByContainer.set(group, layout)
  tableSizeByContainer.set(group, {
    width: layout.totalWidth,
    height: layout.totalHeight,
  })

  const border = createBorder(pixi, table, layout)
  group.addChild(border)

  for (const [key, rect] of layout.cells) {
    const cellContainer = createCellContainer(pixi, key, rect, table)
    group.addChild(cellContainer)
  }
}

function createBorder(
  pixi: RendererPixi,
  table: TableComponent,
  layout: TableLayout,
): PixiGraphics {
  const graphics = new pixi.Graphics()
  const color = hexColorToNumber(table.borderColor)
  graphics
    .rect(0, 0, layout.totalWidth, layout.totalHeight)
    .stroke({ width: table.borderWidth, color })
  return graphics
}

function createCellContainer(
  pixi: RendererPixi,
  key: string,
  rect: CellRect,
  table: TableComponent,
): PixiContainer {
  const cell = new pixi.Container()
  cell.label = `cell:${key}`
  cell.position.set(rect.x, rect.y)

  const [rowStr, colStr] = key.split(',')
  const col = parseInt(colStr, 10)
  const label = table.columnMapping[col] ?? `R${rowStr}C${colStr}`

  const text = new pixi.Text({
    text: label,
    style: {
      fontSize: 12,
      fill: 0xffffff,
      fontFamily: 'system-ui, sans-serif',
    },
  })
  text.anchor.set(0, 0)
  text.position.set(table.cellPadding, table.cellPadding)
  cell.addChild(text)

  return cell
}

function hexColorToNumber(color: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(color)
  return match ? parseInt(match[1], 16) : 0x000000
}
