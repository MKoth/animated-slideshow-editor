import { describe, expect, it } from 'vitest'
import { computeTableLayout, TableLayoutCache } from '../../engine/tableGridLayout'
import type { TableComponent } from '../../engine/components'

function makeTable(overrides: Partial<TableComponent> = {}): TableComponent {
  return {
    kind: 'table',
    columns: [
      { width: 100 },
      { width: 200 },
    ],
    rows: [
      { width: 30 },
      { width: 30 },
    ],
    gap: 0,
    cellPadding: 0,
    borderWidth: 0,
    borderColor: '#000000',
    textWrap: 'wrap',
    columnMapping: {},
    cellSpans: {},
    ...overrides,
  }
}

describe('computeTableLayout', () => {
  it('computes layout for fixed-width columns and rows', () => {
    const table = makeTable()
    const layout = computeTableLayout(table, 300)

    expect(layout.columns).toEqual([100, 200])
    expect(layout.rows).toEqual([30, 30])
    expect(layout.totalWidth).toBe(300)
    expect(layout.totalHeight).toBe(60)
  })

  it('distributes remaining space to auto columns proportionally', () => {
    const table = makeTable({
      columns: [{ width: 100 }, { width: 'auto' }, { width: 'auto' }],
    })
    const layout = computeTableLayout(table, 400)

    expect(layout.columns[0]).toBe(100)
    expect(layout.columns[1]).toBe(150)
    expect(layout.columns[2]).toBe(150)
    expect(layout.totalWidth).toBe(400)
  })

  it('distributes remaining space to auto rows', () => {
    const table = makeTable({
      rows: [{ width: 30 }, { width: 'auto' }, { width: 'auto' }],
    })
    const layout = computeTableLayout(table, 300)

    expect(layout.rows[0]).toBe(30)
    expect(layout.rows[1]).toBe(0)
    expect(layout.rows[2]).toBe(0)
  })

  it('applies gap between columns and rows', () => {
    const table = makeTable({ gap: 10 })
    const layout = computeTableLayout(table, 310)

    expect(layout.columns).toEqual([100, 200])
    expect(layout.totalWidth).toBe(310)
    expect(layout.cells.get('0,0')?.x).toBe(0)
    expect(layout.cells.get('0,1')?.x).toBe(110)
  })

  it('applies border width around cells', () => {
    const table = makeTable({ borderWidth: 2 })
    const layout = computeTableLayout(table, 308)

    expect(layout.cells.get('0,0')?.x).toBe(2)
    expect(layout.cells.get('0,0')?.y).toBe(2)
    expect(layout.cells.get('0,1')?.x).toBe(106)
    expect(layout.totalWidth).toBe(308)
  })

  it('applies cell padding to cell dimensions', () => {
    const table = makeTable({ cellPadding: 5 })
    const layout = computeTableLayout(table, 320)

    const cell = layout.cells.get('0,0')
    expect(cell?.width).toBe(110)
    expect(cell?.height).toBe(40)
  })

  it('respects minWidth for auto columns', () => {
    const table = makeTable({
      columns: [{ width: 'auto', minWidth: 120 }, { width: 'auto', minWidth: 80 }],
    })
    const layout = computeTableLayout(table, 300)

    expect(layout.columns[0]).toBeGreaterThanOrEqual(120)
    expect(layout.columns[1]).toBeGreaterThanOrEqual(80)
  })

  it('handles cell spans across columns', () => {
    const table = makeTable({
      columns: [{ width: 100 }, { width: 100 }, { width: 100 }],
      rows: [{ width: 30 }, { width: 30 }],
      cellSpans: { '0,1': { colSpan: 2, rowSpan: 1 } },
    })
    const layout = computeTableLayout(table, 300)

    const cell = layout.cells.get('0,1')
    expect(cell).toBeDefined()
    expect(cell!.width).toBe(200)
  })

  it('handles row spans', () => {
    const table = makeTable({
      columns: [{ width: 100 }, { width: 100 }],
      rows: [{ width: 30 }, { width: 30 }],
      cellSpans: { '0,0': { colSpan: 1, rowSpan: 2 } },
    })
    const layout = computeTableLayout(table, 200)

    const cell = layout.cells.get('0,0')
    expect(cell).toBeDefined()
    expect(cell!.height).toBe(60)
  })

  it('clamps spans to table bounds', () => {
    const table = makeTable({
      columns: [{ width: 100 }],
      rows: [{ width: 30 }],
      cellSpans: { '0,0': { colSpan: 5, rowSpan: 5 } },
    })
    const layout = computeTableLayout(table, 100)

    const cell = layout.cells.get('0,0')
    expect(cell).toBeDefined()
    expect(cell!.width).toBe(100)
    expect(cell!.height).toBe(30)
  })

  it('handles single column and row', () => {
    const table = makeTable({
      columns: [{ width: 200 }],
      rows: [{ width: 50 }],
    })
    const layout = computeTableLayout(table, 200)

    expect(layout.columns).toEqual([200])
    expect(layout.rows).toEqual([50])
    expect(layout.cells.size).toBe(1)
    expect(layout.totalWidth).toBe(200)
    expect(layout.totalHeight).toBe(50)
  })

  it('handles all-auto columns with no available space', () => {
    const table = makeTable({
      columns: [{ width: 'auto' }, { width: 'auto' }],
      rows: [{ width: 30 }],
    })
    const layout = computeTableLayout(table, 0)

    expect(layout.columns[0]).toBe(0)
    expect(layout.columns[1]).toBe(0)
  })

  it('produces correct cell positions for 2x2 grid', () => {
    const table = makeTable()
    const layout = computeTableLayout(table, 300)

    expect(layout.cells.get('0,0')).toEqual({ x: 0, y: 0, width: 100, height: 30 })
    expect(layout.cells.get('0,1')).toEqual({ x: 100, y: 0, width: 200, height: 30 })
    expect(layout.cells.get('1,0')).toEqual({ x: 0, y: 30, width: 100, height: 30 })
    expect(layout.cells.get('1,1')).toEqual({ x: 100, y: 30, width: 200, height: 30 })
  })

  it('produces correct cell positions with gap and border', () => {
    const table = makeTable({ gap: 5, borderWidth: 1 })
    const layout = computeTableLayout(table, 313)

    expect(layout.cells.get('0,0')?.x).toBe(1)
    expect(layout.cells.get('0,0')?.y).toBe(1)
    expect(layout.cells.get('0,1')?.x).toBe(1 + 100 + 2 + 5)
    expect(layout.cells.get('1,0')?.y).toBe(1 + 30 + 2 + 5)
  })
})

describe('TableLayoutCache', () => {
  it('caches layout and returns same reference when not dirty', () => {
    const cache = new TableLayoutCache()
    const table = makeTable()

    const layout1 = cache.compute(table, 300)
    const layout2 = cache.compute(table, 300)

    expect(layout1).toBe(layout2)
  })

  it('recomputes when layoutDirty is set', () => {
    const cache = new TableLayoutCache()
    const table = makeTable()

    const layout1 = cache.compute(table, 300)
    cache.markDirty()
    const layout2 = cache.compute(table, 300)

    expect(layout1).not.toBe(layout2)
    expect(layout2.columns).toEqual([100, 200])
  })

  it('does not recompute when layoutDirty is false and config unchanged', () => {
    const cache = new TableLayoutCache()
    const table = makeTable()

    const layout1 = cache.compute(table, 300)
    const layout2 = cache.compute(table, 300)

    expect(layout1).toBe(layout2)
  })

  it('recomputes when available width changes', () => {
    const cache = new TableLayoutCache()
    const table = makeTable({
      columns: [{ width: 'auto' }, { width: 'auto' }],
    })

    const layout1 = cache.compute(table, 300)
    const layout2 = cache.compute(table, 600)

    expect(layout1).not.toBe(layout2)
    expect(layout2.totalWidth).toBe(600)
  })

  it('reports layoutDirty correctly', () => {
    const cache = new TableLayoutCache()
    const table = makeTable()

    expect(cache.layoutDirty).toBe(true)

    cache.compute(table, 300)
    expect(cache.layoutDirty).toBe(false)

    cache.markDirty()
    expect(cache.layoutDirty).toBe(true)

    cache.compute(table, 300)
    expect(cache.layoutDirty).toBe(false)
  })
})
