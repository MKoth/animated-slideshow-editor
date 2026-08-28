import { describe, expect, it } from 'vitest'
import { computeTableLayout, TableLayoutCache } from '../../engine/tableGridLayout'
import type { TableComponent, TableCellComponent } from '../../engine/components'
import { SceneNode } from '../../engine/sceneNode'
import type { Transform } from '../../engine/transform'

const IDENTITY: Transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }

function makeTableComponent(overrides: Partial<TableComponent> = {}): TableComponent {
  return {
    kind: 'table',
    columns: [{ width: 100 }, { width: 200 }],
    gap: 0,
    borderWidth: 0,
    borderColor: '#000000',
    ...overrides,
  }
}

function makeRow(
  cells: TableCellComponent[] = [
    { kind: 'tableCell', colSpan: 1, rowSpan: 1 },
    { kind: 'tableCell', colSpan: 1, rowSpan: 1 },
  ],
  name = 'Row',
): SceneNode {
  const row = new SceneNode('row-' + Math.random().toString(36).slice(2, 8), name, IDENTITY, {
    tableRow: { kind: 'tableRow' },
  })
  for (let i = 0; i < cells.length; i++) {
    const cell = new SceneNode(
      'cell-' + Math.random().toString(36).slice(2, 8),
      `Cell ${i}`,
      IDENTITY,
      { tableCell: cells[i] },
    )
    cell.parent = row
    row.children.push(cell)
  }
  return row
}

function makeRows(
  count: number,
  colsPerRow: number,
  cellOverrides?: Partial<TableCellComponent>,
): SceneNode[] {
  const rows: SceneNode[] = []
  for (let r = 0; r < count; r++) {
    const cells: TableCellComponent[] = []
    for (let c = 0; c < colsPerRow; c++) {
      cells.push({ kind: 'tableCell', colSpan: 1, rowSpan: 1, ...cellOverrides })
    }
    rows.push(makeRow(cells, `Row ${r + 1}`))
  }
  return rows
}

describe('computeTableLayout', () => {
  it('lays cells out sequentially across logical rows', () => {
    const table = makeTableComponent({ columns: [{ width: 100 }, { width: 100 }, { width: 100 }] })
    const rows = makeRows(2, 2)
    const layout = computeTableLayout(table, rows, 300)
    const cells = rows.flatMap((row) => row.children)

    expect(layout.cellRects.get(cells[0].id)).toEqual({ x: 0, y: 0, width: 100, height: 30 })
    expect(layout.cellRects.get(cells[1].id)).toEqual({ x: 100, y: 0, width: 100, height: 30 })
    expect(layout.cellRects.get(cells[2].id)).toEqual({ x: 200, y: 0, width: 100, height: 30 })
    expect(layout.cellRects.get(cells[3].id)).toEqual({ x: 0, y: 30, width: 100, height: 30 })
  })

  it('computes layout for fixed-width columns', () => {
    const table = makeTableComponent()
    const rows = makeRows(2, 2)
    const layout = computeTableLayout(table, rows, 300)

    expect(layout.columns).toEqual([100, 200])
    expect(layout.totalWidth).toBe(300)
  })

  it('distributes remaining space to auto columns proportionally', () => {
    const table = makeTableComponent({
      columns: [{ width: 100 }, { width: 'auto' }, { width: 'auto' }],
    })
    const rows = makeRows(2, 3)
    const layout = computeTableLayout(table, rows, 400)

    expect(layout.columns[0]).toBe(100)
    expect(layout.columns[1]).toBe(150)
    expect(layout.columns[2]).toBe(150)
    expect(layout.totalWidth).toBe(400)
  })

  it('applies gap between columns and rows', () => {
    const table = makeTableComponent({ gap: 10 })
    const rows = makeRows(2, 2)
    const layout = computeTableLayout(table, rows, 310)

    expect(layout.totalWidth).toBe(310)
    expect(layout.cells.get('0,0')?.x).toBe(0)
    expect(layout.cells.get('0,1')?.x).toBe(110)
  })

  it('does not inset cells for border width', () => {
    const table = makeTableComponent({ borderWidth: 2 })
    const rows = makeRows(2, 2)
    const layout = computeTableLayout(table, rows, 312)

    expect(layout.cells.get('0,0')?.x).toBe(0)
    expect(layout.cells.get('0,0')?.y).toBe(0)
    expect(layout.cells.get('0,1')?.x).toBe(100)
    expect(layout.totalWidth).toBe(300)
  })

  it('handles cell spans across columns', () => {
    const table = makeTableComponent({
      columns: [{ width: 100 }, { width: 100 }, { width: 100 }],
    })
    const rows = [
      makeRow([
        { kind: 'tableCell', colSpan: 2, rowSpan: 1 },
        { kind: 'tableCell', colSpan: 1, rowSpan: 1 },
      ]),
      makeRow([
        { kind: 'tableCell', colSpan: 1, rowSpan: 1 },
        { kind: 'tableCell', colSpan: 1, rowSpan: 1 },
        { kind: 'tableCell', colSpan: 1, rowSpan: 1 },
      ]),
    ]
    const layout = computeTableLayout(table, rows, 300)

    const cell = layout.cells.get('0,0')
    expect(cell).toBeDefined()
    expect(cell!.width).toBe(200)
  })

  it('handles row spans', () => {
    const table = makeTableComponent({
      columns: [{ width: 100 }, { width: 100 }],
    })
    const rows = [
      makeRow([
        { kind: 'tableCell', colSpan: 1, rowSpan: 2 },
        { kind: 'tableCell', colSpan: 1, rowSpan: 1 },
      ]),
      makeRow([
        { kind: 'tableCell', colSpan: 1, rowSpan: 1 },
        { kind: 'tableCell', colSpan: 1, rowSpan: 1 },
      ]),
    ]
    const layout = computeTableLayout(table, rows, 200)

    const cell = layout.cells.get('0,0')
    expect(cell).toBeDefined()
    expect(cell!.height).toBe(60)
  })

  it('clamps spans to table bounds', () => {
    const table = makeTableComponent({
      columns: [{ width: 100 }],
    })
    const rows = [makeRow([{ kind: 'tableCell', colSpan: 5, rowSpan: 5 }])]
    const layout = computeTableLayout(table, rows, 100)

    const cell = layout.cells.get('0,0')
    expect(cell).toBeDefined()
    expect(cell!.width).toBe(100)
    expect(cell!.height).toBe(30)
  })

  it('does not include covered cells when a cell spans multiple columns', () => {
    const table = makeTableComponent({
      columns: [{ width: 100 }, { width: 100 }, { width: 100 }],
    })
    const rows = [makeRow([{ kind: 'tableCell', colSpan: 3, rowSpan: 1 }])]
    const layout = computeTableLayout(table, rows, 300)

    expect(layout.cells.has('0,0')).toBe(true)
    expect(layout.cells.has('0,1')).toBe(false)
    expect(layout.cells.has('0,2')).toBe(false)
    expect(layout.cells.size).toBe(1)

    const cell = layout.cells.get('0,0')
    expect(cell).toBeDefined()
    expect(cell!.width).toBe(300)
  })

  it('does not include covered cells when a cell spans multiple rows', () => {
    const table = makeTableComponent({
      columns: [{ width: 100 }, { width: 100 }],
    })
    const rows = [
      makeRow([
        { kind: 'tableCell', colSpan: 1, rowSpan: 3 },
        { kind: 'tableCell', colSpan: 1, rowSpan: 1 },
      ]),
      makeRow([
        { kind: 'tableCell', colSpan: 1, rowSpan: 1 },
        { kind: 'tableCell', colSpan: 1, rowSpan: 1 },
      ]),
      makeRow([
        { kind: 'tableCell', colSpan: 1, rowSpan: 1 },
        { kind: 'tableCell', colSpan: 1, rowSpan: 1 },
      ]),
    ]
    const layout = computeTableLayout(table, rows, 200)

    expect(layout.cells.has('0,0')).toBe(true)
    expect(layout.cells.has('1,0')).toBe(false)
    expect(layout.cells.has('2,0')).toBe(false)
    expect(layout.cells.has('0,1')).toBe(true)
    expect(layout.cells.has('1,1')).toBe(true)
    expect(layout.cells.has('2,1')).toBe(true)
    expect(layout.cells.size).toBe(4)

    const cell = layout.cells.get('0,0')
    expect(cell).toBeDefined()
    expect(cell!.height).toBe(90)
  })

  it('handles multiple independent spans', () => {
    const table = makeTableComponent({
      columns: [{ width: 100 }, { width: 100 }, { width: 100 }],
    })
    const rows = [
      makeRow([
        { kind: 'tableCell', colSpan: 2, rowSpan: 1 },
        { kind: 'tableCell', colSpan: 1, rowSpan: 1 },
      ]),
      makeRow([
        { kind: 'tableCell', colSpan: 1, rowSpan: 1 },
        { kind: 'tableCell', colSpan: 2, rowSpan: 1 },
      ]),
    ]
    const layout = computeTableLayout(table, rows, 300)

    expect(layout.cells.has('0,0')).toBe(true)
    expect(layout.cells.has('0,1')).toBe(false)
    expect(layout.cells.has('0,2')).toBe(true)
    expect(layout.cells.has('1,0')).toBe(true)
    expect(layout.cells.has('1,1')).toBe(true)
    expect(layout.cells.has('1,2')).toBe(false)
    expect(layout.cells.size).toBe(4)

    const cell00 = layout.cells.get('0,0')
    expect(cell00!.width).toBe(200)

    const cell11 = layout.cells.get('1,1')
    expect(cell11!.width).toBe(200)
  })

  it('does not affect column widths when using spans', () => {
    const table = makeTableComponent({
      columns: [{ width: 100 }, { width: 200 }, { width: 150 }],
    })
    const rows = [
      makeRow([
        { kind: 'tableCell', colSpan: 2, rowSpan: 1 },
        { kind: 'tableCell', colSpan: 1, rowSpan: 1 },
      ]),
      makeRow([
        { kind: 'tableCell', colSpan: 1, rowSpan: 1 },
        { kind: 'tableCell', colSpan: 1, rowSpan: 1 },
        { kind: 'tableCell', colSpan: 1, rowSpan: 1 },
      ]),
    ]
    const layout = computeTableLayout(table, rows, 450)

    expect(layout.columns).toEqual([100, 200, 150])

    const cell00 = layout.cells.get('0,0')
    expect(cell00!.width).toBe(100 + 200)

    const cell02 = layout.cells.get('0,2')
    expect(cell02).toBeDefined()
    expect(cell02!.width).toBe(150)
  })

  it('handles single column and row', () => {
    const table = makeTableComponent({
      columns: [{ width: 200 }],
    })
    const rows = makeRows(1, 1)
    const layout = computeTableLayout(table, rows, 200)

    expect(layout.columns).toEqual([200])
    expect(layout.cells.size).toBe(1)
    expect(layout.totalWidth).toBe(200)
  })

  it('handles all-auto columns with no available space', () => {
    const table = makeTableComponent({
      columns: [{ width: 'auto' }, { width: 'auto' }],
    })
    const rows = makeRows(1, 2)
    const layout = computeTableLayout(table, rows, 0)

    expect(layout.columns[0]).toBe(0)
    expect(layout.columns[1]).toBe(0)
  })

  it('produces correct cell positions for 2x2 grid', () => {
    const table = makeTableComponent()
    const rows = makeRows(2, 2)
    const layout = computeTableLayout(table, rows, 300)

    expect(layout.cells.get('0,0')).toEqual({ x: 0, y: 0, width: 100, height: 30 })
    expect(layout.cells.get('0,1')).toEqual({ x: 100, y: 0, width: 200, height: 30 })
    expect(layout.cells.get('1,0')).toEqual({ x: 0, y: 30, width: 100, height: 30 })
    expect(layout.cells.get('1,1')).toEqual({ x: 100, y: 30, width: 200, height: 30 })
  })

  it('produces correct cell positions with gap and border', () => {
    const table = makeTableComponent({ gap: 5, borderWidth: 1 })
    const rows = makeRows(2, 2)
    const layout = computeTableLayout(table, rows, 313)

    expect(layout.cells.get('0,0')?.x).toBe(0)
    expect(layout.cells.get('0,0')?.y).toBe(0)
    expect(layout.cells.get('0,1')?.x).toBe(100 + 5)
    expect(layout.cells.get('1,0')?.y).toBe(30 + 5)
  })

  it('respects minWidth for auto columns', () => {
    const table = makeTableComponent({
      columns: [
        { width: 'auto', minWidth: 120 },
        { width: 'auto', minWidth: 80 },
      ],
    })
    const rows = makeRows(2, 2)
    const layout = computeTableLayout(table, rows, 300)

    expect(layout.columns[0]).toBeGreaterThanOrEqual(120)
    expect(layout.columns[1]).toBeGreaterThanOrEqual(80)
  })
})

describe('TableLayoutCache', () => {
  it('caches layout and returns same reference when not dirty', () => {
    const cache = new TableLayoutCache()
    const table = makeTableComponent()
    const rows = makeRows(2, 2)

    const layout1 = cache.compute(table, rows, 300)
    const layout2 = cache.compute(table, rows, 300)

    expect(layout1).toBe(layout2)
  })

  it('recomputes when layoutDirty is set', () => {
    const cache = new TableLayoutCache()
    const table = makeTableComponent()
    const rows = makeRows(2, 2)

    const layout1 = cache.compute(table, rows, 300)
    cache.markDirty()
    const layout2 = cache.compute(table, rows, 300)

    expect(layout1).not.toBe(layout2)
    expect(layout2.columns).toEqual([100, 200])
  })

  it('recomputes when available width changes', () => {
    const cache = new TableLayoutCache()
    const table = makeTableComponent({
      columns: [{ width: 'auto' }, { width: 'auto' }],
    })
    const rows = makeRows(2, 2)

    const layout1 = cache.compute(table, rows, 300)
    const layout2 = cache.compute(table, rows, 600)

    expect(layout1).not.toBe(layout2)
    expect(layout2.totalWidth).toBe(600)
  })

  it('reports layoutDirty correctly', () => {
    const cache = new TableLayoutCache()
    const table = makeTableComponent()
    const rows = makeRows(2, 2)

    expect(cache.layoutDirty).toBe(true)

    cache.compute(table, rows, 300)
    expect(cache.layoutDirty).toBe(false)

    cache.markDirty()
    expect(cache.layoutDirty).toBe(true)

    cache.compute(table, rows, 300)
    expect(cache.layoutDirty).toBe(false)
  })
})
