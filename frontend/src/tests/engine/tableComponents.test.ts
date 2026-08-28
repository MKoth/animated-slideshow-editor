import { describe, expect, it } from 'vitest'
import type { TableRowComponent, TableCellComponent, TableComponent } from '../../engine/components'
import { createEngine } from '../../engine/internal'

describe('TableRowComponent', () => {
  it('has kind "tableRow"', () => {
    const row: TableRowComponent = { kind: 'tableRow' }
    expect(row.kind).toBe('tableRow')
  })

  it('allows optional borderColor override', () => {
    const row: TableRowComponent = { kind: 'tableRow', borderColor: '#ff0000' }
    expect(row.borderColor).toBe('#ff0000')
  })

  it('allows optional background', () => {
    const row: TableRowComponent = { kind: 'tableRow', background: '#eeeeee' }
    expect(row.background).toBe('#eeeeee')
  })
})

describe('TableCellComponent', () => {
  it('has kind "tableCell"', () => {
    const cell: TableCellComponent = { kind: 'tableCell', colSpan: 1, rowSpan: 1 }
    expect(cell.kind).toBe('tableCell')
  })

  it('allows colSpan and rowSpan overrides', () => {
    const cell: TableCellComponent = { kind: 'tableCell', colSpan: 2, rowSpan: 3 }
    expect(cell.colSpan).toBe(2)
    expect(cell.rowSpan).toBe(3)
  })

  it('allows optional borderColor, background, and padding overrides', () => {
    const cell: TableCellComponent = {
      kind: 'tableCell',
      colSpan: 1,
      rowSpan: 1,
      borderColor: '#00ff00',
      background: '#ffffff',
      padding: 16,
    }
    expect(cell.borderColor).toBe('#00ff00')
    expect(cell.background).toBe('#ffffff')
    expect(cell.padding).toBe(16)
  })
})

describe('TableComponent simplified', () => {
  it('no longer carries rows, cellPadding, textWrap, columnMapping, or cellSpans', () => {
    const table: TableComponent = {
      kind: 'table',
      columns: [{ width: 100 }, { width: 100 }],
      gap: 4,
      borderWidth: 1,
      borderColor: '#000000',
    }
    expect(table.columns).toHaveLength(2)
    expect(table.gap).toBe(4)
    expect(table.borderWidth).toBe(1)
    expect(table.borderColor).toBe('#000000')
    // These properties should not exist
    expect('rows' in table).toBe(false)
    expect('cellPadding' in table).toBe(false)
    expect('textWrap' in table).toBe(false)
    expect('columnMapping' in table).toBe(false)
    expect('cellSpans' in table).toBe(false)
  })
})

describe('TableRow and TableCell on NodeComponents', () => {
  it('engine creates nodes with tableRow component', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    engine.createSlide('S1')
    const slide = engine.project!.slides[0]
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Row', {
      components: { tableRow: { kind: 'tableRow' } },
    })
    expect(node.components.tableRow).toBeDefined()
    expect(node.components.tableRow!.kind).toBe('tableRow')
  })

  it('engine creates nodes with tableCell component', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    engine.createSlide('S1')
    const slide = engine.project!.slides[0]
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Cell', {
      components: { tableCell: { kind: 'tableCell', colSpan: 1, rowSpan: 1 } },
    })
    expect(node.components.tableCell).toBeDefined()
    expect(node.components.tableCell!.kind).toBe('tableCell')
  })
})
